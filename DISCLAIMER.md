# Deployment Disclaimer

## Why there is no permanent live link

PostPulse is **fully built and functional**, but we are not hosting a 24/7 public URL for it. This is a cost limitation, not a technical one.

The app's AI features depend on a heavy stack — `faster-whisper` (speech-to-text), `av`/FFmpeg (video + audio processing), `opencv`, and `numpy`. Running these reliably requires a server with **at least ~1 GB of RAM**. The **free tiers** of every major host (Render, Railway, Fly.io) cap memory at ~512 MB, which causes the app to run out of memory and crash the moment it transcribes or edits a video.

A paid instance with enough memory would resolve this immediately, but **we are unable to cover hosting costs** for this submission.

## The project is complete and runnable

Everything needed to deploy is included in this repository:

- A production **`Dockerfile`** (bundles Python + FFmpeg) — ready to push to any host
- Same-origin frontend config and environment-driven OAuth redirect URIs
- Full setup and run instructions in [`README.md`](README.md)

Anyone with a funded hosting account (or a local machine) can run the full app in minutes.

## How to run it locally

```bash
cd final/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then open **http://localhost:8000**. All features — content scoring, AI video editing, music matching/mixing, campaign creatives — work locally with valid API keys in a `.env` file (see [`README.md`](README.md) for the template).

## Summary

> The application is **code-complete and deployment-ready**. A permanent public link is omitted only because reliable hosting for its AI/video workload requires a paid (non-free-tier) server, which is outside our budget for this project. The app can be run locally or deployed by anyone with a funded host using the included `Dockerfile`.
