<div align="center">

# 🚀 PostPulse

### AI Content Optimizer for **Stars of Science**

*Score it. Edit it. Score the music. Publish it — all in one place.*

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o-412991?logo=openai&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-Video%20%2B%20Audio-007808?logo=ffmpeg&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)
![Status](https://img.shields.io/badge/status-hackathon%20build-blueviolet)

</div>

---

## ✨ What is PostPulse?

PostPulse is an end-to-end **AI content studio** built for the *Stars of Science* social channels. Paste a draft, upload a video, or start a campaign — PostPulse scores your content against real platform benchmarks, rewrites it, edits your video with AI, scores and mixes in matching music, generates campaign creatives, and publishes straight to your connected accounts.

One backend (FastAPI), one zero-build frontend (vanilla JS), six platforms, and a whole pipeline from *draft* to *published*.

---

## 🎯 Features

### 📝 1. AI Post Scorer
Score any draft across **Twitter/X, LinkedIn, and Facebook** in one shot.
- **5-dimension scoring** — hook, clarity, CTA, format, and tone
- **Hard-rule checks** — character limits, format violations, platform gotchas
- **AI rewrite** of your draft, optimized per platform
- **Algorithm Decoder** — signal-by-signal verdict on how each platform's algorithm will treat the post
- **Audience variants** — region/persona-tailored rewrites with rationale
- **Best time to post** + **hashtag suggestions**
- **Persona targeting** — `general` · `applicants` · `viewers` · `sponsors`
- **Goal-aware ranking** — `reach` · `engagement` · `conversions`
- Bilingual aware (English / Arabic auto-detection)

### 📊 2. Account Insights & Benchmarks
- Pulls **real engagement data** (top posts, avg likes/comments, comment rate, engagement quality)
- Falls back to **Stars of Science benchmarks** when no account is connected
- Scores are graded against *your own* historical performance when available

### 🎬 3. AI Video Editor
Upload a video and let AI do the cutting.
- **Auto-analysis** — transcription (faster-whisper), scene/quality read, platform-fit suggestions
- **One-click Auto-Edit** — apply AI suggestions into a rendered, ready-to-post cut
- **Chat-driven editing** — *"make it vertical for TikTok"*, *"trim the first 3 seconds"* — natural-language edit commands
- **Smart resize** per platform aspect ratio
- **Versioned renders** — `v1`, `v2`, `v3`… originals are **never** overwritten
- Full **version history** with download links

### 🎵 4. AI Music Match & Mixer
Find and mix the perfect track — powered by **Jamendo**.
- **Mood detection** from your video's transcript (GPT-driven)
- **Track recommendations** matched to mood + target platform
- **Shared preview player** to audition tracks
- **Audio analysis** via ffprobe — detects audio presence, speech, codec, channels, duration
- **3 mixing modes:**
  - 🔊 **Keep Original** — no change
  - 🎚️ **Mix Background Music** — blends music under your audio (`amix`), auto-ducks volume when speech is detected
  - 🔁 **Replace Audio** — swaps in the track entirely
- **Auto trim / loop** to match video length, with **fade in/out**
- Browser-friendly **AAC** output, fast **stream-copy** video codec
- Safe downloads (URL validation, timeout, size checks) and clear warnings — no silent failures

### 🎨 5. Campaign Pack & Creatives
- **One-prompt campaign packs** — copy, angles, and creative direction from a single goal
- **AI image generation** for poster backgrounds (social & LinkedIn formats)
- **Layer regeneration** — regenerate just the headline, subheadline, or CTA
- **Pexels stock photo** search & import as an alternative background source

### 🔌 6. Connect & Publish
- **OAuth 2.0 + PKCE** account connection (Twitter/X, LinkedIn live; Instagram/Facebook/TikTok/YouTube gated behind app approval)
- **Publish directly** to connected platforms
- Per-platform connection status surfaced in the UI

---

## 🏗️ Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────────────┐
│  Frontend (vanilla JS/HTML)  │  HTTP   │           FastAPI Backend              │
│  final/frontend/             │ ──────▶ │           final/backend/               │
│   • index.html / app.html    │         │                                        │
│   • app.js  • styles.css     │         │  main.py ── API router                 │
└─────────────────────────────┘         │   ├─ scorer.py ........ scoring + AI    │
                                         │   ├─ data_layer.py .... benchmarks      │
            ┌────────────────────────────┤   ├─ auth.py / sessions / publish      │
            │                            │   ├─ video_analyzer + ai_edit_suggest.  │
   ┌────────▼─────────┐                  │   ├─ auto_edit_pipeline + edit_studio   │
   │  OpenAI (GPT-4o)  │                 │   ├─ music_matcher + audio_analysis     │
   │  Jamendo (music)  │                 │   ├─ music_mixer (FFmpeg)               │
   │  Pexels (stock)   │                 │   ├─ image_gen + pexels + brand_config  │
   │  Platform OAuth   │                 │   └─ platform_config                    │
   └───────────────────┘                 └────────────────────────────────────────┘
```

**Resilient by design:** the heavy AI-editing stack (`av`, `faster-whisper`, `imageio-ffmpeg`) is **optional** — if it isn't installed, those routes return a clean `503` while the rest of the API boots normally.

---

## 🛠️ Tech Stack

| Layer        | Tech                                                                 |
|--------------|----------------------------------------------------------------------|
| Backend      | Python 3.10+, FastAPI, Uvicorn, Pydantic                             |
| AI           | OpenAI GPT-4o / GPT-4o-mini, faster-whisper (transcription)          |
| Media        | FFmpeg / ffprobe (via imageio-ffmpeg), PyAV, OpenCV, NumPy           |
| Integrations | Jamendo (music), Pexels (stock photos), Twitter/X & LinkedIn OAuth   |
| Frontend     | Vanilla JavaScript, HTML, CSS (no build step)                        |

---

## 🚀 Getting Started

### Prerequisites
- Python **3.10+**
- **FFmpeg** + ffprobe on your PATH (or rely on the bundled `imageio-ffmpeg`)
- API keys: OpenAI, Jamendo, Pexels (see below)

### 1. Backend

```bash
cd final/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` in `final/backend/` (**never commit this**):

```env
OPENAI_API_KEY=your_openai_key
OPENAI_MUSIC_MATCH_MODEL=gpt-4o-mini
JAMENDO_CLIENT_ID=your_jamendo_client_id
JAMENDO_CLIENT_SECRET=your_jamendo_secret
PEXELS_API_KEY=your_pexels_key
RAPIDAPI_KEY=your_rapidapi_key
```

Run it:

```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend

The backend serves the frontend automatically — just open **http://localhost:8000**.
(Or serve `final/frontend/` with any static server; it talks to the API at `http://localhost:8000`.)

---

## 📡 API Reference (highlights)

| Method | Endpoint                         | Purpose                                        |
|--------|----------------------------------|------------------------------------------------|
| `POST` | `/score`                         | Score a draft across platforms                 |
| `GET`  | `/insights`                      | Account insights & benchmarks                  |
| `POST` | `/campaign`                      | Generate a full campaign pack                  |
| `POST` | `/generate-image`                | AI poster background                           |
| `POST` | `/regenerate-layer`              | Regenerate headline / subheadline / CTA        |
| `POST` | `/pexels/search` · `/pexels/image` | Stock photo search & import                  |
| `POST` | `/analyze-video`                 | Transcribe + analyze an uploaded video         |
| `POST` | `/apply-auto-edit`               | Render an AI auto-edited version               |
| `POST` | `/chat-edit-video`               | Natural-language video editing                 |
| `POST` | `/music/recommend`               | Mood-matched music recommendations             |
| `POST` | `/music/analyze-audio`           | ffprobe audio + speech analysis                |
| `POST` | `/music/add-to-video`            | Mix / replace / keep audio with FFmpeg         |
| `GET`  | `/download/edited-video/{id}/{f}`| Download a rendered version                    |
| `*`    | `/auth/{platform}/*` · `/publish`| OAuth connect & publish                        |

Interactive docs available at **http://localhost:8000/docs** while the server runs.

---

## 📁 Project Structure

```
QSTP-Hackathon/
└── final/
    ├── backend/
    │   ├── main.py                 # FastAPI app & routes
    │   ├── scorer.py               # AI scoring engine
    │   ├── data_layer.py           # Benchmarks, rules, account stats
    │   ├── auth.py / sessions.py   # OAuth (PKCE) + session store
    │   ├── publish.py              # Publish to Twitter/X & LinkedIn
    │   ├── video_analyzer.py       # Video/image analysis
    │   ├── ai_edit_suggestions.py  # AI edit suggestions
    │   ├── auto_edit_pipeline.py   # Render pipeline + versioning
    │   ├── edit_studio.py          # Chat-driven edit planner
    │   ├── music_matcher.py        # Jamendo mood matching
    │   ├── audio_analysis.py       # ffprobe audio/speech detection
    │   ├── music_mixer.py          # FFmpeg mixing (3 modes)
    │   ├── image_gen.py / pexels.py# Creatives & stock photos
    │   ├── brand_config.py         # Brand profile & personas
    │   └── platform_config.py      # Per-platform OAuth config
    └── frontend/
        ├── index.html / app.html
        ├── app.js
        └── styles.css
```

---

## 🗺️ Roadmap

- 🎼 Real music classification (audio ML) — currently a placeholder
- 📈 LUFS loudness normalization
- ⚡ Parallel / batched FFmpeg processing
- 📱 Instagram, TikTok, YouTube publishing (pending app approval)
- ☁️ Cloud storage + background job queue for long renders

---

## ⚠️ Notes

- This is a **hackathon build** — CORS is open and sessions are in-memory by design.
- **Keep your `.env` out of version control** and rotate any key that has ever been committed.

---

<div align="center">

Built with ☕ and 🎬 for the **QSTP Hackathon** · *Stars of Science*

</div>
