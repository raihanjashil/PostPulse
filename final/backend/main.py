from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scorer import score_post, score_all_platforms

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

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/score")
def score(req: ScoreRequest):
    if req.platform == "all":
        raw_results = score_all_platforms(req.draft, req.topic, req.media_type)
    else:
        raw_results = {req.platform: score_post(req.draft, req.platform, req.topic, req.media_type)}

    # Extract _benchmark from each platform result into a separate top-level key
    # so frontend can display benchmark data without digging into score objects
    benchmarks = {}
    results = {}
    for plat, data in raw_results.items():
        bm = data.pop("_benchmark", None)
        if bm:
            benchmarks[plat] = bm
        results[plat] = data

    return {
        "results": results,
        "benchmarks": benchmarks,
    }
