import os
import requests
from dotenv import load_dotenv

load_dotenv()

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")

# ─────────────────────────────────────────
# INSTAGRAM
# ─────────────────────────────────────────
def get_instagram_posts(username: str = "starsofsciencetv"):
    try:
        url = "https://instagram120.p.rapidapi.com/api/instagram/posts"
        payload = {"username": username, "maxId": ""}
        headers = {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "instagram120.p.rapidapi.com",
            "Content-Type": "application/json"
        }
        r = requests.post(url, json=payload, headers=headers, timeout=10)
        edges = r.json().get("result", {}).get("edges", [])
        posts = [e.get("node", {}) for e in edges]
        return [{
            "platform": "instagram",
            "caption": p.get("caption", {}).get("text", "") if p.get("caption") else "",
            "likes": p.get("like_count", 0),
            "comments": p.get("comment_count", 0),
        } for p in posts[:10]]
    except Exception as e:
        print(f"Instagram error: {e}")
        return []

# ─────────────────────────────────────────
# TIKTOK
# ─────────────────────────────────────────
def get_tiktok_posts(username: str = "starsofscience"):
    try:
        # Requires subscribing to "TikTok Scraper" (tiktok-scraper7) on RapidAPI (free tier)
        url = "https://tiktok-scraper7.p.rapidapi.com/user/posts"
        headers = {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
        }
        params = {"unique_id": f"@{username}", "count": "10", "cursor": "0"}
        r = requests.get(url, headers=headers, params=params, timeout=10)
        posts = r.json().get("data", {}).get("videos", [])
        return [{
            "platform": "tiktok",
            "caption": p.get("title", ""),
            "likes": p.get("digg_count", 0),
            "comments": p.get("comment_count", 0),
            "views": p.get("play_count", 0),
        } for p in posts[:10]]
    except Exception as e:
        print(f"TikTok error: {e}")
        return []

# ─────────────────────────────────────────
# TWITTER / X
# ─────────────────────────────────────────
def get_twitter_posts(username: str = "starsofscience"):
    try:
        url = "https://twitter-api45.p.rapidapi.com/timeline.php"
        headers = {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "twitter-api45.p.rapidapi.com"
        }
        params = {"screenname": username}
        r = requests.get(url, headers=headers, params=params, timeout=10)
        tweets = r.json().get("timeline", [])
        return [{
            "platform": "twitter",
            "caption": t.get("text", ""),
            "likes": t.get("favorites", 0),
            "retweets": t.get("retweets", 0),
            "comments": t.get("replies", 0),
        } for t in tweets[:10]]
    except Exception as e:
        print(f"Twitter error: {e}")
        return []

# ─────────────────────────────────────────
# YOUTUBE
# ─────────────────────────────────────────
def get_youtube_videos(channel_id: str = "UCQ36ixRyMdlCuQDeMIJ8lqg"):
    try:
        url = "https://youtube138.p.rapidapi.com/channel/videos/"
        payload = {
            "id": channel_id,
            "filter": "videos_latest",
            "cursor": "",
            "hl": "en",
            "gl": "QA"
        }
        headers = {
            "x-rapidapi-key": RAPIDAPI_KEY,
            "x-rapidapi-host": "youtube138.p.rapidapi.com",
            "Content-Type": "application/json"
        }
        r = requests.post(url, json=payload, headers=headers, timeout=10)
        videos = r.json().get("contents", [])
        return [{
            "platform": "youtube",
            "caption": v.get("video", {}).get("title", ""),
            "likes": v.get("video", {}).get("stats", {}).get("likes", 0),
            "comments": v.get("video", {}).get("stats", {}).get("comments", 0),
            "views": v.get("video", {}).get("stats", {}).get("views", 0),
        } for v in videos[:10] if v.get("video")]
    except Exception as e:
        print(f"YouTube error: {e}")
        return []

