import os
import base64
import requests
from dotenv import load_dotenv

load_dotenv()

PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")

SEARCH_URL = "https://api.pexels.com/v1/search"


def is_configured() -> bool:
    """True when a Pexels API key is available (PEXELS_API_KEY in the backend .env)."""
    return bool(PEXELS_API_KEY)


# Poster group → Pexels orientation (social creatives are square, LinkedIn is landscape).
_ORIENTATION = {"social": "square", "linkedin": "landscape"}


def search(query: str, group: str = "social", per_page: int = 15) -> list:
    """Search Pexels for stock photos. Returns a normalized list; never raises ([] on error)."""
    if not PEXELS_API_KEY:
        print("Pexels search skipped: PEXELS_API_KEY not set")
        return []
    try:
        r = requests.get(
            SEARCH_URL,
            headers={"Authorization": PEXELS_API_KEY},
            params={
                "query": query or "innovation",
                "per_page": per_page,
                "orientation": _ORIENTATION.get(group, "square"),
            },
            timeout=15,
        )
        photos = r.json().get("photos", [])
        out = []
        for p in photos:
            src = p.get("src", {}) or {}
            full = src.get("large2x") or src.get("original") or src.get("large")
            thumb = src.get("medium") or src.get("small") or src.get("tiny")
            if not full or not thumb:
                continue
            out.append({
                "id": p.get("id"),
                "thumb": thumb,
                "full": full,
                "alt": p.get("alt", ""),
                "photographer": p.get("photographer", ""),
                "photographer_url": p.get("photographer_url", ""),
            })
        return out
    except Exception as e:
        print(f"Pexels search failed: {e}")
        return []


def fetch_as_data_url(url: str) -> dict:
    """Download a Pexels image server-side and return it as a base64 data URL.
    Keeps the front-end Fabric canvas untainted so PNG export still works."""
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        content_type = r.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"
        b64 = base64.b64encode(r.content).decode("utf-8")
        return {"image": f"data:{content_type};base64,{b64}"}
    except Exception as e:
        print(f"Pexels image fetch failed: {e}")
        return {"image": None}
