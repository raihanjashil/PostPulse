import os
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from dotenv import load_dotenv
from data_layer import (
    get_platform_data, get_user_platform_data, hard_rules_check, OPTIMAL_POSTING_TIMES,
    get_account_stats, engagement_quality, INSIGHTS_PLATFORMS,
)
from brand_config import BRAND_PROFILE, PERSONAS

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "linkedin", "facebook"]

# Post Scorer only targets these platforms (the others are "Coming soon" in the UI)
SCORE_ALL_PLATFORMS = ["twitter", "linkedin", "facebook"]

ARABIC_RE = re.compile(r'[؀-ۿ]')

def score_post(
    draft: str,
    platform: str,
    topic: str = "science innovation",
    media_type: str = "text",
    user_data: dict = None,
    persona: str = "general",
):
    # 1. Hard rules
    flags = hard_rules_check(draft, platform, media_type)

    persona_info = PERSONAS.get(persona, PERSONAS["general"])
    is_arabic = bool(ARABIC_RE.search(draft))
    draft_lang, alt_lang = ("Arabic", "English") if is_arabic else ("English", "Arabic")

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
TARGET AUDIENCE: {persona_info['label']} — {persona_info['desc']}.
All scoring (especially Hook, CTA, Tone), the rewrite, the best posting time, the algorithm decoder, and the regional variants must be optimized for reaching and converting THIS audience.

LANGUAGE: The draft is written in {draft_lang}. The "rewritten" field and every audience variant's "rewritten" field MUST stay in {draft_lang}. ALSO provide "rewritten_alt" fields containing a culturally adapted {alt_lang} version of each rewrite (adapted for {alt_lang}-speaking MENA audiences — not a literal translation).

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
  "rewritten": "<improved version of the post for {platform}, in {draft_lang}>",
  "rewritten_alt": "<culturally adapted {alt_lang} version of the rewritten post>",
  "best_time_to_post": "<specific recommendation>",
  "hashtag_suggestions": ["#tag1", "#tag2", "#tag3"],
  "algorithm_decoder": {{
    "verdict": "<1 sentence: will {platform}'s algorithm distribute or suppress THIS post, and why>",
    "signals": [
      {{"name": "<the 3-4 ranking signals {platform} cares about most, e.g. watch-through rate, saves & shares, reply velocity, dwell time, CTR>", "status": "strong|average|weak", "note": "<1 sentence: how THIS draft performs on this signal>"}}
    ]
  }},
  "audience_variants": [
    {{"region": "🇶🇦🇦🇪 Qatar & UAE", "audience": "Gulf Youth (18-24)", "rewritten": "<rewrite tailored to this region/audience in {draft_lang}, with light local flavor>", "rewritten_alt": "<{alt_lang} version>", "rationale": "<1 sentence why this works for them>"}},
    {{"region": "🇸🇦 Saudi Arabia", "audience": "STEM Students & Young Professionals", "rewritten": "<rewrite tailored to this region/audience in {draft_lang}, with light local flavor>", "rewritten_alt": "<{alt_lang} version>", "rationale": "<1 sentence why this works for them>"}},
    {{"region": "🇪🇬 Egypt & Levant", "audience": "Parents & Educators", "rewritten": "<rewrite tailored to this region/audience in {draft_lang}, with light local flavor>", "rewritten_alt": "<{alt_lang} version>", "rationale": "<1 sentence why this works for them>"}}
  ]
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=3000,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}]
    )

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)

    result["draft_language"] = "ar" if is_arabic else "en"

    comment_rate, eng_quality = engagement_quality(platform, avg_likes, avg_comments)

    result["_benchmark"] = {
        "avg_likes": avg_likes,
        "avg_comments": avg_comments,
        "comment_rate": comment_rate,
        "engagement_quality": eng_quality,
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
    persona: str = "general",
):
    import sessions as sessions_module

    def _score_one(platform):
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
        return score_post(draft, platform, topic, media_type, user_data=user_data, persona=persona)

    # One OpenAI call per platform — run them concurrently so total wall time
    # is roughly one call instead of three.
    results = {}
    with ThreadPoolExecutor(max_workers=len(SCORE_ALL_PLATFORMS)) as ex:
        futures = {p: ex.submit(_score_one, p) for p in SCORE_ALL_PLATFORMS}
    for platform, fut in futures.items():
        try:
            results[platform] = fut.result()
        except Exception as e:
            results[platform] = {"error": str(e), "overall_score": 0}
    return results


