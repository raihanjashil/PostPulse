import base64
import json
import math
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # avoid OpenMP dup-runtime abort (cv2 + faster-whisper)

import subprocess
from pathlib import Path
from typing import Any

import cv2
from dotenv import load_dotenv
from openai import OpenAI

from brand_config import BRAND_PROFILE

load_dotenv(Path(__file__).resolve().with_name(".env"))

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

MAX_FRAMES = 8
MAX_WIDTH = 512
FRAME_SAMPLE_SECONDS = 4.0
MAX_ANALYZER_FRAMES = 12
PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"]


def extract_video_context(video_path: str | Path, max_frames: int = MAX_ANALYZER_FRAMES) -> dict[str, Any]:
    path = Path(video_path)
    metadata = {
        "duration_seconds": None,
        "width": None,
        "height": None,
        "aspect_ratio": None,
        "orientation": None,
        "fps": None,
        "file_size_mb": round(path.stat().st_size / (1024 * 1024), 2),
        "has_audio": None,
    }
    warnings: list[str] = []
    frames: list[dict[str, Any]] = []

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        warnings.append("OpenCV could not open the uploaded video.")
    else:
        try:
            fps = _safe_positive_float(cap.get(cv2.CAP_PROP_FPS))
            total_frames = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration_seconds = round(total_frames / fps, 2) if fps and total_frames else None

            metadata.update(
                {
                    "duration_seconds": duration_seconds,
                    "width": width,
                    "height": height,
                    "aspect_ratio": _format_aspect_ratio(width, height),
                    "orientation": _get_orientation(width, height),
                    "fps": round(fps, 2) if fps else None,
                }
            )

            if total_frames and fps:
                sample_timestamps = _build_sample_timestamps(duration_seconds, fps, total_frames, max_frames)

                for timestamp in sample_timestamps:
                    idx = min(total_frames - 1, int(timestamp * fps))
                    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                    ret, frame = cap.read()
                    if not ret:
                        continue

                    frame_height, frame_width = frame.shape[:2]
                    if frame_width > MAX_WIDTH:
                        scale = MAX_WIDTH / frame_width
                        frame = cv2.resize(frame, (MAX_WIDTH, int(frame_height * scale)))
                    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    b64 = base64.b64encode(buffer).decode("utf-8")
                    frames.append({"timestamp": round(timestamp, 1), "b64": b64})
            else:
                warnings.append("OpenCV could not determine frame count or FPS for this video.")
        finally:
            cap.release()

    ffprobe_warnings = _enrich_metadata_with_ffprobe(path, metadata)
    warnings.extend(ffprobe_warnings)

    if not frames:
        warnings.append("No preview frames could be extracted from the uploaded video.")

    missing_fields = [
        key
        for key in ("duration_seconds", "width", "height", "fps", "orientation")
        if metadata.get(key) in (None, "")
    ]
    if missing_fields:
        warnings.append(
            "Metadata extraction is incomplete. Missing fields: " + ", ".join(missing_fields) + "."
        )

    return {
        "frames": frames,
        "metadata": metadata,
        "warnings": _dedupe_preserve_order(warnings),
    }


