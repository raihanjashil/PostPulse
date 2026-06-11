# API CONTRACT — PostPulse Backend

The frontend (`app.js`) expects your Python backend at `http://localhost:8000`.
Change `API_BASE` in `app.js` if you deploy elsewhere.

---

## GET /health

Returns `200 OK` if backend is running. Frontend uses this to toggle between
live mode and mock mode. Any response body is fine (e.g. `{"status": "ok"}`).

---

## POST /api/score

**Request body:**
```json
{
  "draft": "Your post text here...",
  "platforms": ["instagram", "linkedin", "x", "tiktok", "youtube"],
  "audiences": ["applicants", "viewers", "sponsors", "public"]
}
```

**Response body (all 3 layers combined):**
```json
{
  "benchmarks": {
    "instagram": {
      "avgLikes": 340,
      "avgComments": 28,
      "topPostLikes": 1200,
      "topPostCaption": "Applications for Season 16...",
      "postCount": 15,
      "avgScore": 62
    }
    // ... one per platform in request
  },

  "ruleViolations": [
    {
      "type": "fail",
      "platform": "x",
      "message": "Over X's 280-character limit (320 chars)."
    },
    {
      "type": "warn",
      "platform": "linkedin",
      "message": "12 hashtags detected. LinkedIn penalizes over 5."
    },
    {
      "type": "pass",
      "platform": null,
      "message": "CTA detected."
    }
  ],

  "scores": {
    "instagram": {
      "overall": 72,
      "breakdown": [
        { "label": "Hook Strength", "score": 68 },
        { "label": "Caption Quality", "score": 75 },
        { "label": "CTA Clarity", "score": 82 },
        { "label": "Hashtag Strategy", "score": 60 },
        { "label": "Format Fit", "score": 70 },
        { "label": "Length Optimization", "score": 77 }
      ],
      "suggestions": [
        { "type": "fix", "text": "Hook is weak — lead with a question or bold stat." },
        { "type": "tip", "text": "Add 5-10 hashtags mixing broad and niche." },
        { "type": "good", "text": "CTA is clear and actionable." }
      ]
    }
    // ... one per platform
  },

  "audienceRewrites": {
    "applicants": "🚀 Your idea could change...",
    "viewers": "New season. Who will you root for?...",
    "sponsors": "Stars of Science reaches 80M+...",
    "public": "Did you know there's a TV show..."
  },

  "nativeVersions": {
    "instagram": {
      "text": "The full rewritten caption...",
      "format": "Carousel or Reel",
      "charCount": 245,
      "hashtags": 8
    }
    // ... one per platform
  },

  "schedule": {
    "instagram": { "time": "8:00 PM", "day": "Tuesday or Thursday" },
    "linkedin":  { "time": "10:00 AM", "day": "Tuesday or Wednesday" },
    "x":         { "time": "1:00 PM", "day": "Monday or Wednesday" },
    "tiktok":    { "time": "7:00 PM", "day": "Thursday or Friday" },
    "youtube":   { "time": "5:00 PM", "day": "Saturday or Sunday" }
  }
}
```

---

## Field Notes

### benchmarks (Layer 1 — RapidAPI)
- `avgScore` is optional — if included, the frontend shows a "+X vs SoS avg" badge on each score card
- If you can't fetch benchmarks (API down, rate limited), return empty `{}` and the section hides itself

### ruleViolations (Layer 2 — Hard Rules)
- `type`: `"fail"` (red, must fix), `"warn"` (yellow, should fix), `"pass"` (green, looks good)
- `platform`: which platform this applies to, or `null` for cross-platform rules
- If no violations, return empty `[]` and the UI shows "All checks passed"

### scores (Layer 3 — Claude AI)
- `overall`: 0-100 composite score
- `breakdown`: exactly 6 items in this order: Hook Strength, Caption Quality, CTA Clarity, Hashtag Strategy, Format Fit, Length Optimization
- `suggestions`: array of `{type, text}` — AI-generated recommendations. `type` is `"fix"`, `"tip"`, or `"good"`

### audienceRewrites (Layer 3 — Claude AI)
- Only include keys that were in the request's `audiences` array
- These are full rewrites of the draft tailored to each audience segment

### nativeVersions (Layer 3 — Claude AI)
- Rewritten draft adapted for each platform's native format
- `format`: human-readable label like "Carousel or Reel", "Thread or single tweet"

### schedule
- Can be static MENA data or dynamically determined
- Frontend just displays whatever you send
