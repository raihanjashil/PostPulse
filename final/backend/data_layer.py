import os
import re
import time
import requests
from dotenv import load_dotenv

load_dotenv()

RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")

# Insights tab targets these (LinkedIn has no free scraper, so it's excluded there)
INSIGHTS_PLATFORMS = ["instagram", "tiktok", "twitter", "youtube", "facebook"]

# Comments-per-100-likes cutoffs differ a lot by platform; a global threshold mislabels.
# (high, medium) — heuristic, easily tuned. Fallback for unknown platforms.
COMMENT_RATE_THRESHOLDS = {
    "instagram": (1.5, 0.5),
    "tiktok":    (1.0, 0.3),
    "twitter":   (10.0, 3.0),
    "youtube":   (2.0, 0.5),
    "facebook":  (3.0, 1.0),
    "linkedin":  (3.0, 1.0),
}
_DEFAULT_THRESHOLD = (5.0, 1.0)


def engagement_quality(platform, avg_likes, avg_comments):
    """comment_rate = comments per 100 likes; bucketed by per-platform thresholds."""
    comment_rate = round((avg_comments / avg_likes) * 100, 2) if avg_likes > 0 else 0
    high, med = COMMENT_RATE_THRESHOLDS.get(platform, _DEFAULT_THRESHOLD)
    if comment_rate >= high:
        quality = "high"
    elif comment_rate >= med:
        quality = "medium"
    else:
        quality = "low"
    return comment_rate, quality


def _first(d, *paths):
    """Return the first present, non-None value among keys / nested key-paths; else None.
    Used for best-effort extraction of fields whose exact location varies by API."""
    for path in paths:
        cur = d
        keys = path if isinstance(path, (list, tuple)) else (path,)
        ok = True
        for k in keys:
            if isinstance(cur, dict) and cur.get(k) is not None:
                cur = cur[k]
            else:
                ok = False
                break
        if ok:
            return cur
    return None


def _hashtags(caption):
    return re.findall(r"#\w+", caption or "")


_SUFFIX = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def _to_int(v):
    """Coerce an API count to int. Handles ints/floats, comma strings ("1,234"),
    and abbreviated strings ("1.2M", "3.4k subscribers"). Returns 0 if unparseable."""
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    if not isinstance(v, str):
        return 0
    m = re.search(r"([\d,.]+)\s*([kmb])?", v.strip(), re.IGNORECASE)
    if not m:
        return 0
    num = m.group(1).replace(",", "")
    if num.count(".") > 1 or num in ("", "."):
        return 0
    try:
        val = float(num)
    except ValueError:
        return 0
    mult = _SUFFIX.get((m.group(2) or "").lower(), 1)
    return int(val * mult)

# ─────────────────────────────────────────
# INSTAGRAM
# ─────────────────────────────────────────
def get_instagram_posts(username: str = "starsofsciencetv"):
    url = "https://instagram120.p.rapidapi.com/api/instagram/posts"
    payload = {"username": username, "maxId": ""}
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "instagram120.p.rapidapi.com",
        "Content-Type": "application/json"
    }
    r = requests.post(url, json=payload, headers=headers, timeout=15)
    result = r.json().get("result", {})
    edges = result.get("edges", [])
    nodes = [e.get("node", {}) for e in edges]
    followers = _first(result,
                       ("user", "follower_count"),
                       ("user", "edge_followed_by", "count"),
                       ("owner", "edge_followed_by", "count"))
    posts = [{
        "platform": "instagram",
        "caption": p.get("caption", {}).get("text", "") if p.get("caption") else "",
        "likes": _to_int(p.get("like_count", 0)),
        "comments": _to_int(p.get("comment_count", 0)),
        "timestamp": _first(p, "taken_at_timestamp", "taken_at"),
        "media_type": "video" if p.get("is_video") else _first(p, "media_type", "product_type"),
    } for p in nodes[:10]]
    return {"posts": posts, "followers": followers}

# ─────────────────────────────────────────
# TIKTOK
# ─────────────────────────────────────────
def get_tiktok_posts(username: str = "starsofscience"):
    # Requires subscribing to "TikTok Scraper" (tiktok-scraper7) on RapidAPI (free tier)
    url = "https://tiktok-scraper7.p.rapidapi.com/user/posts"
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
    }
    params = {"unique_id": f"@{username}", "count": "10", "cursor": "0"}
    r = requests.get(url, headers=headers, params=params, timeout=15)
    data = r.json().get("data", {})
    videos = data.get("videos", [])
    followers = _first(data, ("author", "followerCount"), ("author", "follower_count")) \
        or (_first(videos[0], ("author", "followerCount"), ("author", "follower_count")) if videos else None)
    posts = [{
        "platform": "tiktok",
        "caption": p.get("title", ""),
        "likes": _to_int(p.get("digg_count", 0)),
        "comments": _to_int(p.get("comment_count", 0)),
        "views": _to_int(p.get("play_count", 0)),
        "shares": _to_int(p.get("share_count")) if p.get("share_count") is not None else None,
        "timestamp": p.get("create_time"),
        "media_type": "video",
    } for p in videos[:10]]
    return {"posts": posts, "followers": followers}