def analyze_video(video_path: str, topic: str = "science innovation"):
    context = extract_video_context(video_path)
    frames = context["frames"]
    metadata = context["metadata"]
    warnings = context["warnings"]

    if not frames:
        return {
            "error": "Could not extract frames from this video",
            "metadata": metadata,
            "warnings": warnings,
        }

    prompt_text = f"""
You are a social media video strategist. A creator on the {BRAND_PROFILE['name']} team ({BRAND_PROFILE['description']}, posting to {BRAND_PROFILE['audience_note']}) is testing whether THIS SPECIFIC VIDEO is worth posting.

Below are exactly {len(frames)} images, sampled in chronological order from the video. They are indexed 0 to {len(frames) - 1} - the FIRST image is index 0, the SECOND image is index 1, and so on.

CRITICAL RULE: Base EVERYTHING below on what is ACTUALLY VISIBLE in these frames - the real subject, setting, people, actions, mood, lighting, etc. The creator gave a TOPIC label of "{topic}", but do NOT assume the video matches that topic, and do NOT invent content that is not shown. If the footage does not match the topic, say so plainly and judge it as what it actually is.

Steps:
1. "video_summary" - In 1-2 plain sentences, describe what is ACTUALLY happening in this video based on the frames (subject, setting, action). Be concrete and literal, not aspirational.
2. For EACH of the {len(frames)} images, give a 0-10 score, short feedback, and one concrete suggested fix - all grounded in what that specific frame shows (e.g. "add a bold text overlay here", "too dark - brighten this shot", "weak hook - open with a bold claim or question", "strong thumbnail candidate").
3. Give an overall verdict for the video (pacing, hook, visual quality - platform-agnostic), pick the single best image for a thumbnail, and list 3 key improvements that apply regardless of platform.
4. For EACH of these platforms - {", ".join(PLATFORMS)} - judge how well THIS SAME VIDEO (the actual footage described in video_summary) fits that platform (aspect ratio/format expectations, ideal length, hook style, CTA conventions, audience tone). Give a punchy one-sentence headline describing THIS footage on that platform, 2-3 concrete observations about the actual content, and one specific recommendation for editing/captioning/repositioning it for that platform's audience. If relevant, the recommendation can suggest how to tie it back to {BRAND_PROFILE['name']}'s angle - but only as a suggestion, not as a description of what is already in the video.

Return ONLY valid JSON, no extra text, in this exact shape:
{{
  "video_summary": "<1-2 sentences, literal description of what is actually shown>",
  "frames": [
    {{ "index": 0, "score": <0-10>, "feedback": "...", "suggestion": "..." }}
  ],
  "best_thumbnail_index": <the "index" value of the best image, between 0 and {len(frames) - 1}>,
  "overall_verdict": "<2-3 sentences>",
  "key_improvements": ["...", "...", "..."],
  "platforms": {{
    "instagram": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "tiktok": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "twitter": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "youtube": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "linkedin": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "facebook": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }}
  }}
}}

IMPORTANT: "frames" must contain exactly {len(frames)} entries, with "index" values 0 through {len(frames) - 1} in order. "best_thumbnail_index" must be one of those index values. "platforms" must contain all 6 platforms listed above.
"""

    content = [{"type": "text", "text": prompt_text}]
    for frame in frames:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{frame['b64']}"},
            }
        )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=2500,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": content}],
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)

    result_frames = result.get("frames", [])
    for i, frame in enumerate(frames):
        if i < len(result_frames):
            result_frames[i]["index"] = i
            result_frames[i]["timestamp"] = frame["timestamp"]
            result_frames[i]["thumbnail"] = f"data:image/jpeg;base64,{frame['b64']}"

    best_idx = result.get("best_thumbnail_index")
    if not isinstance(best_idx, int) or not (0 <= best_idx < len(result_frames)):
        if result_frames:
            result["best_thumbnail_index"] = max(
                range(len(result_frames)),
                key=lambda i: result_frames[i].get("score", 0),
            )

    result["metadata"] = metadata
    result["warnings"] = warnings
    return result


