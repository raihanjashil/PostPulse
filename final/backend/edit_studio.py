import json
import os
import re
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

CHAT_EDIT_MODEL = os.getenv("OPENAI_VIDEO_EDIT_MODEL", "gpt-4o-mini")
SUPPORTED_CHAT_COMMANDS = {
    "cut",
    "text_overlay",
    "cta_overlay",
    "subtitle",
    "resize",
    "crop",
    "volume_adjust",
    "mute",
}
PLATFORM_ALIASES = {
    "instagram": "instagram",
    "ig": "instagram",
    "tiktok": "tiktok",
    "tik tok": "tiktok",
    "youtube": "youtube",
    "yt": "youtube",
    "linkedin": "linkedin",
    "facebook": "facebook",
    "fb": "facebook",
    "twitter": "twitter",
    "x": "twitter",
}


def plan_chat_edit(
    user_instruction: str,
    metadata: dict[str, Any],
    current_edit_history: list[dict[str, Any]] | None,
    target_platform: str,
    current_version: str | None = None,
) -> dict[str, Any]:
    instruction = str(user_instruction or "").strip()
    if not instruction:
        raise ValueError("A user instruction is required.")

    conversation_reply = _conversation_reply(instruction)
    if conversation_reply:
        return conversation_reply

    payload: dict[str, Any]
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            payload = _plan_with_openai(
                api_key=api_key,
                user_instruction=instruction,
                metadata=metadata,
                current_edit_history=current_edit_history or [],
                target_platform=target_platform,
                current_version=current_version,
            )
        except Exception:
            payload = _fallback_plan(instruction, metadata, target_platform)
    else:
        payload = _fallback_plan(instruction, metadata, target_platform)

    return _normalize_plan(payload, metadata, target_platform)


def _conversation_reply(user_instruction: str) -> dict[str, Any] | None:
    normalized = re.sub(r"\s+", " ", user_instruction.strip().lower())
    stripped = re.sub(r"[^\w\s?]", "", normalized).strip()

    greetings = {
        "hi",
        "hello",
        "hey",
        "yo",
        "salam",
        "assalamualaikum",
        "assalamu alaikum",
        "good morning",
        "good afternoon",
        "good evening",
    }
    if stripped in greetings:
        return _conversation_only(
            "Hello. I can help edit this video. Try asking me to cut a timestamp range, add text, crop for a platform, add subtitles, or adjust audio."
        )

    thanks = {"thanks", "thank you", "thx", "ok thanks", "okay thanks"}
    if stripped in thanks:
        return _conversation_only("You're welcome. Send me the next video edit you want to make.")

    help_patterns = (
        "what can you do",
        "help",
        "how do i",
        "how can i",
        "what edits",
        "examples",
        "commands",
    )
    if any(pattern in stripped for pattern in help_patterns):
        return _conversation_only(
            "I can help with video edits like cutting sections, adding overlay text, adding subtitles, cropping or resizing for a platform, muting, and changing volume."
        )

    video_question_words = (
        "video",
        "clip",
        "edit",
        "cut",
        "crop",
        "resize",
        "subtitle",
        "caption",
        "overlay",
        "text",
        "audio",
        "sound",
        "volume",
        "timeline",
        "timestamp",
        "platform",
        "tiktok",
        "instagram",
        "youtube",
        "linkedin",
        "facebook",
    )
    if "?" in normalized and any(word in normalized for word in video_question_words):
        return _conversation_only(
            "Yes, I can help with that video edit. Tell me the timestamp, text, platform, or audio change you want."
        )

    edit_words = set(video_question_words)
    if not any(word in normalized for word in edit_words):
        return _conversation_only(
            "Sorry, I can only help with questions and edits related to this video. Ask me to cut, crop, resize, add text, add subtitles, or adjust audio."
        )

    return None


def _conversation_only(message: str) -> dict[str, Any]:
    return {
        "needs_clarification": True,
        "conversation_only": True,
        "question": "",
        "assistant_response": message,
        "edit_commands": [],
    }


