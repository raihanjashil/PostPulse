# PLAN.md — Feature Roadmap

## Hackathon Deadline: Saturday June 13, 2026 — 11:59 PM

---

## MVP (Must Have by Deadline)

### ✅ Done
- [x] data_layer.py — RapidAPI calls for Instagram, TikTok, Twitter, YouTube
- [x] scorer.py — Claude scoring with real benchmark data
- [x] main.py — FastAPI /score endpoint
- [x] App.jsx — React UI with score bars and rewrite

### 🔲 To Do (Priority Order)

#### P0 — Critical (do these first)
- [ ] Add .env support — move API keys out of code
- [ ] Test all 4 RapidAPI endpoints with real usernames
- [ ] Find real Stars of Science YouTube channel ID
- [ ] Find real Stars of Science TikTok secUid
- [ ] Verify /score endpoint returns correct JSON
- [ ] Connect React frontend to FastAPI — test full flow end to end

#### P1 — Important for demo wow factor
- [ ] Arabic post support — detect language and adjust scoring prompt
- [ ] Loading skeleton animation while scoring
- [ ] Copy rewritten post to clipboard button
- [ ] Overall best platform recommendation ("Best platform for this post: TikTok 88/100")
- [ ] Competitor comparison — "Your post vs top Arab science accounts"

#### P2 — Nice to have if time permits
- [ ] Simple caching — cache RapidAPI results for 1 hour
- [ ] Post history tab — save past scored posts in localStorage
- [ ] Export score report as PDF
- [ ] Platform selector with icons instead of dropdown

---

## Submission Checklist (Due Saturday 11:59 PM)

### 1. PRD (TeamName_Roadmap.pdf)
- [ ] Problem statement
- [ ] Solution overview
- [ ] Target users (Stars of Science marketing team)
- [ ] Technical architecture diagram
- [ ] Success metrics

### 2. Functional MVP (TeamName_DemoLink.txt)
- [ ] Deployed demo link (Vercel frontend + Render backend)
- [ ] Works live — not just localhost

### 3. Pitch Deck (TeamName_Deck.pdf)
- [ ] Slide 1: Problem
- [ ] Slide 2: Solution
- [ ] Slide 3: Demo walkthrough
- [ ] Slide 4: Technical architecture
- [ ] Slide 5: Impact and scalability (SaaS angle)
- [ ] Slide 6: Team

### 4. Pitch Video (less than 2 mins)
- [ ] Screen record the demo working
- [ ] Voice over explaining the value
- [ ] Show a bad post getting scored → rewritten → score jumps

---

## SaaS Scalability Angle (for pitch)
> "We built this for Stars of Science. The same engine works for any MENA media brand,
> government entity, or content team. White-label it, plug in their social accounts, done.
> Think of it as ContentIQ — a Grammarly for social media, built for the Arab world."

Target markets after Stars of Science:
1. Qatar Foundation, QF media teams
2. Government comms teams (MOC, MOTC)
3. MENA TV channels and production houses
4. Any brand managing 3+ social platforms in the region

---

## Time Budget (Remaining ~36hrs as of June 12)

| Task | Time |
|------|------|
| Fix keys + test APIs | 1 hr |
| Full end-to-end test | 1 hr |
| Arabic support | 2 hrs |
| Deploy frontend (Vercel) | 1 hr |
| Deploy backend (Render) | 1 hr |
| PRD document | 2 hrs |
| Pitch deck | 2 hrs |
| Pitch video | 1 hr |
| **Buffer / debugging** | 3 hrs |
| **Total** | ~14 hrs |
