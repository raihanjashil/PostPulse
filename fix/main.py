import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, FileResponse
from pydantic import BaseModel
import ai_edit_suggestions
import auto_edit_pipeline
import edit_studio
import music_matcher
import auth
import publish
import sessions as sessions_module
import platform_config as cfg_module
import audio_analysis
import music_mixer
from scorer import score_post, score_all_platforms, recommend_publishing, generate_account_insights

app = FastAPI(title="SoS Content Scorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"

# ---- Models ----

class ScoreRequest(BaseModel):
    draft: str
    platform: str = "all"
    topic: str = "science innovation"
    media_type: str = "text"
    goal: str = "reach"  # "reach" | "engagement" | "conversions"

class PublishRequest(BaseModel):
    platform: str
    text: str


class MusicRecommendRequest(BaseModel):
    transcript: Any = None
    metadata: dict[str, Any] = {}
    target_platform: str = "instagram"
    mood: Optional[str] = None


class MusicAnalysisRequest(BaseModel):
    video_id: Optional[str] = None
    transcript: Any = None


class AddMusicToVideoRequest(BaseModel):
    video_id: str
    track: dict[str, Any]
    audio_url: Optional[str] = None
    audio_mode: str = "mix_background_music"  # keep_original, mix_background_music, replace_audio
    music_volume: float = 0.18
    original_volume: float = 1.0
    fade_in_seconds: float = 1.0
    fade_out_seconds: float = 1.5


def _parse_json_form(value: str, default: Any) -> Any:
    try:
        return json.loads(value or "")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {exc}") from exc


async def _resolve_source_video(
    upload: UploadFile | None,
    video_id: str | None,
    prefer_existing_video_id: bool = False,
) -> tuple[str, Path]:
    resolved_video_id = (video_id or uuid4().hex[:10]).strip()
    if not resolved_video_id:
        resolved_video_id = uuid4().hex[:10]

    if prefer_existing_video_id:
        existing_source_path = auto_edit_pipeline.find_source_path(resolved_video_id)
        if existing_source_path is not None and existing_source_path.exists():
            return resolved_video_id, existing_source_path

    if upload is not None and upload.filename:
        suffix = Path(upload.filename).suffix or ".mp4"
        source_path = auto_edit_pipeline.build_source_path(resolved_video_id, suffix)
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(await upload.read())
        return resolved_video_id, source_path

    source_path = auto_edit_pipeline.find_source_path(resolved_video_id)
    if source_path is None or not source_path.exists():
        raise HTTPException(status_code=400, detail="A source video file or valid video_id is required.")
    return resolved_video_id, source_path


def _build_version_urls(video_id: str, filename: str) -> dict[str, str]:
    url = f"/download/edited-video/{video_id}/{filename}"
    return {"download_url": url, "preview_url": url}


def _build_version_history(video_id: str) -> list[str]:
    return ["Original Video", *auto_edit_pipeline.list_rendered_versions(video_id)]

# ---- Health ----

@app.get("/")
def root():
    index_path = frontend_dir / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path), media_type="text/html")
    return {"status": "Stars of Science Scorer is live"}

@app.get("/health")
def health():
    return {"status": "ok"}

# ---- Score ----

