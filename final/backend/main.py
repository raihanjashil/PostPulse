from fastapi import FastAPI, Header, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional
import shutil
import tempfile
import os
import auth
import publish
import sessions as sessions_module
import platform_config as cfg_module
import video_analyzer
import image_gen
import pexels
from scorer import score_post, score_all_platforms, recommend_publishing, generate_account_insights, generate_campaign_pack, generate_headline_options

app = FastAPI(title="SoS Content Scorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Models ----

class ScoreRequest(BaseModel):
    draft: str
    platform: str = "all"
    topic: str = "science innovation"
    media_type: str = "text"
    goal: str = "reach"  # "reach" | "engagement" | "conversions"
    persona: str = "general"  # "general" | "applicants" | "viewers" | "sponsors"

class PublishRequest(BaseModel):
    platform: str
    text: str

class CampaignRequest(BaseModel):
    campaign_goal: str
    persona: str = "general"  # "general" | "applicants" | "viewers" | "sponsors"
    goal: str = "reach"       # "reach" | "engagement" | "conversions"

class GenerateImageRequest(BaseModel):
    prompt: str
    group: str = "social"     # "social" | "linkedin"

class RegenerateLayerRequest(BaseModel):
    campaign_goal: str
    group: str = "social"     # "social" | "linkedin"
    layer: str = "headline"   # "headline" | "subheadline" | "cta"
    persona: str = "general"

class PexelsSearchRequest(BaseModel):
    query: str
    group: str = "social"     # "social" | "linkedin"

class PexelsImageRequest(BaseModel):
    url: str

# ---- Health ----

@app.get("/")
def root():
    return {"status": "Stars of Science Scorer is live"}

@app.get("/health")
def health():
    return {"status": "ok"}

# ---- Score ----

@app.post("/score")
def score(req: ScoreRequest, x_session_id: Optional[str] = Header(default=None)):
    if req.platform == "all":
        raw_results = score_all_platforms(
            req.draft, req.topic, req.media_type, session_id=x_session_id, persona=req.persona
        )
    else:
        user_data = None
        if x_session_id:
            token = sessions_module.get_token(x_session_id, req.platform)
            if token:
                from data_layer import get_user_platform_data
                top_posts, avg_likes, avg_comments = get_user_platform_data(req.platform, token)
                ui = sessions_module.sessions.get(x_session_id, {}).get(req.platform, {}).get("user_info", {})
                user_data = {
                    "top_posts": top_posts,
                    "avg_likes": avg_likes,
                    "avg_comments": avg_comments,
                    "username": ui.get("username") or ui.get("name", ""),
                }
        raw_results = {req.platform: score_post(req.draft, req.platform, req.topic, req.media_type, user_data=user_data, persona=req.persona)}

    benchmarks = {}
    results = {}
    for plat, data in raw_results.items():
        bm = data.pop("_benchmark", None)
        if bm:
            benchmarks[plat] = bm
        results[plat] = data

    # Attach connected-account info so frontend knows which platforms to show Publish button
    connected = {}
    if x_session_id:
        for plat in results:
            sess_plat = sessions_module.sessions.get(x_session_id, {}).get(plat, {})
            if sess_plat:
                ui = sess_plat.get("user_info") or {}
                connected[plat] = {
                    "username": ui.get("username") or ui.get("name", ""),
                    "blocked": sess_plat.get("blocked", False),
                }

    recommendation = recommend_publishing(results, benchmarks, req.goal, persona=req.persona) if req.platform == "all" else {}

    return {"results": results, "benchmarks": benchmarks, "connected": connected, "recommendation": recommendation}

# ---- Auth ----

@app.get("/auth/{platform}/start")
def auth_start(platform: str, session_id: str):
    return auth.auth_start(platform, session_id)

@app.get("/auth/{platform}/callback")
def auth_callback(platform: str, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error or not code or not state:
        return HTMLResponse(auth.ERROR_POPUP_HTML.format(platform=platform))
    return auth.auth_callback(platform, code, state)

@app.get("/auth/status")
def auth_status(x_session_id: Optional[str] = Header(default=None)):
    if not x_session_id:
        return {"connected": {}}
    sess = sessions_module.get_session(x_session_id)
    connected = {}
    for plat, data in sess.items():
        ui = data.get("user_info") or {}
        connected[plat] = {
            "username": ui.get("username") or ui.get("name", ""),
            "blocked": data.get("blocked", False),
        }
    return {"connected": connected}

@app.delete("/auth/{platform}")
def auth_disconnect(platform: str, x_session_id: Optional[str] = Header(default=None)):
    if x_session_id and platform in sessions_module.sessions.get(x_session_id, {}):
        del sessions_module.sessions[x_session_id][platform]
    return {"ok": True}

# ---- Config (OAuth credentials) ----

class ConfigRequest(BaseModel):
    platform: str
    client_id: str
    client_secret: str

@app.get("/config")
def get_config():
    """Returns configured status per platform — secrets are never sent to the frontend."""
    return cfg_module.get_all_status()

@app.post("/config")
def save_config(req: ConfigRequest):
    cfg_module.save_config(req.platform, req.client_id.strip(), req.client_secret.strip())
    return {"ok": True, "platform": req.platform}

@app.delete("/config/{platform}")
def clear_config(platform: str):
    cfg_module.clear_config(platform)
    return {"ok": True, "platform": platform}

# ---- Publish ----

# ---- Insights ----

@app.get("/insights")
def insights(
    instagram: Optional[str] = None,
    tiktok: Optional[str] = None,
    twitter: Optional[str] = None,
    youtube: Optional[str] = None,
    facebook: Optional[str] = None,
):
    identifiers = {
        "instagram": instagram,
        "tiktok": tiktok,
        "twitter": twitter,
        "youtube": youtube,
        "facebook": facebook,
    }
    return generate_account_insights(identifiers)

# ---- Campaign Pack ----

@app.post("/campaign")
def campaign(req: CampaignRequest):
    return generate_campaign_pack(req.campaign_goal, req.persona, req.goal)

# ---- Campaign Creatives (poster background image + layer regeneration) ----

@app.post("/generate-image")
def generate_image(req: GenerateImageRequest):
    return image_gen.generate_background(req.prompt, req.group)

@app.post("/regenerate-layer")
def regenerate_layer(req: RegenerateLayerRequest):
    return generate_headline_options(req.campaign_goal, req.group, req.layer, req.persona)

# ---- Pexels stock photos (alternative creative background source) ----

@app.post("/pexels/search")
def pexels_search(req: PexelsSearchRequest):
    return {"photos": pexels.search(req.query, req.group)}

@app.post("/pexels/image")
def pexels_image(req: PexelsImageRequest):
    return pexels.fetch_as_data_url(req.url)

# ---- Video Analyzer ----

@app.post("/analyze-video")
async def analyze_video_endpoint(
    file: UploadFile = File(...),
    topic: str = Form(default="science innovation"),
):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        result = video_analyzer.analyze_video(tmp_path, topic)
    finally:
        os.unlink(tmp_path)
    return result

# ---- Image Analyzer ----

@app.post("/analyze-image")
async def analyze_image_endpoint(
    file: UploadFile = File(...),
    topic: str = Form(default="science innovation"),
):
    suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        result = video_analyzer.analyze_image(tmp_path, topic)
    finally:
        os.unlink(tmp_path)
    return result

# ---- Publish ----

@app.post("/publish")
def publish_endpoint(req: PublishRequest, x_session_id: Optional[str] = Header(default=None)):
    if not x_session_id:
        raise HTTPException(status_code=401, detail="No session ID")
    token = sessions_module.get_token(x_session_id, req.platform)
    if not token:
        raise HTTPException(status_code=401, detail=f"Not connected to {req.platform}")
    ui = sessions_module.sessions.get(x_session_id, {}).get(req.platform, {}).get("user_info", {})
    user_id = (ui or {}).get("id")
    result = publish.publish_post(req.platform, token, req.text, user_id=user_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Publish failed"))
    return result
