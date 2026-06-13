import json
import os
import re
from typing import Any

import requests
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

MUSIC_MATCH_MODEL = os.getenv("OPENAI_MUSIC_MATCH_MODEL", "gpt-4o-mini")
JAMENDO_TRACKS_URL = "https://api.jamendo.com/v3.0/tracks/"

SUPPORTED_MOODS = {
    "inspiring",
    "energetic",
    "emotional",
    "dramatic",
    "futuristic",
    "calm",
    "corporate",
    "motivational",
}

MOOD_TAGS = {
    "inspiring": "inspirational,uplifting",
    "energetic": "upbeat,energetic",
    "emotional": "emotional,piano",
    "dramatic": "cinematic,dramatic",
    "futuristic": "electronic,technology",
    "calm": "ambient,chill",
    "corporate": "corporate,presentation",
    "motivational": "motivational,inspiring",
}


def recommend_music(
    transcript: str | dict[str, Any] | None,
    metadata: dict[str, Any] | None,
    target_platform: str = "instagram",
    mood: str | None = None,
) -> dict[str, Any]:
    warnings: list[str] = []
    safe_metadata = metadata if isinstance(metadata, dict) else {}
    transcript_text = _extract_transcript_text(transcript)

    if mood:
        detected_mood = _normalize_mood(mood)
        confidence = 1.0 if detected_mood == mood.strip().lower() else 0.65
        reason = "User-selected mood."
    else:
        mood_result = _classify_mood(transcript_text, safe_metadata, target_platform)
        detected_mood = mood_result["mood"]
        confidence = mood_result["confidence"]
        reason = mood_result["reason"]
        warnings.extend(mood_result.get("warnings", []))

    tags = MOOD_TAGS.get(detected_mood, MOOD_TAGS["inspiring"])
    client_id = os.getenv("JAMENDO_CLIENT_ID", "").strip()

    if not client_id:
        warnings.append("Jamendo API key not configured.")
        return {
            "mood": detected_mood,
            "confidence": confidence,
            "mood_reason": reason,
            "tags": tags,
            "tracks": [],
            "warnings": warnings,
            "jamendo_configured": False,
            "music_mixing_available": False,
        }

    try:
        tracks = _search_jamendo_tracks(client_id, tags)
    except Exception as exc:
        warnings.append(f"Jamendo request failed: {exc}")
        tracks = []

    return {
        "mood": detected_mood,
        "confidence": confidence,
        "mood_reason": reason,
        "tags": tags,
        "tracks": tracks,
        "warnings": warnings,
        "jamendo_configured": True,
        "music_mixing_available": False,
    }


def _classify_mood(
    transcript_text: str,
    metadata: dict[str, Any],
    target_platform: str,
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        mood = _heuristic_mood(transcript_text, metadata)
        return {
            "mood": mood,
            "confidence": 0.45,
            "reason": "OpenAI mood classification unavailable; used keyword and metadata fallback.",
            "warnings": ["OpenAI mood classification unavailable; used fallback mood detection."],
        }

    prompt = f"""
Classify the best music mood for a social video.

Return JSON only:
{{
  "mood": "inspiring|energetic|emotional|dramatic|futuristic|calm|corporate|motivational",
  "confidence": 0.0,
  "reason": "short reason"
}}

Rules:
1. Choose exactly one mood from the allowed list.
2. Confidence must be 0.0 to 1.0.
3. Prefer the transcript when available.
4. Use metadata and platform only as supporting context.

Target platform: {target_platform}
Metadata:
{json.dumps(metadata, indent=2)}

Transcript:
{transcript_text or "No transcript available."}
"""

    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=MUSIC_MATCH_MODEL,
            response_format={"type": "json_object"},
            max_tokens=250,
            messages=[
                {"role": "system", "content": "Return JSON only."},
                {"role": "user", "content": prompt},
            ],
        )
        content = (response.choices[0].message.content or "").strip()
        payload = json.loads(content.replace("```json", "").replace("```", "").strip())
        mood = _normalize_mood(str(payload.get("mood", "")))
        confidence = _clamp_float(payload.get("confidence"), 0.0, 1.0, 0.65)
        return {
            "mood": mood,
            "confidence": confidence,
            "reason": str(payload.get("reason") or "Mood classified from available video evidence."),
            "warnings": [],
        }
    except Exception as exc:
        mood = _heuristic_mood(transcript_text, metadata)
        return {
            "mood": mood,
            "confidence": 0.45,
            "reason": "OpenAI mood classification failed; used keyword and metadata fallback.",
            "warnings": [f"OpenAI mood classification failed: {exc}"],
        }


def _search_jamendo_tracks(client_id: str, tags: str) -> list[dict[str, Any]]:
    response = requests.get(
        JAMENDO_TRACKS_URL,
        params={
            "client_id": client_id,
            "format": "json",
            "limit": 8,
            "include": "musicinfo",
            "audioformat": "mp32",
            "tags": tags,
            "order": "popularity_total",
        },
        timeout=12,
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else []
    if not isinstance(results, list):
        return []
    return [_normalize_track(track) for track in results]


def _normalize_track(track: dict[str, Any]) -> dict[str, Any]:
    musicinfo = track.get("musicinfo") if isinstance(track.get("musicinfo"), dict) else {}
    license_info = (
        track.get("license_ccurl")
        or musicinfo.get("license_ccurl")
        or track.get("licenses")
        or ""
    )
    return {
        "id": str(track.get("id", "")),
        "title": track.get("name") or "Untitled track",
        "artist": track.get("artist_name") or "Unknown artist",
        "album": track.get("album_name") or "",
        "duration": _to_int(track.get("duration")),
        "image": track.get("image") or track.get("album_image") or "",
        "preview_audio_url": track.get("audio") or track.get("audiodownload") or "",
        "download_url": track.get("audiodownload") if track.get("audiodownload_allowed") else "",
        "license": license_info,
    }


def _extract_transcript_text(transcript: str | dict[str, Any] | None) -> str:
    if isinstance(transcript, str):
        return transcript.strip()
    if not isinstance(transcript, dict):
        return ""
    if transcript.get("text"):
        return str(transcript.get("text", "")).strip()
    segments = transcript.get("segments")
    if isinstance(segments, list):
        return " ".join(str(segment.get("text", "")).strip() for segment in segments if isinstance(segment, dict)).strip()
    return ""


def _normalize_mood(value: str) -> str:
    normalized = re.sub(r"[^a-z]", "", str(value or "").lower())
    return normalized if normalized in SUPPORTED_MOODS else "inspiring"


def _heuristic_mood(transcript_text: str, metadata: dict[str, Any]) -> str:
    text = transcript_text.lower()
    if any(word in text for word in ("future", "technology", "ai", "robot", "innovation")):
        return "futuristic"
    if any(word in text for word in ("win", "achieve", "dream", "believe", "breakthrough")):
        return "motivational"
    if any(word in text for word in ("sad", "heart", "feel", "truth", "alone")):
        return "emotional"
    if any(word in text for word in ("urgent", "battle", "risk", "danger", "dramatic")):
        return "dramatic"
    duration = _to_float(metadata.get("duration_seconds"))
    fps = _to_float(metadata.get("fps"))
    if duration and duration <= 30 and fps and fps >= 24:
        return "energetic"
    return "inspiring"


def _clamp_float(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0