def _plan_with_openai(
    api_key: str,
    user_instruction: str,
    metadata: dict[str, Any],
    current_edit_history: list[dict[str, Any]],
    target_platform: str,
    current_version: str | None,
) -> dict[str, Any]:
    client = OpenAI(api_key=api_key)
    prompt = f"""
You convert natural-language video editing requests into strict JSON edit commands.

Return valid JSON only using this exact schema:
{{
  "needs_clarification": true,
  "question": "",
  "assistant_response": "",
  "edit_commands": [
    {{
      "type": "cut|text_overlay|cta_overlay|subtitle|resize|crop|volume_adjust|mute",
      "start": 0,
      "end": 0,
      "text": "",
      "reason": "",
      "platform": "",
      "value": 1.0
    }}
  ]
}}

Rules:
1. Supported commands only: cut, text_overlay, cta_overlay, subtitle, resize, crop, volume_adjust, mute.
2. If the instruction is unclear, set "needs_clarification" to true, ask one short question, and return an empty "edit_commands" array.
3. If the instruction is clear, set "needs_clarification" to false and return one or more edit commands.
4. Do not include free-form actions outside JSON.
5. Keep "assistant_response" short and useful.
6. Use seconds for start/end.
7. For resize or crop, set "platform" to the requested platform when possible. Use crop when the user asks to fill the frame or remove side/background padding.
8. For volume_adjust, set "value" to a reasonable multiplier such as 1.25 or 0.8.
9. If the user asks for text but does not provide the exact wording, leave "text" empty unless the instruction clearly implies a generic CTA or hook.

Current target platform: {target_platform}
Current version: {current_version or "edited_v1.mp4"}

Video metadata:
{json.dumps(metadata, indent=2)}

Current edit history:
{json.dumps(current_edit_history, indent=2)}

User instruction:
{user_instruction}
"""

    response = client.chat.completions.create(
        model=CHAT_EDIT_MODEL,
        response_format={"type": "json_object"},
        max_tokens=700,
        messages=[
            {"role": "system", "content": "Return JSON only."},
            {"role": "user", "content": prompt},
        ],
    )

    content = (response.choices[0].message.content or "").strip()
    return json.loads(content.replace("```json", "").replace("```", "").strip())


def _fallback_plan(user_instruction: str, metadata: dict[str, Any], target_platform: str) -> dict[str, Any]:
    duration = max(_to_float(metadata.get("duration_seconds")), 1.0)
    normalized = user_instruction.strip()
    lowered = normalized.lower()

    cut_match = re.search(
        r"(?:cut|trim|remove)\s+(?:from\s+)?(?P<start>\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?)\s+(?:to|until|-)\s+(?P<end>\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?)",
        lowered,
    )
    if cut_match:
        start = _parse_time_token(cut_match.group("start"))
        end = _parse_time_token(cut_match.group("end"))
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can remove that time range and render a new version.",
            "edit_commands": [
                {
                    "type": "cut",
                    "start": start,
                    "end": end,
                    "text": "",
                    "reason": "User asked to remove this section.",
                    "platform": "",
                    "value": 1.0,
                }
            ],
        }

    text_match = re.search(
        r"(?:add|show)\s+text(?:\s+at\s+(?P<time>\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?))?.*?(?:saying|that says|with)\s+(?P<text>.+)$",
        normalized,
        flags=re.IGNORECASE,
    )
    if text_match:
        start = _parse_time_token(text_match.group("time")) if text_match.group("time") else 0.0
        text = text_match.group("text").strip().strip('"').strip("'")
        end = min(duration, start + 4.0)
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can place that text overlay into the next version.",
            "edit_commands": [
                {
                    "type": "text_overlay",
                    "start": start,
                    "end": end,
                    "text": text,
                    "reason": "User requested a text overlay.",
                    "platform": "",
                    "value": 1.0,
                }
            ],
        }

    if "hook text" in lowered and ("beginning" in lowered or "start" in lowered or "opening" in lowered):
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can add a hook overlay at the opening of the clip.",
            "edit_commands": [
                {
                    "type": "text_overlay",
                    "start": 0.0,
                    "end": min(duration, 4.0),
                    "text": "",
                    "reason": "User asked for a hook text treatment at the beginning.",
                    "platform": "",
                    "value": 1.0,
                }
            ],
        }

    if "cta" in lowered and ("end" in lowered or "ending" in lowered or "last" in lowered):
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can add a CTA overlay near the ending of the clip.",
            "edit_commands": [
                {
                    "type": "cta_overlay",
                    "start": max(0.0, duration - 4.0),
                    "end": duration,
                    "text": "",
                    "reason": "User asked for a CTA at the end.",
                    "platform": "",
                    "value": 1.0,
                }
            ],
        }

    if "subtitle" in lowered:
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can enable subtitle treatment for the next version.",
            "edit_commands": [
                {
                    "type": "subtitle",
                    "start": 0.0,
                    "end": duration,
                    "text": "",
                    "reason": "User asked for subtitles.",
                    "platform": "",
                    "value": 1.0,
                }
            ],
        }

    for alias, platform in PLATFORM_ALIASES.items():
        if alias in lowered and ("resize" in lowered or "crop" in lowered):
            edit_type = "crop" if "crop" in lowered else "resize"
            return {
                "needs_clarification": False,
                "question": "",
                "assistant_response": f"I can {edit_type} the render for {platform}.",
                "edit_commands": [
                    {
                        "type": edit_type,
                        "start": 0.0,
                        "end": duration,
                        "text": "",
                        "reason": f"User requested a {edit_type} for {platform}.",
                        "platform": platform,
                        "value": 1.0,
                    }
                ],
            }

    if "crop" in lowered:
        platform = PLATFORM_ALIASES.get(target_platform, target_platform)
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": f"I can crop the render for {platform}.",
            "edit_commands": [
                {
                    "type": "crop",
                    "start": 0.0,
                    "end": duration,
                    "text": "",
                    "reason": f"User requested a crop for {platform}.",
                    "platform": platform,
                    "value": 1.0,
                }
            ],
        }

    if "mute" in lowered:
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can mute the audio in the next version.",
            "edit_commands": [
                {
                    "type": "mute",
                    "start": 0.0,
                    "end": duration,
                    "text": "",
                    "reason": "User requested muted audio.",
                    "platform": "",
                    "value": 0.0,
                }
            ],
        }

    if "volume" in lowered or "audio" in lowered:
        multiplier = 1.25 if any(token in lowered for token in ("increase", "boost", "raise", "louder")) else 0.8
        return {
            "needs_clarification": False,
            "question": "",
            "assistant_response": "I can adjust the audio level in the next version.",
            "edit_commands": [
                {
                    "type": "volume_adjust",
                    "start": 0.0,
                    "end": duration,
                    "text": "",
                    "reason": "User requested an audio level adjustment.",
                    "platform": "",
                    "value": multiplier,
                }
            ],
        }

    return {
        "needs_clarification": True,
        "question": "What timestamp or area of the video should I apply this edit to?",
        "assistant_response": "I need one more detail before I can turn that into a valid edit command.",
        "edit_commands": [],
    }