@app.post("/score")
def score(req: ScoreRequest, x_session_id: Optional[str] = Header(default=None)):
    if req.platform == "all":
        raw_results = score_all_platforms(
            req.draft, req.topic, req.media_type, session_id=x_session_id
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
        raw_results = {req.platform: score_post(req.draft, req.platform, req.topic, req.media_type, user_data=user_data)}

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

    recommendation = recommend_publishing(results, benchmarks, req.goal) if req.platform == "all" else {}

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
def insights():
    return generate_account_insights()

# ---- Video Analyzer ----

@app.post("/analyze-video")
async def analyze_video_endpoint(
    file: Optional[UploadFile] = File(default=None),
    video: Optional[UploadFile] = File(default=None),
    target_platform: str = Form(default="instagram"),
    goal: Optional[str] = Form(default=None),
    topic: str = Form(default="science innovation"),
):
    upload = video or file
    if upload is None or not upload.filename:
        raise HTTPException(status_code=400, detail="A video file is required.")
    if target_platform not in ai_edit_suggestions.VIDEO_PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported target platform.")
    return await ai_edit_suggestions.analyze_uploaded_video(upload, target_platform, goal, topic)


@app.post("/apply-auto-edit")
async def apply_auto_edit_endpoint(
    file: Optional[UploadFile] = File(default=None),
    video: Optional[UploadFile] = File(default=None),
    video_id: Optional[str] = Form(default=None),
    analysis_json: str = Form(default="{}"),
    target_platform: str = Form(default="instagram"),
):
    upload = video or file
    payload = _parse_json_form(analysis_json, {})

    resolved_video_id, source_path = await _resolve_source_video(upload, video_id)
    version_number = auto_edit_pipeline.next_version_number(resolved_video_id)
    output_path = auto_edit_pipeline.build_version_path(resolved_video_id, version_number)

    result = await asyncio.to_thread(
        auto_edit_pipeline.apply_auto_edit_from_upload,
        source_path,
        payload,
        target_platform,
        output_path,
        [],
    )

    filename = output_path.name
    urls = _build_version_urls(resolved_video_id, filename)
    return {
        **result,
        **urls,
        "video_id": resolved_video_id,
        "version_number": version_number,
        "version_filename": filename,
        "current_edit_history": [],
        "version_history": _build_version_history(resolved_video_id),
        "assistant_response": "Applied the current AI suggestions and rendered a new editable version.",
    }


@app.post("/chat-edit-video")
async def chat_edit_video_endpoint(
    file: Optional[UploadFile] = File(default=None),
    video: Optional[UploadFile] = File(default=None),
    video_id: Optional[str] = Form(default=None),
    analysis_json: str = Form(default="{}"),
    current_edit_history_json: str = Form(default="[]"),
    user_instruction: str = Form(...),
    current_version: Optional[str] = Form(default=None),
    target_platform: str = Form(default="instagram"),
):
    upload = video or file
    payload = _parse_json_form(analysis_json, {})
    current_edit_history = _parse_json_form(current_edit_history_json, [])
    if not isinstance(current_edit_history, list):
        raise HTTPException(status_code=400, detail="current_edit_history_json must decode to a list.")

    resolved_video_id = (video_id or uuid4().hex[:10]).strip() or uuid4().hex[:10]
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    effective_target_platform = (
        target_platform
        or payload.get("target_platform")
        or (payload.get("analysis") or {}).get("target_platform")
        or "instagram"
    )

    try:
        plan = edit_studio.plan_chat_edit(
            user_instruction=user_instruction,
            metadata=metadata,
            current_edit_history=current_edit_history,
            target_platform=effective_target_platform,
            current_version=current_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if plan.get("needs_clarification"):
        return {
            "needs_clarification": True,
            "conversation_only": bool(plan.get("conversation_only")),
            "question": plan.get("question") or "What timestamp should I apply this edit to?",
            "assistant_response": plan.get("assistant_response") or "I need one more detail before I can apply that edit.",
            "video_id": resolved_video_id,
            "current_edit_history": current_edit_history,
            "version_history": _build_version_history(resolved_video_id),
        }

    resolved_video_id, source_path = await _resolve_source_video(
        upload,
        resolved_video_id,
        prefer_existing_video_id=True,
    )
    new_commands = list(plan.get("edit_commands") or [])
    combined_history = current_edit_history + new_commands
    for command in reversed(combined_history):
        if str(command.get("type", "")).strip() == "resize" and str(command.get("platform", "")).strip():
            effective_target_platform = str(command.get("platform")).strip().lower()
            break

    version_number = auto_edit_pipeline.next_version_number(resolved_video_id)
    output_path = auto_edit_pipeline.build_version_path(resolved_video_id, version_number)
    result = await asyncio.to_thread(
        auto_edit_pipeline.apply_auto_edit_from_upload,
        source_path,
        payload,
        effective_target_platform,
        output_path,
        combined_history,
    )

    filename = output_path.name
    urls = _build_version_urls(resolved_video_id, filename)
    return {
        **result,
        **urls,
        "needs_clarification": False,
        "question": "",
        "assistant_response": plan.get("assistant_response") or "Applied your edit instruction and rendered a new version.",
        "video_id": resolved_video_id,
        "version_number": version_number,
        "version_filename": filename,
        "applied_edit_commands": new_commands,
        "current_edit_history": combined_history,
        "version_history": _build_version_history(resolved_video_id),
    }


@app.post("/music/recommend")
def music_recommend_endpoint(req: MusicRecommendRequest):
    try:
        return music_matcher.recommend_music(
            transcript=req.transcript,
            metadata=req.metadata,
            target_platform=req.target_platform,
            mood=req.mood,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        return {
            "mood": "inspiring",
            "confidence": 0.0,
            "mood_reason": "Music matching failed before recommendations could be generated.",
            "tags": "inspirational,uplifting",
            "tracks": [],
            "warnings": [f"Music matching failed: {exc}"],
            "jamendo_configured": False,
            "music_mixing_available": False,
        }


@app.post("/music/analyze-audio")
async def analyze_audio_endpoint(req: MusicAnalysisRequest):
    """
    Analyze audio properties of an uploaded or existing video.
    
    Returns audio detection status, speech detection, and combined warnings.
    Requires either video_id (for existing video) or will need to be called after upload.
    """
    try:
        video_id = (req.video_id or "").strip()
        if not video_id:
            raise HTTPException(
                status_code=400,
                detail="video_id is required for audio analysis"
            )
        
        # Find source video
        source_path = auto_edit_pipeline.find_source_path(video_id)
        if not source_path or not source_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Video not found for video_id: {video_id}"
            )
        
        # Analyze audio
        analysis_result = audio_analysis.analyze_audio(
            video_path=source_path,
            transcript=req.transcript,
        )
        
        return {
            "video_id": video_id,
            "audio_detected": analysis_result["audio_detected"],
            "audio_codec": analysis_result["audio_codec"],
            "audio_channels": analysis_result["audio_channels"],
            "sample_rate": analysis_result["sample_rate"],
            "audio_bitrate": analysis_result["audio_bitrate"],
            "audio_duration": analysis_result["audio_duration"],
            "audio_loudness": analysis_result["audio_loudness"],
            "speech_detected": analysis_result["speech_detected"],
            "music_detected": analysis_result["music_detected"],
            "warnings": analysis_result["warnings"],
        }
    
    except HTTPException:
        raise
    except Exception as exc:
        return {
            "video_id": req.video_id or "unknown",
            "audio_detected": False,
            "audio_codec": None,
            "audio_channels": 0,
            "sample_rate": 0,
            "audio_bitrate": 0,
            "audio_duration": 0.0,
            "audio_loudness": None,
            "speech_detected": False,
            "music_detected": None,
            "warnings": [f"Audio analysis failed: {exc}"],
        }


@app.post("/music/add-to-video")
async def add_music_to_video_endpoint(req: AddMusicToVideoRequest):
    """
    Add selected Jamendo music to edited video.
    
    Supports three audio modes:
    - keep_original: No music added, original audio preserved
    - mix_background_music: Mix selected music underneath original audio
    - replace_audio: Replace original audio with selected music
    
    Returns output video path, warnings, and success status.
    """
    try:
        video_id = (req.video_id or "").strip()
        if not video_id:
            raise HTTPException(
                status_code=400,
                detail="video_id is required"
            )
        
        if not req.track:
            raise HTTPException(
                status_code=400,
                detail="track object is required"
            )
        
        # Find latest edited video (or source if no edits)
        versions = auto_edit_pipeline.list_rendered_versions(video_id)
        if versions:
            video_path = auto_edit_pipeline.build_version_path(video_id, len(versions))
        else:
            # Use source video if no edits exist
            source_path = auto_edit_pipeline.find_source_path(video_id)
            if not source_path or not source_path.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"No video found for video_id: {video_id}"
                )
            video_path = source_path
        
        # Check if speech was detected in transcript (if provided)
        speech_detected = False
        if isinstance(req.track, dict) and "speech_detected" in req.track:
            speech_detected = req.track.get("speech_detected", False)
        
        # Add music to video
        result = await asyncio.to_thread(
            music_mixer.add_music_to_video,
            video_path=video_path,
            track=req.track,
            audio_url=req.audio_url,
            audio_mode=req.audio_mode,
            music_volume=req.music_volume,
            original_volume=req.original_volume,
            fade_in_seconds=req.fade_in_seconds,
            fade_out_seconds=req.fade_out_seconds,
            speech_detected=speech_detected,
            video_id=video_id,
        )
        
        if result["success"]:
            return {
                "success": True,
                "video_id": video_id,
                "output_path": result["output_path"],
                "output_url": result["output_url"],
                "output_filename": result.get("output_filename"),
                "audio_mode": result["audio_mode"],
                "audio_preserved": result["audio_preserved"],
                "music_added": result["music_added"],
                "track_title": result.get("track_title"),
                "track_artist": result.get("track_artist"),
                "video_duration_seconds": result.get("video_duration_seconds"),
                "warnings": result.get("warnings", []),
                "version_history": _build_version_history(video_id),
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="; ".join(result.get("warnings", ["Unknown error"]))
            )
    
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Music addition failed: {exc}"
        ) from exc