def recommend_publishing(results: dict, benchmarks: dict, goal: str = "reach", persona: str = "general") -> dict:
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
    if persona != "general" and persona in PERSONAS:
        rationale += f" Recommendation tuned for {PERSONAS[persona]['label']}."

    return {
        "goal": goal,
        "recommended_platform": top_platform,
        "recommended_score": top_score,
        "best_time_to_post": top_result.get("best_time_to_post"),
        "ranked_platforms": [p for p, _ in ranked],
        "rationale": rationale,
    }


def _compact_account(stats: dict) -> dict:
    """Trim a get_account_stats() dict to just the real facts the model may cite.
    None-valued aggregates are dropped so the model never sees (and can't claim) them."""
    if not stats or not stats.get("has_data"):
        return {"has_data": False, "error": (stats or {}).get("error", "no data")}
    out = {
        "handle": stats.get("handle"),
        "followers": stats.get("follower_count"),
        "avg_likes": stats.get("avg_likes"),
        "avg_comments": stats.get("avg_comments"),
        "comment_rate_per_100_likes": stats.get("comment_rate"),
        "engagement_quality": stats.get("engagement_quality"),
        "engagement_rate_pct": stats.get("engagement_rate"),
        "avg_caption_length": stats.get("avg_caption_len"),
        "avg_hashtags_per_post": stats.get("avg_hashtags"),
        "avg_views": stats.get("avg_views"),
        "post_count": stats.get("post_count"),
        "top_posts": [
            {k: v for k, v in {
                "caption": tp.get("caption"),
                "likes": tp.get("likes"),
                "comments": tp.get("comments"),
                "views": tp.get("views"),
                "hashtags": tp.get("hashtags"),
            }.items() if v is not None}
            for tp in stats.get("top_posts", [])
        ],
    }
    return {k: v for k, v in out.items() if v is not None}


def _insight_for_platform(platform: str, sos: dict, competitor: dict) -> dict:
    """One grounded, per-platform AI analysis (SoS, plus competitor if provided)."""
    sos_has = bool(sos and sos.get("has_data"))
    comp_has = bool(competitor and competitor.get("has_data"))
    if not sos_has and not comp_has:
        reason = (sos or {}).get("error") or "no data available"
        return {
            "headline": f"No data for {platform} ({reason}).",
            "patterns": [],
            "recommendation": "Connect a working account/handle to analyze this platform.",
            "growth_verdict": "",
            "comparison": None,
            "no_data": True,
        }

    payload = {"sos": _compact_account(sos)}
    if competitor:
        payload["competitor"] = _compact_account(competitor)
    timing = OPTIMAL_POSTING_TIMES.get(platform, {})
    competitor_rule = (
        '- A competitor account IS included — give a direct, specific SoS-vs-competitor comparison for this platform.\n'
        if competitor else
        '- No competitor provided — set "comparison" to null.\n'
    )

    prompt = f"""You are a social-media analyst for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}. Audience: {BRAND_PROFILE['audience_note']}.

PLATFORM: {platform.upper()}
REAL DATA (these numbers are the ONLY facts you have — do not invent others):
{json.dumps(payload, indent=2, ensure_ascii=False)}

Benchmark posting windows for this platform (GST), context only: days {timing.get('best_days', [])}, hours {timing.get('best_hours', [])}.

RULES:
- Ground EVERY statement in the numbers/captions above and cite real figures.
- Do NOT mention posting cadence, frequency, or time-of-day — that data is not available here.
- Engagement honesty: many likes with a low comment_rate is shallow/vanity reach; a high comment_rate (and engagement_rate_pct if shown) means a real community.
{competitor_rule}
Return ONLY valid JSON:
{{
  "headline": "<one punchy, data-grounded sentence>",
  "patterns": ["<observation citing a real number or caption>", "<observation 2>", "<observation 3>"],
  "recommendation": "<one specific, actionable tip grounded in this data>",
  "growth_verdict": "<engaged community vs vanity reach — cite the actual comment_rate>",
  "comparison": "<one sentence comparing SoS vs the competitor on this platform, or null>"
}}
"""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=700,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        return json.loads(raw)
    except Exception as e:
        return {"error": f"analysis failed: {e}"}


