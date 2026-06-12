import os
import json
from openai import OpenAI
from dotenv import load_dotenv
from data_layer import get_platform_data, hard_rules_check, OPTIMAL_POSTING_TIMES

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"]

def score_post(draft: str, platform: str, topic: str = "science innovation", media_type: str = "text"):
    # 1. Hard rules
    flags = hard_rules_check(draft, platform, media_type)

    # 2. Real data from RapidAPI
    top_posts, avg_likes, avg_comments = get_platform_data(platform)
    timing = OPTIMAL_POSTING_TIMES.get(platform, {})

    # 3. Build prompt with real context
    media_label = {
        "text": "Text only (no media)",
        "image": "Single image",
        "video": "Video",
        "carousel": "Carousel / multi-image / Reel"
    }.get(media_type, media_type)

    prompt = f"""
You are an expert social media strategist for Stars of Science — a MENA science innovation TV show based in Qatar.

PLATFORM: {platform.upper()}
TOPIC: {topic}
POST MEDIA TYPE: {media_label}

REAL PERFORMANCE BENCHMARKS from Stars of Science's actual {platform} account:
- Average likes per post: {avg_likes}
- Average comments per post: {avg_comments}
- Top 3 best performing posts: {json.dumps(top_posts, indent=2)}

POSTING STRATEGY for MENA audience:
- Best days: {timing.get('best_days', [])}
- Best hours (Gulf Standard Time): {timing.get('best_hours', [])}
- MENA insight: {timing.get('mena_note', '')}

PRE-PUBLISH FLAGS (rule-based): {flags if flags else "None"}

DRAFT TO SCORE:
\"\"\"{draft}\"\"\"

Score this draft on 5 dimensions (0-20 each):
1. Hook Strength — does the first line stop the scroll?
2. Copy Clarity — clear, punchy, not corporate-speak?
3. CTA Presence — is there a call to action right for this platform?
4. Format Fit — right length, hashtags, structure AND media type (text/image/video/carousel) for {platform}?
5. Tone Match — matches {platform} audience expectations?

Return ONLY valid JSON, no extra text:
{{
  "overall_score": <0-100>,
  "scores": {{
    "hook": <0-20>,
    "clarity": <0-20>,
    "cta": <0-20>,
    "format": <0-20>,
    "tone": <0-20>
  }},
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "rule_flags": {json.dumps(flags)},
  "rewritten": "<improved version of the post for {platform}>",
  "best_time_to_post": "<specific recommendation>",
  "hashtag_suggestions": ["#tag1", "#tag2", "#tag3"]
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=1000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.choices[0].message.content.strip()
    # Clean any accidental markdown
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def score_all_platforms(draft: str, topic: str = "science innovation", media_type: str = "text"):
    results = {}
    for platform in PLATFORMS:
        try:
            results[platform] = score_post(draft, platform, topic, media_type)
        except Exception as e:
            results[platform] = {"error": str(e), "overall_score": 0}
    return results
