import json
import os

# MUST be set before av / faster-whisper(ctranslate2) / cv2 load, otherwise the
# OpenMP runtimes clash and the process aborts with "OMP Error #15" (which is a
# native abort, not a catchable Python exception) — that's what hangs transcription.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import tempfile
import wave
from pathlib import Path
from typing import Any

import av
from dotenv import load_dotenv
from fastapi import UploadFile
from faster_whisper import WhisperModel
from openai import OpenAI

import video_analyzer

load_dotenv()

# Load the Whisper model once and reuse it — re-creating it per request is slow
# and needlessly re-initializes the OpenMP runtime each time.
_WHISPER_MODEL = None


def _get_whisper_model():
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        _WHISPER_MODEL = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
    return _WHISPER_MODEL

OPENAI_VIDEO_MODEL = os.getenv("OPENAI_VIDEO_EDIT_MODEL", "gpt-4o-mini")
VIDEO_PLATFORMS = {"instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"}
ALLOWED_EDIT_TYPES = {
    "cut",
    "hook_rewrite",
    "text_overlay",
    "subtitle",
    "cta_overlay",
    "resize",
    "pacing_fix",
    "caption_rewrite",
}
CONFIDENCE_LEVELS = {"low", "medium", "high"}
SCORE_KEYS = [
    ("visual_quality", "Visual Quality"),
    ("platform_fit", "Platform Fit"),
    ("content_clarity", "Content Clarity"),
    ("engagement_potential", "Engagement Potential"),
]
WHISPER_MODEL_SIZE = os.getenv("FASTER_WHISPER_MODEL", "tiny")


async def analyze_uploaded_video(
    video: UploadFile,
    target_platform: str,
    goal: str | None = None,
    topic: str = "science innovation",
) -> dict[str, Any]:
    temp_path = _build_temp_path(video.filename)

    try:
        file_bytes = await video.read()
        temp_path.write_bytes(file_bytes)

        analyzer_result = video_analyzer.analyze_video(str(temp_path), topic=topic)
        metadata = _normalize_metadata(analyzer_result.get("metadata") or {}, temp_path)
        warnings = list(analyzer_result.get("warnings") or [])
        if analyzer_result.get("error"):
            warnings.append(f"Existing video analyzer warning: {analyzer_result['error']}")

        audio_info = inspect_and_extract_audio(temp_path)
        metadata["has_audio"] = audio_info["has_audio"]
        if audio_info.get("warning"):
            warnings.append(audio_info["warning"])

        transcript = transcribe_audio(audio_info)
        if transcript.get("error"):
            warnings.append(f"Transcription failed: {transcript['error']}")

        evidence = _build_evidence_summary(metadata, transcript, analyzer_result)
        analysis, source = generate_ai_edit_suggestions(
            metadata=metadata,
            transcript=transcript,
            target_platform=target_platform,
            goal=goal,
            analyzer_context=_build_analyzer_context(analyzer_result),
            evidence=evidence,
        )
        analysis["content_analysis_confidence"] = _determine_confidence(evidence)
        if transcript.get("available") and analysis["scores"]["content_clarity"] is None:
            analysis["scores"]["content_clarity"] = _estimate_content_clarity(transcript)
            analysis["overall_score"] = _compute_overall_score(analysis["scores"])

        if transcript.get("error") and analysis["scores"]["content_clarity"] is None:
            warnings.append("Content Clarity is unknown because no verified transcript evidence was available.")
        if analysis.get("content_analysis_confidence") == "low":
            warnings.append("Content analysis confidence is low because transcript or frame evidence is limited.")

        warning_text = " ".join(_dedupe_preserve_order(warnings)) if warnings else None

        return {
            "target_platform": target_platform,
            "goal": goal or "",
            "topic": topic,
            "metadata": metadata,
            "transcript": transcript,
            "analysis": analysis,
            "source": source,
            "warning": warning_text,
            "warnings": _dedupe_preserve_order(warnings),
            "analyzer_result": analyzer_result,
            "video_summary": analyzer_result.get("video_summary"),
            "frames": analyzer_result.get("frames", []),
            "best_thumbnail_index": analyzer_result.get("best_thumbnail_index"),
            "overall_verdict": analyzer_result.get("overall_verdict"),
            "key_improvements": analyzer_result.get("key_improvements", []),
            "platforms": analyzer_result.get("platforms", {}),
        }
    finally:
        temp_path.unlink(missing_ok=True)