def _synthesize_overview(accounts: dict) -> tuple:
    """Cross-platform overall_strategy + real_growth_summary from the SoS metrics.
    Deterministic fallback if the synthesis call fails."""
    facts = {}
    for platform, acc in accounts.items():
        sos = acc.get("sos") or {}
        if sos.get("has_data"):
            facts[platform] = {
                "avg_likes": sos.get("avg_likes"),
                "comment_rate": sos.get("comment_rate"),
                "engagement_quality": sos.get("engagement_quality"),
                "engagement_rate": sos.get("engagement_rate"),
            }
    if not facts:
        return (
            "No live account data was available to analyze.",
            "No data could be fetched, so real growth vs. vanity reach can't be assessed right now.",
        )
    try:
        prompt = f"""Given these REAL per-platform metrics for {BRAND_PROFILE['name']}:
{json.dumps(facts, indent=2)}
Return ONLY JSON, grounded strictly in these numbers:
{{"overall_strategy": "<2-3 sentences across platforms>", "real_growth_summary": "<2 sentences: where the engaged community really is vs where numbers are vanity reach, citing comment_rate / engagement_rate>"}}"""
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=400,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        j = json.loads(raw)
        return j.get("overall_strategy", ""), j.get("real_growth_summary", "")
    except Exception:
        rank = lambda kv: (kv[1].get("engagement_rate") or kv[1].get("comment_rate") or 0)
        best = max(facts.items(), key=rank)
        worst = min(facts.items(), key=rank)
        return (
            f"Concentrate effort where engagement is deepest — {best[0]} leads on real interaction.",
            f"{best[0]} shows the most genuine conversation, while {worst[0]}'s numbers look more like vanity reach.",
        )


def generate_account_insights(identifiers: dict = None):
    """Side-by-side Account Intelligence: for each platform, fetch Stars of Science and
    (if a handle was given) the competitor, then run grounded per-platform AI analysis.
    Fetches and AI calls run in parallel; failures isolate per platform."""
    identifiers = identifiers or {}

    # 1) Fetch SoS (+ competitor) per platform, all in parallel.
    fetch_jobs = {}  # (platform, role) -> (platform, identifier)
    for platform in INSIGHTS_PLATFORMS:
        fetch_jobs[(platform, "sos")] = (platform, None)
        handle = identifiers.get(platform)
        if handle:
            fetch_jobs[(platform, "competitor")] = (platform, handle)

    # Throttle concurrency — RapidAPI's free tier rate-limits per key, so a big
    # burst makes most fetches time out. 3 at a time is gentle; the TTL cache keeps
    # repeat loads fast. (The per-platform AI calls below hit OpenAI and stay parallel.)
    fetched = {}
    with ThreadPoolExecutor(max_workers=3) as ex:
        future_to_key = {
            ex.submit(get_account_stats, plat, ident): key
            for key, (plat, ident) in fetch_jobs.items()
        }
        for future, key in future_to_key.items():
            plat, ident = fetch_jobs[key]
            try:
                fetched[key] = future.result()
            except Exception as e:
                fetched[key] = {
                    "has_data": False,
                    "error": f"fetch failed: {e}",
                    "is_default": ident is None,
                    "handle": ident or "Stars of Science (default)",
                }

    accounts = {
        platform: {
            "sos": fetched.get((platform, "sos")),
            "competitor": fetched.get((platform, "competitor")),
        }
        for platform in INSIGHTS_PLATFORMS
    }

    # 2) Per-platform AI analysis, in parallel — one bad platform can't sink the rest.
    platforms_out = {}
    with ThreadPoolExecutor(max_workers=len(INSIGHTS_PLATFORMS)) as ex:
        fut_to_plat = {
            ex.submit(_insight_for_platform, p, accounts[p]["sos"], accounts[p]["competitor"]): p
            for p in INSIGHTS_PLATFORMS
        }
        for future, p in fut_to_plat.items():
            try:
                platforms_out[p] = future.result()
            except Exception as e:
                platforms_out[p] = {"error": f"analysis failed: {e}"}

    # 3) Cross-platform synthesis (with deterministic fallback).
    overall_strategy, real_growth_summary = _synthesize_overview(accounts)

    return {
        "platforms": platforms_out,
        "accounts": accounts,
        "overall_strategy": overall_strategy,
        "real_growth_summary": real_growth_summary,
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
    }


