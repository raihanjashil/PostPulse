import requests

BLOCKED_PLATFORMS = {"instagram", "facebook", "tiktok", "youtube"}


def publish_post(platform: str, access_token: str, text: str, user_id: str = None) -> dict:
    """
    Returns { "success": bool, "post_id": str|None, "url": str|None, "error": str|None }
    """
    if platform in BLOCKED_PLATFORMS:
        return {"success": False, "error": "Platform requires app approval — coming soon"}

    if platform == "twitter":
        return _publish_twitter(access_token, text)
    elif platform == "linkedin":
        if not user_id:
            return {"success": False, "error": "LinkedIn user ID not available — reconnect your account"}
        return _publish_linkedin(access_token, text, user_id)

    return {"success": False, "error": f"Unsupported platform: {platform}"}


def _publish_twitter(token: str, text: str) -> dict:
    r = requests.post(
        "https://api.twitter.com/2/tweets",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"text": text[:280]},
        timeout=10,
    )
    if r.status_code == 201:
        tweet_id = r.json().get("data", {}).get("id")
        return {
            "success": True,
            "post_id": tweet_id,
            "url": f"https://twitter.com/i/web/status/{tweet_id}",
        }
    return {"success": False, "error": r.text}


def _publish_linkedin(token: str, text: str, user_id: str) -> dict:
    payload = {
        "author": f"urn:li:person:{user_id}",
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
        },
    }
    r = requests.post(
        "https://api.linkedin.com/v2/ugcPosts",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        json=payload,
        timeout=10,
    )
    if r.status_code in (200, 201):
        post_id = r.headers.get("x-restli-id", "")
        return {"success": True, "post_id": post_id, "url": None}
    return {"success": False, "error": r.text}