# ─────────────────────────────────────────
# TWITTER / X
# ─────────────────────────────────────────
def get_twitter_posts(username: str = "starsofscience"):
    url = "https://twitter-api45.p.rapidapi.com/timeline.php"
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "twitter-api45.p.rapidapi.com"
    }
    params = {"screenname": username}
    r = requests.get(url, headers=headers, params=params, timeout=15)
    body = r.json()
    tweets = body.get("timeline", [])
    followers = _first(body, ("user", "followers_count"), ("user", "sub_count")) \
        or _first(body, ("user_info", "followers_count"))
    posts = [{
        "platform": "twitter",
        "caption": t.get("text", ""),
        "likes": _to_int(t.get("favorites", 0)),
        "retweets": _to_int(t.get("retweets", 0)),
        "comments": _to_int(t.get("replies", 0)),
        "views": _to_int(_first(t, "views", "view_count")) if _first(t, "views", "view_count") is not None else None,
        "timestamp": _first(t, "created_at", "created_at_datetime"),
    } for t in tweets[:10]]
    return {"posts": posts, "followers": followers}

# ─────────────────────────────────────────
# YOUTUBE
# ─────────────────────────────────────────
def _resolve_youtube_channel_id(identifier: str) -> str:
    """Accept a raw UC… channel ID, a full URL, or an @handle and resolve to a channel ID.
    Falls back to returning the input unchanged if resolution fails."""
    ident = (identifier or "").strip()
    if ident.startswith("UC") and "/" not in ident and " " not in ident:
        return ident  # already a channel ID

    # Pull an @handle or last URL path segment to search for
    m = re.search(r"@[\w.\-]+", ident)
    query = m.group(0) if m else ident.rstrip("/").split("/")[-1]
    try:
        host = "youtube138.p.rapidapi.com"
        r = requests.get(
            f"https://{host}/search/",
            headers={"x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": host},
            params={"q": query, "hl": "en", "gl": "QA"},
            timeout=15,
        )
        for item in r.json().get("contents", []):
            ch = item.get("channel")
            if ch and ch.get("channelId"):
                return ch["channelId"]
    except Exception as e:
        print(f"YouTube resolve error: {e}")
    return ident


def get_youtube_videos(channel_id: str = "@starsofscience"):
    channel_id = _resolve_youtube_channel_id(channel_id)
    url = "https://youtube138.p.rapidapi.com/channel/videos/"
    payload = {"id": channel_id, "filter": "videos_latest", "cursor": "", "hl": "en", "gl": "QA"}
    headers = {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "youtube138.p.rapidapi.com",
        "Content-Type": "application/json"
    }
    r = requests.post(url, json=payload, headers=headers, timeout=15)
    body = r.json()
    videos = body.get("contents", [])
    followers = _first(body, ("meta", "subscriberCountText"), ("meta", "subscriberCount")) \
        or _first(body, ("channel", "stats", "subscribers"))
    posts = [{
        "platform": "youtube",
        "caption": v.get("video", {}).get("title", ""),
        "likes": _to_int(v.get("video", {}).get("stats", {}).get("likes", 0)),
        "comments": _to_int(v.get("video", {}).get("stats", {}).get("comments", 0)),
        "views": _to_int(v.get("video", {}).get("stats", {}).get("views", 0)),
        "timestamp": _first(v.get("video", {}), "publishedTimeText", "publishedTime"),
        "media_type": "video",
    } for v in videos[:10] if v.get("video")]
    return {"posts": posts, "followers": followers}