def generate_campaign_pack(campaign_goal: str, persona: str = "general", goal: str = "reach"):
    """One-click cross-platform campaign kit: from a single campaign goal, generate
    a ready-to-publish, platform-native post for every platform (bilingual)."""
    persona_info = PERSONAS.get(persona, PERSONAS["general"])

    timing_lines = []
    for platform in PLATFORMS:
        t = OPTIMAL_POSTING_TIMES.get(platform, {})
        timing_lines.append(
            f"- {platform}: best days {t.get('best_days', [])}, best hours (GST) {t.get('best_hours', [])}"
        )
    timing_block = "\n".join(timing_lines)

    prompt = f"""
You are a social media campaign strategist for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}. They post to {BRAND_PROFILE['audience_note']}.

CAMPAIGN GOAL: {campaign_goal}
TARGET AUDIENCE: {persona_info['label']} — {persona_info['desc']}.
OPTIMIZATION GOAL: {goal} (reach = maximize impressions, engagement = maximize replies/shares, conversions = maximize clicks/applications).

OPTIMAL POSTING WINDOWS (Gulf Standard Time):
{timing_block}

For EACH of these 6 platforms — {", ".join(PLATFORMS)} — write ONE ready-to-publish, platform-native post for this campaign. Each must respect that platform's norms: length, tone, formatting, emoji use, hashtag conventions, and a call-to-action that fits the optimization goal and the target audience. Make the posts genuinely different per platform — do not just reuse the same text.

For every post:
- "text": the post in ENGLISH, ready to publish as-is.
- "text_alt": a culturally adapted ARABIC version for Arabic-speaking MENA audiences (adapted, not a literal translation).
- "hashtags": 3-5 relevant hashtags.
- "best_time": pick a concrete slot from the posting windows above (e.g. "Friday 8pm GST").
- "persona_note": one sentence on why this post works for {persona_info['label']}.
- "rationale": one sentence on the platform-specific choice you made.

Return ONLY valid JSON, no extra text, in this exact shape:
{{
  "campaign_goal": "{campaign_goal}",
  "posts": {{
    "instagram": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }},
    "tiktok": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }},
    "twitter": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }},
    "youtube": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }},
    "linkedin": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }},
    "facebook": {{ "text": "...", "text_alt": "...", "hashtags": ["#..."], "best_time": "...", "persona_note": "...", "rationale": "..." }}
  }},
  "overall_note": "<1-2 sentence cross-platform campaign strategy tying the posts together>"
}}

IMPORTANT: "posts" must contain all 6 platforms listed above.
"""

    # Posts and poster creatives are generated as two separate LLM calls (kept apart so the
    # large 6-post JSON stays reliable) and run concurrently to save wall time.
    with ThreadPoolExecutor(max_workers=2) as ex:
        posts_fut = ex.submit(
            lambda: client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=3500,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
            )
        )
        creatives_fut = ex.submit(generate_creatives, campaign_goal, persona, goal)

        response = posts_fut.result()
        creatives = creatives_fut.result()

    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    result = json.loads(raw)
    result["creatives"] = creatives
    return result