@app.get("/download/edited-video")
def download_edited_video():
    output_path = auto_edit_pipeline.latest_render_path()
    if output_path is None or not output_path.exists():
        raise HTTPException(status_code=404, detail="No edited video has been generated yet.")
    return FileResponse(str(output_path), media_type="video/mp4", filename="edited_video.mp4")


@app.get("/download/edited-video/{video_id}/{filename}")
def download_edited_video_version(video_id: str, filename: str):
    safe_filename = Path(filename).name
    if safe_filename != filename or not safe_filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid edited video filename.")

    output_path = auto_edit_pipeline.get_video_workspace(video_id) / safe_filename
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Edited video version not found.")
    return FileResponse(str(output_path), media_type="video/mp4", filename=safe_filename)

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

@app.get("/{path:path}")
def frontend_assets(path: str):
    frontend_path = frontend_dir / path
    if frontend_path.exists() and frontend_path.is_file():
        if frontend_path.suffix == ".css":
            media_type = "text/css"
        elif frontend_path.suffix == ".js":
            media_type = "application/javascript"
        elif frontend_path.suffix == ".html":
            media_type = "text/html"
        else:
            media_type = "application/octet-stream"
        return FileResponse(str(frontend_path), media_type=media_type)
    raise HTTPException(status_code=404, detail="Not Found")
