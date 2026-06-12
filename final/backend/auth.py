import os
import secrets
import hashlib
import base64
import urllib.parse
import requests
from fastapi.responses import RedirectResponse, HTMLResponse
import sessions as sessions_module

# ---- PKCE helpers ----

pkce_store: dict[str, str] = {}  # { state (== session_id): code_verifier }


def generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ---- Platform OAuth config ----

OAUTH_CONFIG: dict[str, dict] = {
    "twitter": {
        "auth_url":     "https://twitter.com/i/oauth2/authorize",
        "token_url":    "https://api.twitter.com/2/oauth2/token",
        "client_id":    os.getenv("TWITTER_CLIENT_ID"),
        "client_secret": os.getenv("TWITTER_CLIENT_SECRET"),
        "scope":        "tweet.read tweet.write users.read offline.access",
        "redirect_uri": "http://localhost:8000/auth/twitter/callback",
        "pkce":         True,
        "blocked":      False,
    },
    "linkedin": {
        "auth_url":     "https://www.linkedin.com/oauth/v2/authorization",
        "token_url":    "https://www.linkedin.com/oauth/v2/accessToken",
        "client_id":    os.getenv("LINKEDIN_CLIENT_ID"),
        "client_secret": os.getenv("LINKEDIN_CLIENT_SECRET"),
        "scope":        "openid profile w_member_social",
        "redirect_uri": "http://localhost:8000/auth/linkedin/callback",
        "pkce":         False,
        "blocked":      False,
    },
    "instagram": {
        "blocked":      True,
        "blocked_reason": "Instagram requires Meta App Review (3-7 days) — coming soon",
    },
    "facebook": {
        "blocked":      True,
        "blocked_reason": "Facebook requires Meta App Review (3-7 days) — coming soon",
    },
    "tiktok": {
        "blocked":      True,
        "blocked_reason": "TikTok video.create scope requires app approval — coming soon",
    },
    "youtube": {
        "blocked":      True,
        "blocked_reason": "YouTube requires OAuth consent screen verification — coming soon",
    },
}

# ---- Popup HTML templates ----

SUCCESS_POPUP_HTML = """<!DOCTYPE html>
<html><head><title>Connected</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:40px;">
  Connected as <strong>{username}</strong>! Closing...
</p>
<script>
  try {{
    window.opener.postMessage(
      {{ type: 'oauth_success', platform: '{platform}', username: '{username}' }},
      '*'
    );
  }} catch(e) {{}}
  setTimeout(function() {{ window.close(); }}, 800);
</script>
</body></html>"""

BLOCKED_POPUP_HTML = """<!DOCTYPE html>
<html><head><title>Not available</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:40px;color:#d97706;">
  {reason}
</p>
<script>
  try {{
    window.opener.postMessage(
      {{ type: 'oauth_blocked', platform: '{platform}', reason: '{reason}' }},
      '*'
    );
  }} catch(e) {{}}
  setTimeout(function() {{ window.close(); }}, 1500);
</script>
</body></html>"""

ERROR_POPUP_HTML = """<!DOCTYPE html>
<html><head><title>Error</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:40px;color:#ef4444;">
  Connection failed. Please try again.
</p>
<script>
  try {{
    window.opener.postMessage(
      {{ type: 'oauth_error', platform: '{platform}' }},
      '*'
    );
  }} catch(e) {{}}
  setTimeout(function() {{ window.close(); }}, 1500);
</script>
</body></html>"""


# ---- Route handlers ----

def auth_start(platform: str, session_id: str):
    cfg = OAUTH_CONFIG.get(platform)
    if not cfg:
        return HTMLResponse(ERROR_POPUP_HTML.format(platform=platform), status_code=404)

    if cfg.get("blocked"):
        sessions_module.store_token(session_id, platform, None, None, blocked=True)
        return HTMLResponse(BLOCKED_POPUP_HTML.format(
            platform=platform,
            reason=cfg["blocked_reason"],
        ))

    params: dict[str, str] = {
        "client_id":     cfg["client_id"],
        "redirect_uri":  cfg["redirect_uri"],
        "response_type": "code",
        "scope":         cfg["scope"],
        "state":         session_id,
    }

    if cfg.get("pkce"):
        verifier, challenge = generate_pkce_pair()
        pkce_store[session_id] = verifier
        params["code_challenge"] = challenge
        params["code_challenge_method"] = "S256"

    url = cfg["auth_url"] + "?" + urllib.parse.urlencode(params)
    return RedirectResponse(url)


def auth_callback(platform: str, code: str, state: str):
    cfg = OAUTH_CONFIG.get(platform)
    if not cfg or cfg.get("blocked"):
        return HTMLResponse(ERROR_POPUP_HTML.format(platform=platform))

    session_id = state

    token_data: dict[str, str] = {
        "grant_type":   "authorization_code",
        "code":         code,
        "redirect_uri": cfg["redirect_uri"],
        "client_id":    cfg["client_id"],
        "client_secret": cfg["client_secret"],
    }

    if cfg.get("pkce"):
        token_data["code_verifier"] = pkce_store.pop(session_id, "")

    try:
        r = requests.post(cfg["token_url"], data=token_data, timeout=10)
        token_resp = r.json()
        access_token = token_resp.get("access_token")
        if not access_token:
            print(f"Token exchange failed for {platform}: {token_resp}")
            return HTMLResponse(ERROR_POPUP_HTML.format(platform=platform))
    except Exception as e:
        print(f"Token exchange error ({platform}): {e}")
        return HTMLResponse(ERROR_POPUP_HTML.format(platform=platform))

    try:
        user_info = fetch_user_info(platform, access_token)
    except Exception as e:
        print(f"User info error ({platform}): {e}")
        user_info = {}

    sessions_module.store_token(session_id, platform, access_token, user_info)

    username = user_info.get("username") or user_info.get("name", "")
    return HTMLResponse(SUCCESS_POPUP_HTML.format(platform=platform, username=username))


# ---- User info fetchers ----

def fetch_user_info(platform: str, token: str) -> dict:
    if platform == "twitter":
        r = requests.get(
            "https://api.twitter.com/2/users/me",
            headers={"Authorization": f"Bearer {token}"},
            params={"user.fields": "id,username,public_metrics"},
            timeout=10,
        )
        u = r.json().get("data", {})
        return {
            "id": u.get("id"),
            "username": u.get("username"),
            "followers": u.get("public_metrics", {}).get("followers_count", 0),
        }
    elif platform == "linkedin":
        r = requests.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        u = r.json()
        return {"id": u.get("sub"), "name": u.get("name", "")}
    return {}
