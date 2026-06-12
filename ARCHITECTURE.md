# ARCHITECTURE.md — System Design

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                     USER (Browser)                       │
│                    React App (Vite)                      │
│              http://localhost:5173 (dev)                 │
│              https://sos-scorer.vercel.app (prod)        │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /score
                       │ { draft, platform, topic }
┌──────────────────────▼──────────────────────────────────┐
│                  FastAPI Backend                          │
│              http://localhost:8000 (dev)                 │
│           https://sos-scorer.onrender.com (prod)         │
│                                                          │
│   main.py → scorer.py → data_layer.py                   │
└──────┬──────────────────────────────┬───────────────────┘
       │                              │
       │ OpenAI API                   │ RapidAPI
       │ gpt-4o-mini                  │
       ▼                              ▼
┌─────────────┐              ┌─────────────────────┐
│  OpenAI     │              │   Social Scrapers   │
│  Scoring +  │              │ Instagram120        │
│  Rewriting  │              │ TikTok API123       │
└─────────────┘              │ Twitter API45       │
                             │ YouTube138          │
                             │ Facebook (TBD)      │
                             └─────────────────────┘
```

---

## Request Flow

```
1. User pastes draft post in React UI
2. Clicks "Score My Post"
3. React sends POST /score to FastAPI

4. FastAPI calls scorer.py → score_post(draft, platform)

5. scorer.py calls data_layer.py:
   a. get_platform_data(platform)
      → calls RapidAPI for real SoS posts
      → returns top_posts, avg_likes, avg_comments
   b. hard_rules_check(draft, platform)
      → returns list of rule violations

6. scorer.py builds enriched prompt:
   - Draft text
   - Real benchmark data from step 5
   - MENA posting time recommendations
   - Platform-specific rules

7. scorer.py calls OpenAI API (gpt-4o-mini)
   → Returns JSON: scores, weaknesses, rewrite, hashtags

8. FastAPI returns JSON to React

9. React renders:
   - Score bar per platform
   - Expandable card with full breakdown
   - Rewritten version
   - Hashtag suggestions
   - Best posting time
```

---

## Data Models

### Score Request (input)
```json
{
  "draft": "string — the post text",
  "platform": "all | instagram | tiktok | twitter | youtube | linkedin | facebook",
  "topic": "string — e.g. science innovation"
}
```

### Score Response (output)
```json
{
  "results": {
    "instagram": {
      "overall_score": 72,
      "scores": {
        "hook": 15,
        "clarity": 16,
        "cta": 12,
        "format": 14,
        "tone": 15
      },
      "strengths": ["Strong opening hook", "Good hashtag count"],
      "weaknesses": ["CTA is weak", "Too long for Instagram"],
      "rule_flags": [],
      "rewritten": "Improved version of the post...",
      "best_time_to_post": "Tuesday 6pm Gulf Standard Time",
      "hashtag_suggestions": ["#StarsOfScience", "#ArabInnovation", "#Qatar"]
    }
  }
}
```

---

## Deployment

### Frontend → Vercel (free)
```bash
cd frontend
npm run build
# Push to GitHub → connect to Vercel → auto deploy
```

### Backend → Render (free)
```
New Web Service on render.com
Build command: pip install -r requirements.txt
Start command: uvicorn main:app --host 0.0.0.0 --port 8000
Environment variables: RAPIDAPI_KEY, ANTHROPIC_API_KEY
```

### Update frontend API URL for production
In App.jsx change:
```js
// dev
fetch("http://localhost:8000/score")

// prod
fetch("https://sos-scorer.onrender.com/score")
```

---

## Why This Is Not Just a Prompt Wrapper

| Layer | What It Does |
|-------|-------------|
| RapidAPI Data | Real SoS post history — scores compare against actual performance |
| Hard Rules Engine | Platform constraints checked before OpenAI runs |
| MENA Timing Data | Qatar/Gulf-specific posting windows baked in |
| OpenAI Scoring | Reasoning layer on top of real data, not just vibes |
| Feedback Loop (future) | Store scores + outcomes → calibrate over time |