def analyze_image(image_path: str, topic: str = "science innovation"):
    """Score a single image / poster before it goes live — same vision model as
    analyze_video, minus the frame sampling."""
    img = cv2.imread(image_path)
    if img is None:
        return {"error": "Could not read this image"}

    h, w = img.shape[:2]
    if w > MAX_WIDTH:
        scale = MAX_WIDTH / w
        img = cv2.resize(img, (MAX_WIDTH, int(h * scale)))
    _, buffer = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
    b64 = base64.b64encode(buffer).decode("utf-8")

    prompt_text = f"""
You are a social media creative strategist. A creator on the {BRAND_PROFILE['name']} team ({BRAND_PROFILE['description']}, posting to {BRAND_PROFILE['audience_note']}) is testing whether THIS SPECIFIC IMAGE is ready to post.

The image is attached below. The creator gave a TOPIC label of "{topic}".

CRITICAL RULE: Base EVERYTHING on what is ACTUALLY VISIBLE in the image — the real subject, text, colors, composition, lighting, branding. Do NOT assume the image matches the topic, and do NOT invent content that isn't shown. If it doesn't match the topic, say so plainly and judge it as what it actually is.

Steps:
1. "image_summary" — 1-2 plain, literal sentences describing what is ACTUALLY in the image.
2. Score it 0-20 on each of: visual_hook (does it stop the scroll?), composition (framing, balance, focal point), text_readability (is any text legible and well-placed? if no text, judge whether it needs some), brand_fit (does it suit {BRAND_PROFILE['name']}'s science/innovation identity?), platform_readiness (is it crop/format ready for social?). Set overall_score 0-100.
3. List concrete strengths, weaknesses, and 3 specific suggested fixes grounded in what the image shows.
4. For EACH of these platforms — {", ".join(PLATFORMS)} — judge how well THIS image fits (aspect ratio/format, text-overlay norms, audience tone). Give a punchy one-sentence headline about THIS image on that platform, 2-3 concrete observations, and one specific recommendation.

Return ONLY valid JSON, no extra text, in this exact shape:
{{
  "image_summary": "<1-2 sentences, literal>",
  "overall_score": <0-100>,
  "scores": {{
    "visual_hook": <0-20>,
    "composition": <0-20>,
    "text_readability": <0-20>,
    "brand_fit": <0-20>,
    "platform_readiness": <0-20>
  }},
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "suggestions": ["...", "...", "..."],
  "platforms": {{
    "instagram": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "tiktok": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "twitter": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "youtube": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "linkedin": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "facebook": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }}
  }}
}}

IMPORTANT: "platforms" must contain all 6 platforms listed above.
"""

    content = [
        {"type": "text", "text": prompt_text},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
    ]

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=1500,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": content}]
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)
def _enrich_metadata_with_ffprobe(video_path: Path, metadata: dict[str, Any]) -> list[str]:
    warnings: list[str] = []

    try:
        probe_data = _ffprobe_video(video_path)
    except FileNotFoundError:
        return ["ffprobe is not installed; OpenCV metadata was used as the fallback source."]
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or exc.stdout or str(exc)).strip()
        return [f"ffprobe failed while probing the uploaded video: {message or 'unknown error'}"]
    except Exception as exc:
        return [f"ffprobe metadata enrichment failed: {exc}"]

    video_stream = next(
        (stream for stream in probe_data.get("streams", []) if stream.get("codec_type") == "video"),
        {},
    )
    audio_stream = next(
        (stream for stream in probe_data.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )

    width = _to_int(video_stream.get("width"))
    height = _to_int(video_stream.get("height"))
    duration = (
        round(
            _to_float(probe_data.get("format", {}).get("duration"))
            or _to_float(video_stream.get("duration")),
            2,
        )
        or None
    )
    fps = round(_parse_fps(video_stream.get("avg_frame_rate")), 2) or None

    if metadata.get("duration_seconds") is None and duration is not None:
        metadata["duration_seconds"] = duration
    if metadata.get("width") is None and width is not None:
        metadata["width"] = width
    if metadata.get("height") is None and height is not None:
        metadata["height"] = height
    if metadata.get("fps") is None and fps is not None:
        metadata["fps"] = fps
    if metadata.get("aspect_ratio") is None:
        metadata["aspect_ratio"] = _format_aspect_ratio(metadata.get("width"), metadata.get("height"))
    if metadata.get("orientation") is None:
        metadata["orientation"] = _get_orientation(metadata.get("width"), metadata.get("height"))
    if metadata.get("has_audio") is None:
        metadata["has_audio"] = audio_stream is not None

    if audio_stream is None:
        warnings.append("ffprobe did not find an audio stream in the uploaded video.")

    return warnings


def _ffprobe_video(video_path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    return json.loads(result.stdout or "{}")


def _format_aspect_ratio(width: Any, height: Any) -> str | None:
    width_int = _to_int(width)
    height_int = _to_int(height)
    if width_int <= 0 or height_int <= 0:
        return None
    ratio_gcd = math.gcd(width_int, height_int)
    return f"{width_int // ratio_gcd}:{height_int // ratio_gcd}"


def _get_orientation(width: Any, height: Any) -> str | None:
    width_int = _to_int(width)
    height_int = _to_int(height)
    if width_int <= 0 or height_int <= 0:
        return None
    if width_int == height_int:
        return "square"
    if height_int > width_int:
        return "portrait"
    return "landscape"


def _safe_positive_int(value: Any) -> int | None:
    parsed = _to_int(value)
    return parsed if parsed > 0 else None


def _safe_positive_float(value: Any) -> float | None:
    parsed = _to_float(value)
    return parsed if parsed > 0 else None


def _to_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_fps(value: Any) -> float:
    text = str(value or "0").strip()
    if not text or text == "0/0":
        return 0.0
    if "/" in text:
        numerator, denominator = text.split("/", 1)
        denominator_value = _to_float(denominator)
        if denominator_value == 0:
            return 0.0
        return _to_float(numerator) / denominator_value
    return _to_float(text)


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def _build_sample_timestamps(
    duration_seconds: float | None,
    fps: float,
    total_frames: int,
    max_frames: int,
) -> list[float]:
    if duration_seconds is None or duration_seconds <= 0:
        frame_span_seconds = total_frames / fps if fps > 0 else 0
        duration_seconds = frame_span_seconds

    if duration_seconds <= 0:
        return [0.0]

    timestamps: list[float] = [0.0]
    next_timestamp = FRAME_SAMPLE_SECONDS

    while next_timestamp < duration_seconds and len(timestamps) < max_frames:
        timestamps.append(round(next_timestamp, 2))
        next_timestamp += FRAME_SAMPLE_SECONDS

    tail_timestamp = max(duration_seconds - 0.1, 0.0)
    if len(timestamps) < max_frames and abs(timestamps[-1] - tail_timestamp) > 1.0:
        timestamps.append(round(tail_timestamp, 2))

    return timestamps[:max_frames]