# ─────────────────────────────────────────
# FACEBOOK
# ─────────────────────────────────────────
def get_facebook_posts(page_url: str = "https://www.facebook.com/StarsofScienceTV"):
    host = "facebook-scraper3.p.rapidapi.com"
    headers = {"x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": host}

    # Resolve the page URL to its numeric page_id (and grab follower count if present)
    details = requests.get(f"https://{host}/page/details", headers=headers, params={"url": page_url}, timeout=15)
    results = details.json().get("results", {})
    page_id = results.get("page_id")
    followers = _first(results, "followers", "followers_count", "likes")
    if not page_id:
        return {"posts": [], "followers": followers}

    r = requests.get(f"https://{host}/page/posts", headers=headers, params={"page_id": page_id}, timeout=15)
    raw = r.json().get("results", [])
    posts = [{
        "platform": "facebook",
        "caption": p.get("message", ""),
        "likes": _to_int(p.get("reactions_count", 0)),
        "comments": _to_int(p.get("comments_count", 0)),
        "shares": _to_int(_first(p, "reshare_count", "shares")) if _first(p, "reshare_count", "shares") is not None else None,
        "timestamp": _first(p, "timestamp", "creation_time"),
        "media_type": p.get("type"),
    } for p in raw[:10]]
    return {"posts": posts, "followers": followers}

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
_FETCHERS = {
    "instagram": get_instagram_posts,
    "tiktok": get_tiktok_posts,
    "twitter": get_twitter_posts,
    "youtube": get_youtube_videos,
    "facebook": get_facebook_posts,
    # linkedin: no free scraper — intentionally absent
}


def _call_fetcher(platform: str, identifier: str = None) -> dict:
    """Run a platform fetcher, normalizing to {"posts": [...], "followers": int|None}.
    Retries once on a transient timeout. Raises on the final failure so callers
    can surface a real reason."""
    fetcher = _FETCHERS.get(platform)
    if not fetcher:
        return {"posts": [], "followers": None}

    last_err = None
    for attempt in range(2):  # one retry
        try:
            result = fetcher(identifier) if identifier else fetcher()
            if isinstance(result, list):  # safety net for any legacy shape
                return {"posts": result, "followers": None}
            return result or {"posts": [], "followers": None}
        except requests.Timeout as e:
            last_err = e
            if attempt == 0:
                time.sleep(0.8)  # brief backoff, then retry once
    raise last_err


def get_platform_data(platform: str, identifier: str = None):
    """Scorer-facing: returns (top_posts, avg_likes, avg_comments). Never raises.
    `identifier` overrides the Stars of Science default account."""
    try:
        posts = _call_fetcher(platform, identifier).get("posts", [])
    except Exception as e:
        print(f"{platform} fetch error: {e}")
        posts = []

    if not posts:
        return [], 0, 0

    top_posts = sorted(posts, key=lambda x: _to_int(x.get("likes", 0)), reverse=True)[:3]
    avg_likes = sum(_to_int(p.get("likes", 0)) for p in posts) // len(posts)
    avg_comments = sum(_to_int(p.get("comments", 0)) for p in posts) // len(posts)
    return top_posts, avg_likes, avg_comments


# ─────────────────────────────────────────
# RICH ACCOUNT STATS (for Account Intelligence) — cached
# ─────────────────────────────────────────
_STATS_CACHE = {}
_STATS_TTL = 300  # seconds


def get_account_stats(platform: str, identifier: str = None) -> dict:
    """Rich per-account stats for the Account Intelligence tab, with a short TTL cache.
    Always returns a dict; `error` carries a human-readable reason when data is missing."""
    cache_key = (platform, identifier or "__sos__")
    now = time.time()
    cached = _STATS_CACHE.get(cache_key)
    if cached and now - cached[0] < _STATS_TTL:
        return cached[1]
    stats = _compute_account_stats(platform, identifier)
    # Only cache successes — a transient failure must not stick for the whole TTL.
    if stats.get("has_data"):
        _STATS_CACHE[cache_key] = (now, stats)
    return stats


