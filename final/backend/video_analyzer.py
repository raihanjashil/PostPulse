import os
import json
import base64
import cv2
from openai import OpenAI
from dotenv import load_dotenv
from brand_config import BRAND_PROFILE

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

MAX_FRAMES = 8
MAX_WIDTH = 512
PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"]


def extract_frames(video_path: str, max_frames: int = MAX_FRAMES):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total_frames <= 0:
        cap.release()
        return []

    duration_sec = total_frames / fps
    num_frames = min(max_frames, max(1, total_frames))
    segment_duration = duration_sec / num_frames

    frames = []
    for i in range(num_frames):
        timestamp = i * segment_duration
        idx = min(total_frames - 1, int(timestamp * fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            continue
        h, w = frame.shape[:2]
        if w > MAX_WIDTH:
            scale = MAX_WIDTH / w
            frame = cv2.resize(frame, (MAX_WIDTH, int(h * scale)))
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        b64 = base64.b64encode(buffer).decode("utf-8")
        frames.append({"timestamp": round(timestamp, 1), "b64": b64})

    cap.release()
    return frames


def analyze_video(video_path: str, topic: str = "science innovation"):
    frames = extract_frames(video_path)
    if not frames:
        return {"error": "Could not extract frames from this video"}

    prompt_text = f"""
You are a social media video strategist. A creator on the {BRAND_PROFILE['name']} team ({BRAND_PROFILE['description']}, posting to {BRAND_PROFILE['audience_note']}) is testing whether THIS SPECIFIC VIDEO is worth posting.

Below are exactly {len(frames)} images, sampled in chronological order from the video. They are indexed 0 to {len(frames) - 1} — the FIRST image is index 0, the SECOND image is index 1, and so on.

CRITICAL RULE: Base EVERYTHING below on what is ACTUALLY VISIBLE in these frames — the real subject, setting, people, actions, mood, lighting, etc. The creator gave a TOPIC label of "{topic}", but do NOT assume the video matches that topic, and do NOT invent content that isn't shown. If the footage doesn't match the topic, say so plainly and judge it as what it actually is.

Steps:
1. "video_summary" — In 1-2 plain sentences, describe what is ACTUALLY happening in this video based on the frames (subject, setting, action). Be concrete and literal, not aspirational.
2. For EACH of the {len(frames)} images, give a 0-10 score, short feedback, and one concrete suggested fix — all grounded in what that specific frame shows (e.g. "add a bold text overlay here", "too dark — brighten this shot", "weak hook — open with a bold claim or question", "strong thumbnail candidate").
3. Give an overall verdict for the video (pacing, hook, visual quality — platform-agnostic), pick the single best image for a thumbnail, and list 3 key improvements that apply regardless of platform.
4. For EACH of these platforms — {", ".join(PLATFORMS)} — judge how well THIS SAME VIDEO (the actual footage described in video_summary) fits that platform (aspect ratio/format expectations, ideal length, hook style, CTA conventions, audience tone). Give a punchy one-sentence headline describing THIS footage on that platform, 2-3 concrete observations about the actual content, and one specific recommendation for editing/captioning/repositioning it for that platform's audience. If relevant, the recommendation can suggest how to tie it back to {BRAND_PROFILE['name']}'s angle — but only as a suggestion, not as a description of what's already in the video.

Return ONLY valid JSON, no extra text, in this exact shape:
{{
  "video_summary": "<1-2 sentences, literal description of what's actually shown>",
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
    for f in frames:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{f['b64']}"}
        })

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=2500,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": content}]
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)

    result_frames = result.get("frames", [])
    for i, f in enumerate(frames):
        if i < len(result_frames):
            result_frames[i]["index"] = i
            result_frames[i]["timestamp"] = f["timestamp"]
            result_frames[i]["thumbnail"] = f"data:image/jpeg;base64,{f['b64']}"

    # Guard against out-of-range thumbnail index from the model
    best_idx = result.get("best_thumbnail_index")
    if not isinstance(best_idx, int) or not (0 <= best_idx < len(result_frames)):
        if result_frames:
            result["best_thumbnail_index"] = max(
                range(len(result_frames)),
                key=lambda i: result_frames[i].get("score", 0)
            )

    return result