# ─────────────────────────────────────────
# FACEBOOK
# ─────────────────────────────────────────
def get_facebook_posts(page_url: str = "https://www.facebook.com/StarsofScienceTV"):
    try:
        host = "facebook-scraper3.p.rapidapi.com"
        headers = {"x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": host}

        # Resolve the page URL to its numeric page_id
        details = requests.get(f"https://{host}/page/details", headers=headers, params={"url": page_url}, timeout=10)
        page_id = details.json().get("results", {}).get("page_id")
        if not page_id:
            return []

        r = requests.get(f"https://{host}/page/posts", headers=headers, params={"page_id": page_id}, timeout=10)
        posts = r.json().get("results", [])
        return [{
            "platform": "facebook",
            "caption": p.get("message", ""),
            "likes": p.get("reactions_count", 0),
            "comments": p.get("comments_count", 0),
        } for p in posts[:10]]
    except Exception as e:
        print(f"Facebook error: {e}")
        return []

# ─────────────────────────────────────────
# POSTING TIMES (MENA-specific, hardcoded from research)
# ─────────────────────────────────────────
OPTIMAL_POSTING_TIMES = {
    "instagram": {
        "best_days": ["Tuesday", "Wednesday", "Friday"],
        "best_hours": ["6am-9am", "12pm-2pm", "5pm-7pm"],
        "mena_note": "Thursday evening high engagement pre-weekend in Gulf"
    },
    "linkedin": {
        "best_days": ["Tuesday", "Wednesday", "Thursday"],
        "best_hours": ["7am-8am", "12pm", "5pm-6pm"],
        "mena_note": "Avoid Friday-Saturday — MENA weekend, very low B2B traffic"
    },
    "tiktok": {
        "best_days": ["Tuesday", "Thursday", "Friday"],
        "best_hours": ["6am-10am", "7pm-9pm"],
        "mena_note": "Friday night peak across Gulf region"
    },
    "youtube": {
        "best_days": ["Thursday", "Friday", "Saturday"],
        "best_hours": ["12pm-4pm", "8pm-11pm"],
        "mena_note": "Saturday afternoon is peak for MENA viewership"
    },
    "twitter": {
        "best_days": ["Monday", "Wednesday", "Friday"],
        "best_hours": ["8am-10am", "1pm-3pm"],
        "mena_note": "News cycle peaks at 9am Gulf Standard Time"
    },
    "facebook": {
        "best_days": ["Wednesday", "Thursday", "Friday"],
        "best_hours": ["1pm-3pm", "7pm-9pm"],
        "mena_note": "Friday afternoon and evening peak engagement across the Gulf"
    }
}

# ─────────────────────────────────────────
# PLATFORM HARD RULES
# ─────────────────────────────────────────
def hard_rules_check(post: str, platform: str, media_type: str = "text") -> list[str]:
    flags = []
    if platform == "twitter" and len(post) > 280:
        flags.append(f"Over character limit ({len(post)}/280 chars)")
    if platform == "linkedin" and post.count("#") > 5:
        flags.append(f"Too many hashtags for LinkedIn ({post.count('#')}) — max 3-5")
    if platform == "instagram" and post.count("#") > 30:
        flags.append("Instagram max is 30 hashtags")
    if platform == "tiktok" and "link in bio" not in post.lower() and len(post) > 50:
        flags.append("Consider adding 'link in bio' CTA for TikTok")
    if len(post.strip()) < 20:
        flags.append("Post is too short — add more context")
    if platform in ("tiktok", "youtube") and media_type != "video":
        flags.append(f"{platform.capitalize()} strongly favors video — consider posting as video instead of {media_type}")
    if platform == "instagram" and media_type == "text":
        flags.append("Instagram posts need an image, carousel, or reel — text-only posts underperform")
    return flags

# ─────────────────────────────────────────
# GET ALL SOS DATA
# ─────────────────────────────────────────
def get_platform_data(platform: str):
    fetchers = {
        "instagram": get_instagram_posts,
        "tiktok": get_tiktok_posts,
        "twitter": get_twitter_posts,
        "youtube": get_youtube_videos,
        "facebook": get_facebook_posts,
        "linkedin": lambda: []  # no free scraper, fallback to empty
    }
    posts = fetchers.get(platform, lambda: [])()
    
    if not posts:
        return [], 0, 0
    
    top_posts = sorted(posts, key=lambda x: x.get("likes", 0), reverse=True)[:3]
    avg_likes = sum(p.get("likes", 0) for p in posts) // len(posts)
    avg_comments = sum(p.get("comments", 0) for p in posts) // len(posts)
    
    return top_posts, avg_likes, avg_comments
