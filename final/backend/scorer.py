import os
import json
from openai import OpenAI
from dotenv import load_dotenv
from data_layer import get_platform_data, get_user_platform_data, hard_rules_check, OPTIMAL_POSTING_TIMES
from brand_config import BRAND_PROFILE

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"]

def score_post(
    draft: str,
    platform: str,
    topic: str = "science innovation",
    media_type: str = "text",
    user_data: dict = None,
):
    # 1. Hard rules
    flags = hard_rules_check(draft, platform, media_type)

    # 2. Real data — user's own data takes priority over SoS benchmark
    if user_data and user_data.get("top_posts") is not None:
        top_posts    = user_data["top_posts"]
        avg_likes    = user_data["avg_likes"]
        avg_comments = user_data["avg_comments"]
        data_source  = user_data.get("username") or "your account"
    else:
        top_posts, avg_likes, avg_comments = get_platform_data(platform)
        data_source = "Stars of Science"

    timing = OPTIMAL_POSTING_TIMES.get(platform, {})

    # 3. Build prompt with real context
    media_label = {
        "text": "Text only (no media)",
        "image": "Single image",
        "video": "Video",
        "carousel": "Carousel / multi-image / Reel"
    }.get(media_type, media_type)

    prompt = f"""
You are an expert social media strategist for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}. They post to {BRAND_PROFILE['audience_note']}.

PLATFORM: {platform.upper()}
TOPIC: {topic}
POST MEDIA TYPE: {media_label}

REAL PERFORMANCE BENCHMARKS from {data_source}'s actual {platform} account:
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

Also decode the {platform} algorithm for this specific post, and rewrite it for three different MENA/GCC regions & audiences.

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
  "hashtag_suggestions": ["#tag1", "#tag2", "#tag3"],
  "algorithm_decoder": {{
    "verdict": "<1 sentence: will {platform}'s algorithm distribute or suppress THIS post, and why>",
    "signals": [
      {{"name": "<the 3-4 ranking signals {platform} cares about most, e.g. watch-through rate, saves & shares, reply velocity, dwell time, CTR>", "status": "strong|average|weak", "note": "<1 sentence: how THIS draft performs on this signal>"}}
    ]
  }},
  "audience_variants": [
    {{"region": "🇶🇦🇦🇪 Qatar & UAE", "audience": "Gulf Youth (18-24)", "rewritten": "<rewrite tailored to this region/audience, with light local flavor>", "rationale": "<1 sentence why this works for them>"}},
    {{"region": "🇸🇦 Saudi Arabia", "audience": "STEM Students & Young Professionals", "rewritten": "<rewrite tailored to this region/audience, with light local flavor>", "rationale": "<1 sentence why this works for them>"}},
    {{"region": "🇪🇬 Egypt & Levant", "audience": "Parents & Educators", "rewritten": "<rewrite tailored to this region/audience, with light local flavor>", "rationale": "<1 sentence why this works for them>"}}
  ]
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=2000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)

    comment_rate = round((avg_comments / avg_likes) * 100, 2) if avg_likes > 0 else 0
    if comment_rate >= 5:
        engagement_quality = "high"
    elif comment_rate >= 1:
        engagement_quality = "medium"
    else:
        engagement_quality = "low"

    result["_benchmark"] = {
        "avg_likes": avg_likes,
        "avg_comments": avg_comments,
        "comment_rate": comment_rate,
        "engagement_quality": engagement_quality,
        "top_post_likes": top_posts[0]["likes"] if top_posts else 0,
        "top_post_caption": (top_posts[0].get("caption", "")[:80] + "...") if top_posts else "",
        "post_count": len(top_posts),
    }

    return result


def score_all_platforms(
    draft: str,
    topic: str = "science innovation",
    media_type: str = "text",
    session_id: str = None,
):
    import sessions as sessions_module

    results = {}
    for platform in PLATFORMS:
        try:
            user_data = None
            if session_id:
                token = sessions_module.get_token(session_id, platform)
                if token:
                    top_posts, avg_likes, avg_comments = get_user_platform_data(platform, token)
                    ui = sessions_module.sessions.get(session_id, {}).get(platform, {}).get("user_info", {})
                    user_data = {
                        "top_posts": top_posts,
                        "avg_likes": avg_likes,
                        "avg_comments": avg_comments,
                        "username": ui.get("username") or ui.get("name", ""),
                    }
            results[platform] = score_post(draft, platform, topic, media_type, user_data=user_data)
        except Exception as e:
            results[platform] = {"error": str(e), "overall_score": 0}
    return results


def recommend_publishing(results: dict, benchmarks: dict, goal: str = "reach") -> dict:
    """
    Cross-platform Targeted Publishing recommendation: given the scored results
    for all platforms, pick where (and when) to publish for a given goal.
    goal: "reach" | "engagement" | "conversions"
    """
    ranked = [(p, d.get("overall_score", 0)) for p, d in results.items() if "error" not in d]
    if not ranked:
        return {}

    if goal == "engagement":
        quality_weight = {"high": 2, "medium": 1, "low": 0}
        ranked.sort(key=lambda x: (quality_weight.get(benchmarks.get(x[0], {}).get("engagement_quality", "low"), 0), x[1]), reverse=True)
    elif goal == "conversions":
        ranked.sort(key=lambda x: (results[x[0]].get("scores", {}).get("cta", 0), x[1]), reverse=True)
    else:  # reach
        ranked.sort(key=lambda x: (benchmarks.get(x[0], {}).get("avg_likes", 0), x[1]), reverse=True)

    top_platform, top_score = ranked[0]
    top_result = results[top_platform]
    top_bm = benchmarks.get(top_platform, {})

    rationale = f"For maximizing {goal}, {top_platform} is your best bet — it scored {top_score}/100 on this draft."
    if top_bm:
        rationale += f" Benchmark engagement quality: {top_bm.get('engagement_quality', 'unknown')} ({top_bm.get('comment_rate', 0)} comments per 100 likes)."

    return {
        "goal": goal,
        "recommended_platform": top_platform,
        "recommended_score": top_score,
        "best_time_to_post": top_result.get("best_time_to_post"),
        "ranked_platforms": [p for p, _ in ranked],
        "rationale": rationale,
    }


def generate_account_insights():
    """Analyze real recent posts per platform and surface engagement patterns."""
    account_data = {}
    for platform in PLATFORMS:
        top_posts, avg_likes, avg_comments = get_platform_data(platform)
        account_data[platform] = {
            "avg_likes": avg_likes,
            "avg_comments": avg_comments,
            "top_posts": top_posts,
            "has_data": len(top_posts) > 0,
        }

    prompt = f"""
You are a social media analytics expert decoding the algorithm behavior for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}, posting to {BRAND_PROFILE['audience_note']}.

Below is REAL data pulled from their live accounts: average engagement per platform and their top 3 best-performing posts (with captions, likes, comments).

DATA:
{json.dumps(account_data, indent=2)}

For each platform that HAS real data (has_data: true), compare the top-performing posts against the account average and decode concrete patterns — e.g. caption length, tone, hashtag usage, topics, posting style — that correlate with higher engagement. Reference the ACTUAL captions/numbers in the data, not generic platform advice.

For platforms with NO data (has_data: false), say data wasn't available and give one general best-practice tip instead.

Return ONLY valid JSON, no extra text, in this exact shape:
{{
  "platforms": {{
    "instagram": {{
      "headline": "<one punchy sentence summarizing the #1 pattern>",
      "patterns": ["<concrete observation 1>", "<concrete observation 2>", "<concrete observation 3>"],
      "recommendation": "<one specific, actionable tip based on this data>"
    }},
    "tiktok": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "twitter": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "youtube": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "linkedin": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }},
    "facebook": {{ "headline": "...", "patterns": ["...", "...", "..."], "recommendation": "..." }}
  }},
  "overall_strategy": "<2-3 sentence cross-platform strategy synthesizing the strongest signal across all accounts>"
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=1500,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)
