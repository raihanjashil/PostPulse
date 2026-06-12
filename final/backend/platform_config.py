import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

CONFIG_FILE = Path(__file__).parent / "platform_config.json"

# Maps platform name → env-var prefix used as fallback
_ENV_PREFIXES = {
    "twitter":  "TWITTER",
    "linkedin": "LINKEDIN",
    "instagram": "INSTAGRAM",
    "facebook": "FACEBOOK",
    "tiktok":   "TIKTOK",
    "youtube":  "YOUTUBE",
}


def load_config() -> dict:
    """Load saved credentials from platform_config.json. Returns {} if file doesn't exist."""
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_config(platform: str, client_id: str, client_secret: str):
    """Save or update credentials for a single platform."""
    cfg = load_config()
    cfg[platform] = {"client_id": client_id, "client_secret": client_secret}
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def clear_config(platform: str):
    """Remove saved credentials for a platform."""
    cfg = load_config()
    cfg.pop(platform, None)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def get_credentials(platform: str) -> tuple:
    """
    Returns (client_id, client_secret).
    Priority: platform_config.json → .env variables → (None, None).
    """
    cfg = load_config().get(platform, {})
    prefix = _ENV_PREFIXES.get(platform, platform.upper())

    client_id = cfg.get("client_id") or os.getenv(f"{prefix}_CLIENT_ID")
    client_secret = cfg.get("client_secret") or os.getenv(f"{prefix}_CLIENT_SECRET")
    return client_id, client_secret


def get_all_status() -> dict:
    """
    Returns configured status for all platforms.
    Secrets are never included — only a boolean.
    """
    status = {}
    for platform in _ENV_PREFIXES:
        cid, _ = get_credentials(platform)
        status[platform] = {"configured": bool(cid)}
    return status