def generate_creatives(campaign_goal: str, persona: str = "general", goal: str = "reach"):
    """Two poster creatives (short overlay text + background image prompt + theme colors):
    a vibrant 'social' creative (IG/TikTok/X/YouTube) and a professional 'linkedin' one.
    Returns {"social": {...}, "linkedin": {...}} with a deterministic fallback on failure."""
    persona_info = PERSONAS.get(persona, PERSONAS["general"])

    prompt = f"""You are an art director for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}, posting to {BRAND_PROFILE['audience_note']}.

THE CAMPAIGN IS SPECIFICALLY ABOUT: "{campaign_goal}"
TARGET AUDIENCE: {persona_info['label']} — {persona_info['desc']}.
OPTIMIZATION GOAL: {goal}.

Design TWO marketing poster creatives. The text will be OVERLAID on an AI-generated background image.
- "social": vibrant, energetic — shared across Instagram, TikTok, X and YouTube.
- "linkedin": cleaner, professional, credible — for LinkedIn.

CRITICAL — be SPECIFIC to this exact campaign, not generic:
- The headline and subheadline MUST be about "{campaign_goal}" — name or clearly evoke its real subject/topic and the concrete benefit to the audience.
- The background_prompt MUST depict a scene that literally illustrates "{campaign_goal}".
- Do NOT output generic, brand-filler slogans that could apply to any campaign (e.g. "Discover Your Innovation", "Empowering Science", "Join the Revolution", "Shape the Future"). If a line would still make sense for a totally different campaign, rewrite it to be specific to "{campaign_goal}".

For EACH creative provide:
- "headline": punchy, MAX 4 words, directly about "{campaign_goal}".
- "subheadline": supporting line, MAX 8 words, expanding on "{campaign_goal}".
- "cta": short call to action, MAX 3 words (e.g. "Apply Now").
- "background_prompt": vivid description of the background IMAGE ONLY (scene, mood, colors, photographic/illustration style) that illustrates "{campaign_goal}". It MUST contain NO text, NO words, NO letters and NO logos, with clean negative space for the overlay text.
- "theme": two hex colors — "text" (high-contrast color for headline/subheadline) and "accent" (color for the CTA).

Return ONLY valid JSON in this exact shape:
{{
  "social":   {{ "headline": "...", "subheadline": "...", "cta": "...", "background_prompt": "...", "theme": {{ "text": "#FFFFFF", "accent": "#B8D930" }} }},
  "linkedin": {{ "headline": "...", "subheadline": "...", "cta": "...", "background_prompt": "...", "theme": {{ "text": "#FFFFFF", "accent": "#B8D930" }} }}
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=900,
            temperature=0.9,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        return {
            "social": data.get("social") or _fallback_creative("social", campaign_goal),
            "linkedin": data.get("linkedin") or _fallback_creative("linkedin", campaign_goal),
        }
    except Exception as e:
        print(f"Creatives generation failed: {e}")
        return {
            "social": _fallback_creative("social", campaign_goal),
            "linkedin": _fallback_creative("linkedin", campaign_goal),
        }


def _fallback_creative(group: str, campaign_goal: str):
    headline = " ".join(campaign_goal.split()[:3]) or BRAND_PROFILE["name"]
    if group == "linkedin":
        return {
            "headline": headline,
            "subheadline": "Backing the region's next generation of innovators",
            "cta": "Learn More",
            "background_prompt": "clean professional innovation backdrop, deep teal, minimal, soft light, no text",
            "theme": {"text": "#FFFFFF", "accent": "#B8D930"},
        }
    return {
        "headline": headline,
        "subheadline": "Where Arab innovation takes the stage",
        "cta": "Apply Now",
        "background_prompt": "vibrant futuristic science lab, teal and lime energy, dynamic, no text",
        "theme": {"text": "#FFFFFF", "accent": "#B8D930"},
    }


def generate_headline_options(campaign_goal: str, group: str = "social", layer: str = "headline", persona: str = "general"):
    """Return 5 short alternative texts for a single poster layer (headline / subheadline / cta).
    Used by the design editor's 'Regenerate' button."""
    persona_info = PERSONAS.get(persona, PERSONAS["general"])
    tone = "professional, credible" if group == "linkedin" else "modern, energetic"
    limits = {
        "headline": "MAX 4 words, punchy",
        "subheadline": "MAX 8 words, supporting line",
        "cta": "MAX 3 words, an action (e.g. 'Apply Now')",
    }
    spec = limits.get(layer, limits["headline"])

    prompt = f"""You are a marketing copywriter for {BRAND_PROFILE['name']} — {BRAND_PROFILE['description']}.
CAMPAIGN GOAL: {campaign_goal}
TARGET AUDIENCE: {persona_info['label']} — {persona_info['desc']}.
Write 5 alternative options for the "{layer}" of a {group} marketing poster.
Each option: {spec}. Tone: {tone}. No quotes, no numbering, no hashtags.
Return ONLY valid JSON: {{ "options": ["...", "...", "...", "...", "..."] }}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=300,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        opts = [str(o).strip() for o in data.get("options", []) if str(o).strip()]
        return {"options": opts[:5]}
    except Exception as e:
        print(f"Headline regen failed: {e}")
        return {"options": []}