def inspect_and_extract_audio(video_path: str | Path) -> dict[str, Any]:
    path = Path(video_path)
    temp_audio_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    temp_audio_file.close()
    audio_path = Path(temp_audio_file.name)

    try:
        container = av.open(str(path))
    except Exception as exc:
        audio_path.unlink(missing_ok=True)
        return {
            "has_audio": False,
            "audio_path": None,
            "error": f"Could not open video for audio inspection: {exc}",
            "warning": f"Audio inspection failed: {exc}",
        }

    try:
        audio_stream = next((stream for stream in container.streams if stream.type == "audio"), None)
        if audio_stream is None:
            audio_path.unlink(missing_ok=True)
            return {
                "has_audio": False,
                "audio_path": None,
                "error": "No audio stream detected in the uploaded video.",
                "warning": "No audio stream detected in the uploaded video.",
            }

        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)

        with wave.open(str(audio_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)

            wrote_frames = False
            for frame in container.decode(audio=0):
                resampled_frames = resampler.resample(frame)
                if not isinstance(resampled_frames, list):
                    resampled_frames = [resampled_frames]
                for resampled in resampled_frames:
                    if resampled is None:
                        continue
                    wav_file.writeframes(resampled.to_ndarray().tobytes())
                    wrote_frames = True

        if not wrote_frames or audio_path.stat().st_size == 0:
            audio_path.unlink(missing_ok=True)
            return {
                "has_audio": False,
                "audio_path": None,
                "error": "An audio stream exists, but audio extraction produced no usable samples.",
                "warning": "Audio extraction produced no usable samples.",
            }

        return {
            "has_audio": True,
            "audio_path": audio_path,
            "error": None,
            "warning": None,
        }
    except Exception as exc:
        audio_path.unlink(missing_ok=True)
        return {
            "has_audio": False,
            "audio_path": None,
            "error": f"Audio extraction failed: {exc}",
            "warning": f"Audio extraction failed: {exc}",
        }
    finally:
        container.close()


def transcribe_audio(audio_info: dict[str, Any]) -> dict[str, Any]:
    audio_path = audio_info.get("audio_path")
    if not audio_info.get("has_audio") or audio_path is None:
        return {
            "source": "faster-whisper",
            "available": False,
            "text": "",
            "segments": [],
            "error": audio_info.get("error") or "No audio stream was available for transcription.",
        }

    try:
        model = _get_whisper_model()
        segments, info = model.transcribe(str(audio_path), vad_filter=True)
        normalized_segments = [
            {
                "start": round(float(segment.start), 2),
                "end": round(float(segment.end), 2),
                "text": segment.text.strip(),
            }
            for segment in segments
            if segment.text.strip()
        ]

        transcript_text = " ".join(segment["text"] for segment in normalized_segments)
        if not normalized_segments:
            return {
                "source": "faster-whisper",
                "available": False,
                "language": getattr(info, "language", None),
                "text": "",
                "segments": [],
                "error": "faster-whisper completed, but no transcript segments were produced.",
            }

        return {
            "source": "faster-whisper",
            "available": True,
            "language": getattr(info, "language", None),
            "text": transcript_text,
            "segments": normalized_segments,
            "error": None,
        }
    except Exception as exc:
        return {
            "source": "faster-whisper",
            "available": False,
            "text": "",
            "segments": [],
            "error": f"faster-whisper transcription failed: {exc}",
        }
    finally:
        Path(audio_path).unlink(missing_ok=True)


def generate_ai_edit_suggestions(
    metadata: dict[str, Any],
    transcript: dict[str, Any],
    target_platform: str,
    goal: str | None = None,
    analyzer_context: dict[str, Any] | None = None,
    evidence: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _demo_edit_suggestions(target_platform, goal, metadata, evidence), "demo"

    try:
        client = OpenAI(api_key=api_key)
        transcript_segments = transcript.get("segments", [])
        prompt = f"""
You are an expert social media video editor for Stars of Science.

Analyze the provided video metadata, transcript timestamps, target platform, and goal.
Use only the information provided.
Never describe visuals, lighting, scene quality, storytelling, engagement hooks, camera moves, or audience reaction unless that claim is explicitly supported by transcript evidence or frame evidence below.
If transcript evidence is unavailable, set Content Clarity to null and keep confidence lower instead of collapsing the overall score.
If transcript and frame evidence are both weak, clearly state that content analysis confidence is low.

Return only valid JSON with this exact schema:
{{
  "content_analysis_confidence": "low|medium|high",
  "scores": {{
    "visual_quality": 0,
    "platform_fit": 0,
    "content_clarity": null,
    "engagement_potential": 0
  }},
  "score_reasons": {{
    "visual_quality": "",
    "platform_fit": "",
    "content_clarity": "",
    "engagement_potential": ""
  }},
  "summary": "",
  "platform_fit": "",
  "edit_suggestions": [
    {{
      "type": "",
      "start": 0,
      "end": 0,
      "issue": "",
      "action": "",
      "reason": "",
      "replacement_text": ""
    }}
  ],
  "recommended_caption": "",
  "recommended_hashtags": [],
  "recommended_cta": ""
}}

Allowed edit types only:
cut, hook_rewrite, text_overlay, subtitle, cta_overlay, resize, pacing_fix, caption_rewrite

Scoring rules:
1. Score each numeric category from 0 to 100.
2. "content_clarity" must be null when transcript evidence is unavailable or unreliable.
3. Do not heavily penalize the overall judgment just because transcript evidence is missing.
4. Use frame evidence for Visual Quality and part of Engagement Potential.
5. Use metadata plus platform context for Platform Fit.
6. Do not give extremely low scores unless there is direct evidence of a serious problem.
7. If evidence is limited, keep scores moderate and reduce confidence instead of forcing harsh scores.
8. Score for social-media readiness, not cinematic perfection.
9. Use this scale as the primary intuition:
   - 0-20 = unusable / broken evidence
   - 21-40 = poor
   - 41-60 = average / needs improvement
   - 61-80 = good
   - 81-100 = excellent
10. Do not score below 40 unless there is clear severe evidence such as broken media, unreadable frames, major technical failure, or obviously empty content.
11. If metadata, frames, and transcript evidence are all present and usable, a typical clip should usually land in the 40-80 range, not near zero.
12. If frames are dark or slightly unclear but still usable, Visual Quality should usually be 40-60 rather than below 40.
13. If content has some value but pacing or repetition is weak, Engagement Potential should usually be 40-60 rather than below 40.
14. Engagement Potential should consider hook, pacing, CTA, novelty, and audience relevance, but missing evidence alone should not push it into an extreme low range.
15. Each score reason should be one short sentence grounded in the available evidence.

Category guidance:
- Visual Quality: consider resolution, clarity from sampled frames, orientation, and visual consistency; usable but imperfect footage should still score in the moderate range.
- Platform Fit: consider target platform, duration, orientation, and content style; avoid punishing a clip simply for not being optimized yet.
- Content Clarity: rely on transcript when available; otherwise return null and explain that transcript evidence is unavailable.
- Engagement Potential: consider hook, pacing, CTA, novelty, and audience relevance based on transcript or frame evidence only; if the clip has some value but weak pacing, stay in the moderate range.

TARGET PLATFORM: {target_platform}
GOAL: {goal or "General platform optimization"}

VIDEO METADATA:
{json.dumps(metadata, indent=2)}

TRANSCRIPT WITH TIMESTAMPS:
{json.dumps(transcript_segments, indent=2)}

TRANSCRIPT STATUS:
{json.dumps({k: transcript.get(k) for k in ('available', 'language', 'error')}, indent=2)}

EXISTING VIDEO ANALYZER OUTPUT:
{json.dumps(analyzer_context or {}, indent=2)}

EVIDENCE SUMMARY:
{json.dumps(evidence or {}, indent=2)}
"""

        response = client.chat.completions.create(
            model=OPENAI_VIDEO_MODEL,
            response_format={"type": "json_object"},
            max_tokens=1600,
            messages=[
                {"role": "system", "content": "Return JSON only."},
                {"role": "user", "content": prompt},
            ],
        )

        raw = (response.choices[0].message.content or "").strip()
        parsed = json.loads(raw.replace("```json", "").replace("```", "").strip())
        return _normalize_analysis(parsed, transcript_available=bool(transcript.get("available"))), "openai"
    except Exception:
        return _demo_edit_suggestions(target_platform, goal, metadata, evidence), "demo"


def _demo_edit_suggestions(
    target_platform: str,
    goal: str | None,
    metadata: dict[str, Any],
    evidence: dict[str, Any] | None,
) -> dict[str, Any]:
    clip_length = max(metadata.get("duration_seconds") or 0, 18)
    opening_end = round(min(4, clip_length), 2)
    middle_end = round(min(12, clip_length), 2)
    final_start = round(max(clip_length - 4, 0), 2)
    transcript_available = bool((evidence or {}).get("transcript_available"))

    scores = {
        "visual_quality": 72,
        "platform_fit": 70,
        "content_clarity": 68 if transcript_available else None,
        "engagement_potential": 66,
    }

    return {
        "overall_score": _compute_overall_score(scores),
        "content_analysis_confidence": _determine_confidence(evidence or {}),
        "scores": scores,
        "score_reasons": {
            "visual_quality": "Frame evidence suggests the visuals are usable overall, but not all quality details were verified.",
            "platform_fit": f"The metadata and clip structure suggest a workable fit for {target_platform}, with room for optimization.",
            "content_clarity": "Transcript evidence is available and gives a basic sense of the spoken message." if transcript_available else "Transcript evidence is unavailable, so content clarity cannot be confirmed.",
            "engagement_potential": "The clip shows some potential for attention, but stronger evidence would be needed for a more confident engagement score.",
        },
        "summary": "Demo AI suggestions are shown because the live OpenAI video analysis is unavailable right now.",
        "platform_fit": f"The clip has a workable foundation for {target_platform}, but it would benefit from a sharper opening, cleaner pacing, and a clearer call to action.",
        "edit_suggestions": [
            {
                "type": "hook_rewrite",
                "start": 0,
                "end": opening_end,
                "issue": "The opening may not create enough immediate curiosity for fast-scrolling viewers.",
                "action": "Replace the opening line or subtitle with a bolder promise, question, or surprising insight.",
                "reason": f"{target_platform.capitalize()} audiences usually decide within the first few seconds whether to keep watching.",
                "replacement_text": "What if one bold idea from Qatar could change the future of science?",
            },
            {
                "type": "pacing_fix",
                "start": opening_end,
                "end": middle_end,
                "issue": "The middle section may feel slower than the opening and closing beats.",
                "action": "Tighten pauses, trim repeated lines, and keep only the strongest spoken moments in this section.",
                "reason": "A faster rhythm helps maintain retention once the core idea has been introduced.",
                "replacement_text": "",
            },
            {
                "type": "cta_overlay",
                "start": final_start,
                "end": round(clip_length, 2),
                "issue": "The ending may not give viewers a strong next step.",
                "action": "Add a closing text overlay with a direct call to watch, comment, or follow.",
                "reason": "A clear ending cue improves engagement and makes the clip feel complete.",
                "replacement_text": "Watch the full innovation story and tell us which idea stands out most.",
            },
        ],
        "recommended_caption": f"Big ideas start with one breakthrough moment. Here is a sharper {target_platform} version built to keep attention and spark conversation around Stars of Science.",
        "recommended_hashtags": ["#StarsOfScience", "#Science", "#Innovation", "#Qatar", "#MENA"],
        "recommended_cta": goal or "Watch, comment, and share your favorite breakthrough.",
    }


def _normalize_analysis(data: dict[str, Any], transcript_available: bool) -> dict[str, Any]:
    suggestions = []
    for item in data.get("edit_suggestions", []):
        suggestion_type = str(item.get("type", "cut")).strip() or "cut"
        if suggestion_type not in ALLOWED_EDIT_TYPES:
            suggestion_type = "cut"

        suggestions.append(
            {
                "type": suggestion_type,
                "start": round(_to_float(item.get("start")), 2),
                "end": round(_to_float(item.get("end")), 2),
                "issue": str(item.get("issue", "")).strip(),
                "action": str(item.get("action", "")).strip(),
                "reason": str(item.get("reason", "")).strip(),
                "replacement_text": str(item.get("replacement_text", "")).strip(),
            }
        )

    scores = _normalize_scores(data.get("scores"), transcript_available)
    hashtags = [
        str(tag).strip()
        for tag in data.get("recommended_hashtags", [])
        if str(tag).strip()
    ]
    score_reasons = _normalize_score_reasons(data.get("score_reasons"), transcript_available)

    return {
        "overall_score": _compute_overall_score(scores),
        "content_analysis_confidence": _normalize_confidence(data.get("content_analysis_confidence")),
        "scores": scores,
        "score_reasons": score_reasons,
        "summary": str(data.get("summary", "")).strip(),
        "platform_fit": str(data.get("platform_fit", "")).strip(),
        "edit_suggestions": suggestions,
        "recommended_caption": str(data.get("recommended_caption", "")).strip(),
        "recommended_hashtags": hashtags,
        "recommended_cta": str(data.get("recommended_cta", "")).strip(),
    }


def _normalize_scores(scores: Any, transcript_available: bool) -> dict[str, int | None]:
    source = scores if isinstance(scores, dict) else {}
    normalized: dict[str, int | None] = {}
    for key, _label in SCORE_KEYS:
        if key == "content_clarity" and not transcript_available:
            normalized[key] = None
            continue
        raw = source.get(key)
        if raw is None:
            normalized[key] = None if key == "content_clarity" else 0
            continue
        normalized[key] = max(0, min(100, int(round(_to_float(raw)))))
    return normalized


def _normalize_score_reasons(score_reasons: Any, transcript_available: bool) -> dict[str, str]:
    source = score_reasons if isinstance(score_reasons, dict) else {}
    normalized: dict[str, str] = {}
    for key, label in SCORE_KEYS:
        reason = str(source.get(key, "")).strip()
        if reason:
            normalized[key] = reason
        elif key == "content_clarity" and not transcript_available:
            normalized[key] = "Transcript evidence is unavailable, so content clarity cannot be scored confidently."
        else:
            normalized[key] = f"{label} was estimated from the available evidence."
    return normalized


def _compute_overall_score(scores: dict[str, int | None]) -> int:
    numeric_scores = [value for value in scores.values() if isinstance(value, int)]
    if not numeric_scores:
        return 0
    return int(round(sum(numeric_scores) / len(numeric_scores)))


def _normalize_metadata(metadata: dict[str, Any], video_path: Path) -> dict[str, Any]:
    return {
        "duration_seconds": metadata.get("duration_seconds"),
        "width": metadata.get("width"),
        "height": metadata.get("height"),
        "aspect_ratio": metadata.get("aspect_ratio"),
        "orientation": metadata.get("orientation"),
        "fps": metadata.get("fps"),
        "file_size_mb": metadata.get("file_size_mb", round(video_path.stat().st_size / (1024 * 1024), 2)),
        "has_audio": metadata.get("has_audio"),
    }


def _build_analyzer_context(analyzer_result: dict[str, Any]) -> dict[str, Any]:
    frames = analyzer_result.get("frames", [])
    frame_summary = [
        {
            "index": frame.get("index"),
            "timestamp": frame.get("timestamp"),
            "score": frame.get("score"),
            "feedback": frame.get("feedback"),
            "suggestion": frame.get("suggestion"),
        }
        for frame in frames[:6]
    ]

    return {
        "video_summary": analyzer_result.get("video_summary"),
        "overall_verdict": analyzer_result.get("overall_verdict"),
        "key_improvements": analyzer_result.get("key_improvements", []),
        "best_thumbnail_index": analyzer_result.get("best_thumbnail_index"),
        "sample_frame_feedback": frame_summary,
    }


def _build_evidence_summary(
    metadata: dict[str, Any],
    transcript: dict[str, Any],
    analyzer_result: dict[str, Any],
) -> dict[str, Any]:
    frame_evidence = []
    for frame in (analyzer_result.get("frames") or [])[:6]:
        frame_evidence.append(
            {
                "timestamp": frame.get("timestamp"),
                "score": frame.get("score"),
                "feedback": frame.get("feedback"),
                "suggestion": frame.get("suggestion"),
            }
        )

    metadata_available = all(metadata.get(field) is not None for field in ("duration_seconds", "width", "height", "fps", "orientation"))
    transcript_available = bool(transcript.get("available"))
    frame_available = len(frame_evidence) > 0

    return {
        "metadata_available": metadata_available,
        "frame_analysis_available": frame_available,
        "transcript_available": transcript_available,
        "frame_evidence": frame_evidence,
        "transcript_error": transcript.get("error"),
    }


def _determine_confidence(evidence: dict[str, Any]) -> str:
    available_count = sum(
        1
        for key in ("metadata_available", "frame_analysis_available", "transcript_available")
        if evidence.get(key)
    )
    if available_count >= 3:
        return "high"
    if available_count == 2:
        return "medium"
    return "low"


def _estimate_content_clarity(transcript: dict[str, Any]) -> int | None:
    if not transcript.get("available"):
        return None
    segments = transcript.get("segments", [])
    text = transcript.get("text", "").strip()
    if not text:
        return None
    word_count = len(text.split())
    segment_count = len(segments)
    base = 55
    if word_count >= 40:
        base += 8
    if word_count >= 100:
        base += 5
    if segment_count >= 4:
        base += 4
    return min(base, 85)


def _normalize_confidence(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in CONFIDENCE_LEVELS:
        return text
    return "low"


def _build_temp_path(filename: str | None) -> Path:
    suffix = Path(filename or "upload.mp4").suffix or ".mp4"
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_file.close()
    return Path(temp_file.name)


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered
