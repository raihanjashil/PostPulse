# SETUP.md — Step by Step Run Guide

## Prerequisites
- Python 3.10+
- Node.js 18+
- A RapidAPI account (free) — rapidapi.com
- An Anthropic API key — console.anthropic.com

---

## Step 1 — Get Your API Keys

### RapidAPI Key
1. Go to rapidapi.com → sign up free
2. Subscribe (free tier) to these 4 APIs:
   - instagram120
   - tiktok-api123
   - twitter-api45
   - youtube138
3. Your key is shown on any API page under "X-RapidAPI-Key"

### Anthropic API Key
1. Go to console.anthropic.com → sign up
2. Go to API Keys → Create Key
3. Copy the key (starts with sk-ant-...)

---

## Step 2 — Add Keys to Code

Open `backend/data_layer.py` line 3:
```python
RAPIDAPI_KEY = "PASTE_YOUR_RAPIDAPI_KEY_HERE"
```

Open `backend/scorer.py` line 4:
```python
client = anthropic.Anthropic(api_key="PASTE_YOUR_ANTHROPIC_KEY_HERE")
```

---

## Step 3 — Run the Backend

```bash
# Open terminal, go to backend folder
cd backend

# Install dependencies
pip install fastapi uvicorn anthropic requests pydantic

# Start the server
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

Test it works — open browser and go to:
```
http://localhost:8000
```
Should show: `{"status":"Stars of Science Scorer is live"}`

---

## Step 4 — Run the Frontend

```bash
# Open a NEW terminal (keep backend running)
cd frontend

# If you haven't set up React yet:
npm create vite@latest . --template react
# Say yes to overwrite

# Install dependencies
npm install

# Replace src/App.jsx with the provided App.jsx file

# Start frontend
npm run dev
```

Open browser: `http://localhost:5173`

---

## Step 5 — Test the Full Flow

1. Open `http://localhost:5173`
2. Paste this test post:
   ```
   Exciting news from Stars of Science! 
   Our innovators are changing the world. Watch now.
   #science #innovation #qatar
   ```
3. Select "All Platforms"
4. Click "Score My Post"
5. Wait 10-15 seconds
6. You should see score cards for each platform

---

## Step 6 — Deploy for Submission

### Deploy Backend to Render (free)
1. Push your code to GitHub
2. Go to render.com → New Web Service
3. Connect your GitHub repo
4. Settings:
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port 8000`
5. Add environment variables:
   - `RAPIDAPI_KEY` = your key
   - `ANTHROPIC_API_KEY` = your key
6. Click Deploy
7. Copy your Render URL (e.g. https://sos-scorer.onrender.com)

### Update Frontend API URL
In `frontend/src/App.jsx` find:
```js
fetch("http://localhost:8000/score"
```
Change to:
```js
fetch("https://YOUR-RENDER-URL.onrender.com/score"
```

### Deploy Frontend to Vercel (free)
1. Go to vercel.com → New Project
2. Import your GitHub repo
3. Framework: Vite
4. Root directory: `frontend`
5. Click Deploy
6. Copy your Vercel URL

---

## Submission Files

Create a folder with:
```
TeamName_Deck.pdf        ← pitch deck
TeamName_Roadmap.pdf     ← PRD document  
TeamName_DemoLink.txt    ← paste your Vercel URL here
```

Upload to the Google Drive folder (barcode shared at event).

**Deadline: Saturday June 13, 2026 — 11:59 PM. No late submissions.**

---

## Common Errors

| Error | Fix |
|-------|-----|
| `CORS error in browser` | Make sure backend is running on port 8000 |
| `Could not connect to backend` | Run `uvicorn main:app --reload --port 8000` |
| `anthropic.AuthenticationError` | Check your Anthropic API key |
| `RapidAPI 403` | Make sure you subscribed to the free tier |
| `json.JSONDecodeError` | Claude returned non-JSON — retry, usually fixes itself |
| `Module not found` | Run `pip install -r requirements.txt` again |