def _normalize_plan(payload: dict[str, Any], metadata: dict[str, Any], target_platform: str) -> dict[str, Any]:
    if bool(payload.get("needs_clarification")):
        question = str(payload.get("question") or "").strip() or "What timestamp should I apply this edit to?"
        return {
            "needs_clarification": True,
            "question": question,
            "assistant_response": str(payload.get("assistant_response") or question).strip(),
            "edit_commands": [],
        }

    duration = _to_float(metadata.get("duration_seconds"))
    normalized_commands = [_normalize_command(item, duration, target_platform) for item in payload.get("edit_commands", [])]
    if not normalized_commands:
        return {
            "needs_clarification": True,
            "question": "What exact edit should I apply to the video?",
            "assistant_response": "I could not derive a valid edit command from that request yet.",
            "edit_commands": [],
        }

    return {
        "needs_clarification": False,
        "question": "",
        "assistant_response": str(payload.get("assistant_response") or "I can apply that edit and render a new version.").strip(),
        "edit_commands": normalized_commands,
    }


def _normalize_command(command: Any, duration: float, target_platform: str) -> dict[str, Any]:
    if not isinstance(command, dict):
        raise ValueError("Invalid edit command payload.")

    edit_type = str(command.get("type") or "").strip().lower()
    if edit_type not in SUPPORTED_CHAT_COMMANDS:
        raise ValueError(f"Unsupported edit command: {edit_type or 'unknown'}")

    start = max(0.0, _to_float(command.get("start")))
    end = max(start, _to_float(command.get("end")))
    if duration > 0:
        start = min(start, duration)
        end = min(end, duration)

    if edit_type == "cut" and end <= start:
        raise ValueError("Cut edits require an end timestamp after the start timestamp.")

    platform = str(command.get("platform") or "").strip().lower()
    if edit_type in {"resize", "crop"}:
        platform = PLATFORM_ALIASES.get(platform, platform or target_platform)
        if platform not in PLATFORM_ALIASES.values():
            raise ValueError("Resize and crop edits require a supported target platform.")

    value = _to_float(command.get("value"))
    if edit_type == "volume_adjust":
        value = value or 1.0
        if value <= 0:
            raise ValueError("Volume adjustment must be greater than zero.")
    elif edit_type == "mute":
        value = 0.0
    else:
        value = value or 1.0

    text = str(command.get("text") or "").strip()
    reason = str(command.get("reason") or "").strip() or "User requested this edit."

    return {
        "type": edit_type,
        "start": round(start, 2),
        "end": round(end, 2),
        "text": text,
        "reason": reason,
        "platform": platform,
        "value": round(value, 3),
    }


def _parse_time_token(token: str | None) -> float:
    raw = str(token or "").strip()
    if not raw:
        return 0.0
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return float(raw)

    parts = [int(part) for part in raw.split(":")]
    seconds = 0
    for part in parts:
        seconds = (seconds * 60) + part
    return float(seconds)


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