def _compute_account_stats(platform: str, identifier: str = None) -> dict:
    base = {
        "platform": platform,
        "handle": identifier or "Stars of Science (default)",
        "is_default": identifier is None,
        "has_data": False,
        "error": None,
        "post_count": 0,
        "follower_count": None,
        "avg_likes": 0,
        "avg_comments": 0,
        "avg_views": None,
        "avg_retweets": None,
        "avg_caption_len": 0,
        "avg_hashtags": 0,
        "comment_rate": 0,
        "engagement_quality": "low",
        "engagement_rate": None,
        "top_posts": [],
    }

    # Wrap fetch AND aggregation so any failure returns `base` (with its label intact)
    # rather than propagating and losing is_default/handle.
    try:
        data = _call_fetcher(platform, identifier)
        posts = data.get("posts", [])
        followers_raw = data.get("followers")
        followers = _to_int(followers_raw) if followers_raw is not None else None
        if followers == 0:
            followers = None

        if not posts:
            base["error"] = "no posts found (check the handle)"
            base["follower_count"] = followers
            return base

        n = len(posts)
        avg_likes = sum(_to_int(p.get("likes", 0)) for p in posts) // n
        avg_comments = sum(_to_int(p.get("comments", 0)) for p in posts) // n
        comment_rate, quality = engagement_quality(platform, avg_likes, avg_comments)

        views = [_to_int(p["views"]) for p in posts if p.get("views") is not None]
        retweets = [_to_int(p["retweets"]) for p in posts if p.get("retweets") is not None]
        avg_caption_len = sum(len(p.get("caption", "") or "") for p in posts) // n
        avg_hashtags = round(sum(len(_hashtags(p.get("caption", ""))) for p in posts) / n, 1)

        engagement_rate = round(((avg_likes + avg_comments) / followers) * 100, 2) if followers else None

        top = sorted(posts, key=lambda x: _to_int(x.get("likes", 0)), reverse=True)[:3]
        top_posts = [{
            "caption": (p.get("caption", "") or "")[:200],
            "likes": _to_int(p.get("likes", 0)),
            "comments": _to_int(p.get("comments", 0)),
            "views": _to_int(p["views"]) if p.get("views") is not None else None,
            "retweets": _to_int(p["retweets"]) if p.get("retweets") is not None else None,
            "hashtags": _hashtags(p.get("caption", "")),
        } for p in top]

        base.update({
            "has_data": True,
            "post_count": n,
            "follower_count": followers,
            "avg_likes": avg_likes,
            "avg_comments": avg_comments,
            "avg_views": (sum(views) // len(views)) if views else None,
            "avg_retweets": (sum(retweets) // len(retweets)) if retweets else None,
            "avg_caption_len": avg_caption_len,
            "avg_hashtags": avg_hashtags,
            "comment_rate": comment_rate,
            "engagement_quality": quality,
            "engagement_rate": engagement_rate,
            "top_posts": top_posts,
        })
        return base
    except requests.Timeout:
        base["error"] = "timed out fetching this account"
        return base
    except Exception as e:
        print(f"{platform} stats error: {e}")
        base["error"] = "API error — rate limited or unavailable"
        return base


# ─────────────────────────────────────────
# USER-SPECIFIC DATA (when OAuth connected)
# ─────────────────────────────────────────
def get_user_platform_data(platform: str, access_token: str) -> tuple[list, int, int]:
    """
    Fetches the authenticated user's own recent posts for personalized benchmarks.
    Falls back to ([], 0, 0) on any failure.
    """
    try:
        if platform == "twitter":
            return _get_user_twitter_data(access_token)
        elif platform == "linkedin":
            return _get_user_linkedin_data(access_token)
        return [], 0, 0
    except Exception as e:
        print(f"User data fetch error ({platform}): {e}")
        return [], 0, 0


def _get_user_twitter_data(token: str) -> tuple[list, int, int]:
    me_r = requests.get(
        "https://api.twitter.com/2/users/me",
        headers={"Authorization": f"Bearer {token}"},
        params={"user.fields": "public_metrics"},
        timeout=10,
    )
    me = me_r.json().get("data", {})
    user_id = me.get("id")
    if not user_id:
        return [], 0, 0

    tweets_r = requests.get(
        f"https://api.twitter.com/2/users/{user_id}/tweets",
        headers={"Authorization": f"Bearer {token}"},
        params={"max_results": 10, "tweet.fields": "public_metrics,text"},
        timeout=10,
    )
    tweets = tweets_r.json().get("data", [])
    if not tweets:
        return [], 0, 0

    posts = [{
        "platform": "twitter",
        "caption": t.get("text", ""),
        "likes": t.get("public_metrics", {}).get("like_count", 0),
        "comments": t.get("public_metrics", {}).get("reply_count", 0),
        "retweets": t.get("public_metrics", {}).get("retweet_count", 0),
    } for t in tweets]

    top_posts = sorted(posts, key=lambda x: x["likes"], reverse=True)[:3]
    avg_likes = sum(p["likes"] for p in posts) // len(posts)
    avg_comments = sum(p["comments"] for p in posts) // len(posts)
    return top_posts, avg_likes, avg_comments


def _get_user_linkedin_data(token: str) -> tuple[list, int, int]:
    r = requests.get(
        "https://api.linkedin.com/v2/ugcPosts",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        params={"q": "authors", "count": 10},
        timeout=10,
    )
    elements = r.json().get("elements", [])
    if not elements:
        return [], 0, 0

    posts = [{
        "platform": "linkedin",
        "caption": el.get("specificContent", {})
                     .get("com.linkedin.ugc.ShareContent", {})
                     .get("shareCommentary", {}).get("text", ""),
        "likes": 0,
        "comments": 0,
    } for el in elements[:10]]

    return posts[:3], 0, 0
