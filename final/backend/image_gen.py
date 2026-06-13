import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Brand gradient fallbacks (used when the Images API is unavailable / errors).
# social = vibrant teal→lime; linkedin = darker, professional teal pair.
_FALLBACK_GRADIENTS = {
    "social":   ["#0D7377", "#B8D930"],
    "linkedin": ["#0A1E24", "#0D7377"],
}

# OpenAI image sizes per creative group (gpt-image-1 supports these).
_GROUP_SIZE = {
    "social":   "1024x1024",
    "linkedin": "1536x1024",
}


def size_for_group(group: str) -> str:
    return _GROUP_SIZE.get(group, "1024x1024")


def _fallback(group: str) -> dict:
    return {
        "image": None,
        "source": "fallback",
        "gradient": _FALLBACK_GRADIENTS.get(group, _FALLBACK_GRADIENTS["social"]),
    }


def generate_background(prompt: str, group: str = "social", size: str = None) -> dict:
    """
    Generate a poster background image (NO text) for a campaign creative.
    Returns a base64 PNG data URL so the frontend canvas stays untainted and
    PNG export works. Never raises — on any failure returns a gradient fallback.
    """
    size = size or size_for_group(group)
    # Reinforce "no text" so the model leaves room for editable overlays.
    full_prompt = (
        f"{prompt}. Clean composition with empty negative space for text overlays. "
        f"Absolutely NO text, NO words, NO letters, NO logos in the image."
    )
    try:
        resp = client.images.generate(
            model="gpt-image-1",
            prompt=full_prompt,
            size=size,
            n=1,
        )
        b64 = resp.data[0].b64_json
        if not b64:
            return _fallback(group)
        return {
            "image": f"data:image/png;base64,{b64}",
            "source": "openai",
        }
    except Exception as e:
        print(f"Image generation failed ({group}): {e}")
        return _fallback(group)
