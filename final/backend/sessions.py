sessions: dict[str, dict] = {}


def get_session(session_id: str) -> dict:
    if session_id not in sessions:
        sessions[session_id] = {}
    return sessions[session_id]


def store_token(session_id: str, platform: str, access_token, user_info, blocked: bool = False):
    get_session(session_id)[platform] = {
        "access_token": access_token,
        "user_info": user_info or {},
        "blocked": blocked,
    }


def get_token(session_id: str, platform: str):
    return sessions.get(session_id, {}).get(platform, {}).get("access_token")


def is_connected(session_id: str, platform: str) -> bool:
    entry = sessions.get(session_id, {}).get(platform, {})
    return bool(entry.get("access_token")) and not entry.get("blocked", False)
