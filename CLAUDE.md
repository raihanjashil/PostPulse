# CLAUDE.md — Stars of Science AI Content Scorer

## What This Project Is
An AI-powered social media content scorer built for the QSTP Stars of Science Hackathon 2026.
It scores draft posts before publishing across Instagram, TikTok, Twitter/X, YouTube, LinkedIn, and Facebook.
It uses REAL data from RapidAPI scrapers + OpenAI for scoring and rewriting.

## Stack
- **Backend**: Python, FastAPI, OpenAI SDK, Requests
- **Frontend**: React (Vite), plain CSS-in-JS (no Tailwind)
- **AI**: OpenAI gpt-4o-mini via OpenAI API
- **Data**: RapidAPI (Instagram120, TikTok API123, Twitter API45, YouTube138, Facebook scraper TBD)

## Project Structure
```
sos-scorer/
├── backend/
│   ├── main.py          ← FastAPI app, CORS, /score endpoint
│   ├── scorer.py        ← Claude API scoring logic
│   ├── data_layer.py    ← All RapidAPI calls + hard rules + posting times
│   └── requirements.txt
├── frontend/
│   └── src/
│       └── App.jsx      ← Full React UI
├── CLAUDE.md            ← YOU ARE HERE
├── PLAN.md              ← Feature roadmap
├── ARCHITECTURE.md      ← System design
└── SETUP.md             ← How to run
```

## Environment Variables Needed
```
RAPIDAPI_KEY=your_rapidapi_key
OPENAI_API_KEY=your_openai_key
```
These are loaded from a `.env` file (gitignored) via python-dotenv.
See `.env.example` for the template.

## Key Files to Know

### data_layer.py
- `get_instagram_posts(username)` → list of posts with likes/comments
- `get_tiktok_posts(username)` → list of posts with views/likes
- `get_twitter_posts(username)` → list of tweets with likes/retweets
- `get_youtube_videos(channel_id)` → list of videos with views/likes
- `get_facebook_posts(username)` → list of posts with likes/comments (RapidAPI endpoint TBD)
- `hard_rules_check(post, platform)` → list of rule violation strings
- `OPTIMAL_POSTING_TIMES` → dict of best times per platform (MENA-specific)
- `get_platform_data(platform)` → returns (top_posts, avg_likes, avg_comments)

### scorer.py
- `score_post(draft, platform, topic)` → dict with score JSON from OpenAI (gpt-4o-mini)
- `score_all_platforms(draft, topic)` → runs score_post for all 6 platforms
- Returns JSON: { overall_score, scores{hook,clarity,cta,format,tone}, strengths, weaknesses, rule_flags, rewritten, best_time_to_post, hashtag_suggestions }

### main.py
- POST `/score` → body: { draft, platform, topic }
- platform can be "all" or one of: instagram, tiktok, twitter, youtube, linkedin, facebook
- Returns: { results: { platform: scoreObject } }

### App.jsx
- State: draft, topic, platform, results, loading, error
- Calls POST http://localhost:8000/score
- Shows PlatformCard per platform with expandable details
- Shows ScoreBar for each sub-dimension

## Current Known Issues / TODOs
- LinkedIn has no RapidAPI scraper — returns empty list, AI scores on rules only
- Facebook scraper endpoint is a placeholder — needs a real RapidAPI Facebook host/endpoint
- YouTube channel ID is placeholder — needs real Stars of Science channel ID
- TikTok secUid needs to be fetched first (not the username directly)
- No caching — every score call hits RapidAPI fresh (add Redis or simple dict cache)
- No Arabic language support yet (planned feature)

## How to Run
See SETUP.md

## Coding Conventions
- Python: snake_case, type hints where possible, try/except around all API calls
- React: functional components, useState only, no external state library
- All API calls have timeout=10 and return empty list on failure (never crash)
- Claude prompt always asks for JSON only — strip markdown fences before parsing
- Dark theme UI: background #0d0d0d, cards #1a1a1a, accent #00b894

## Do Not
- Do not add authentication — this is a hackathon MVP
- Do not use TypeScript — plain JSX only
- Do not add a database — keep it stateless for now
- Do not change the scoring JSON schema — frontend depends on it
