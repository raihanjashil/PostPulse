import os
import tempfile
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scorer import score_post, score_all_platforms, generate_account_insights
from video_analyzer import analyze_video

app = FastAPI(title="SoS Content Scorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class ScoreRequest(BaseModel):
    draft: str
    platform: str = "all"
    topic: str = "science innovation"
    media_type: str = "text"

@app.get("/")
def root():
    return {"status": "Stars of Science Scorer is live"}

@app.post("/score")
def score(req: ScoreRequest):
    if req.platform == "all":
        return {"results": score_all_platforms(req.draft, req.topic, req.media_type)}
    else:
        return {"results": {req.platform: score_post(req.draft, req.platform, req.topic, req.media_type)}}

@app.get("/insights")
def insights():
    return generate_account_insights()

@app.post("/analyze-video")
async def analyze_video_endpoint(
    file: UploadFile = File(...),
    topic: str = Form("science innovation")
):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        return analyze_video(tmp_path, topic)
    finally:
        os.remove(tmp_path)

@app.get("/health")
def health():
    return {"status": "ok"}
