/* ============================
   POSTPULSE — APP LOGIC
   
   NOTE: Scoring is mocked right now.
   Replace the analyze() function internals
   with real API calls to your Python backend
   when ready. The UI code doesn't care where
   the data comes from.
   ============================ */

// ---- STATE ----
const state = {
  draft: '',
  platforms: ['instagram', 'linkedin', 'x', 'tiktok', 'youtube'],
  audiences: ['applicants', 'viewers', 'sponsors', 'public'],
  results: null,
};

// ---- PLATFORM CONFIG ----
const PLATFORMS = {
  instagram: { name: 'Instagram', color: '#E84693', accent: '#E84693' },
  linkedin:  { name: 'LinkedIn',  color: '#0A66C2', accent: '#0A66C2' },
  x:         { name: '𝕏 (Twitter)', color: '#1A1A1A', accent: '#1A1A1A' },
  tiktok:    { name: 'TikTok',    color: '#FF0050', accent: '#FF0050' },
  youtube:   { name: 'YouTube',   color: '#FF0000', accent: '#FF0000' },
};

const AUDIENCES = {
  applicants: { name: 'Applicants',     emoji: '🎯', tag: 'Young Arab innovators' },
  viewers:    { name: 'Viewers',        emoji: '📺', tag: 'Entertainment seekers' },
  sponsors:   { name: 'Sponsors',       emoji: '💼', tag: 'Corporate partners' },
  public:     { name: 'General Public', emoji: '🌍', tag: 'MENA awareness' },
};

const CRITERIA = [
  'Hook Strength',
  'Caption Quality',
  'CTA Clarity',
  'Hashtag Strategy',
  'Format Fit',
  'Length Optimization',
];

// ---- DOM REFS ----
const draftInput    = document.getElementById('draft-input');
const charCount     = document.getElementById('char-count');
const btnAnalyze    = document.getElementById('btn-analyze');
const btnClear      = document.getElementById('btn-clear');
const loadingSection = document.getElementById('loading-section');
const resultsSection = document.getElementById('results-section');
const scoreGrid     = document.getElementById('score-grid');
const detailPanel   = document.getElementById('detail-panel');
const audienceGrid  = document.getElementById('audience-grid');
const nativeGrid    = document.getElementById('native-grid');
const scheduleGrid  = document.getElementById('schedule-grid');

// ---- INIT ----
function init() {
  draftInput.addEventListener('input', onInputChange);
  btnAnalyze.addEventListener('click', onAnalyze);
  btnClear.addEventListener('click', onClear);

  // chip toggles
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const p = chip.dataset.platform;
      if (state.platforms.includes(p)) {
        state.platforms = state.platforms.filter(x => x !== p);
      } else {
        state.platforms.push(p);
      }
    });
  });
  document.querySelectorAll('.chip-audience').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const a = chip.dataset.audience;
      if (state.audiences.includes(a)) {
        state.audiences = state.audiences.filter(x => x !== a);
      } else {
        state.audiences.push(a);
      }
    });
  });
}

function onInputChange() {
  state.draft = draftInput.value;
  charCount.textContent = state.draft.length;
}

function onClear() {
  draftInput.value = '';
  state.draft = '';
  charCount.textContent = '0';
  resultsSection.classList.add('hidden');
  detailPanel.classList.add('hidden');
}

// ---- ANALYZE ----
async function onAnalyze() {
  if (!state.draft.trim()) return;
  if (state.platforms.length === 0) return;

  // show loading
  resultsSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');
  btnAnalyze.disabled = true;

  try {
    // ============================================
    // TODO: Replace this mock with real API call:
    //
    //   const res = await fetch('/api/score', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       draft: state.draft,
    //       platforms: state.platforms,
    //       audiences: state.audiences
    //     })
    //   });
    //   state.results = await res.json();
    //
    // ============================================
    
    await delay(1800); // simulate network
    state.results = generateMockResults(state.draft, state.platforms, state.audiences);

    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    renderScoreCards();
    renderAudienceCards();
    renderNativeCards();
    renderSchedule();

    // scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('Analysis failed:', err);
    loadingSection.classList.add('hidden');
  }

  btnAnalyze.disabled = false;
}

// ---- RENDER: SCORE CARDS ----
function renderScoreCards() {
  scoreGrid.innerHTML = '';
  detailPanel.classList.add('hidden');

  state.platforms.forEach(pid => {
    const pdata = state.results.scores[pid];
    const pconf = PLATFORMS[pid];
    const card = document.createElement('div');
    card.className = 'score-card';
    card.style.setProperty('--card-accent', pconf.accent);

    const label = getScoreLabel(pdata.overall);

    card.innerHTML = `
      <div class="score-platform-name">${pconf.name}</div>
      <div class="score-number" style="color: ${pconf.accent}">${pdata.overall}</div>
      <span class="score-label ${label.cls}">${label.text}</span>
    `;

    card.addEventListener('click', () => showDetail(pid));
    scoreGrid.appendChild(card);
  });
}

function getScoreLabel(score) {
  if (score >= 80) return { text: 'Great', cls: 'great' };
  if (score >= 65) return { text: 'Good', cls: 'good' };
  if (score >= 45) return { text: 'Okay', cls: 'okay' };
  return { text: 'Needs Work', cls: 'weak' };
}

// ---- RENDER: DETAIL PANEL ----
function showDetail(pid) {
  const pdata = state.results.scores[pid];
  const pconf = PLATFORMS[pid];

  // highlight card
  document.querySelectorAll('.score-card').forEach((c, i) => {
    c.classList.toggle('selected', state.platforms[i] === pid);
  });

  document.getElementById('detail-platform-name').textContent = pconf.name;
  document.getElementById('detail-score-big').textContent = pdata.overall;

  // breakdown bars
  const breakdownEl = document.getElementById('detail-breakdown');
  breakdownEl.innerHTML = '<h4>Score Breakdown</h4>';
  pdata.breakdown.forEach(item => {
    const color = item.score >= 75 ? 'var(--green)' : item.score >= 50 ? 'var(--orange)' : 'var(--red)';
    breakdownEl.innerHTML += `
      <div class="breakdown-row">
        <span class="breakdown-label">${item.label}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar">
            <div class="breakdown-bar-fill" style="width: ${item.score}%; background: ${color}"></div>
          </div>
          <span class="breakdown-score">${item.score}</span>
        </div>
      </div>
    `;
  });

  // suggestions
  const suggestEl = document.getElementById('detail-suggestions');
  suggestEl.innerHTML = '<h4>Suggestions</h4>';
  pdata.suggestions.forEach(s => {
    const iconCls = s.type === 'fix' ? 'fix' : s.type === 'tip' ? 'tip' : 'good';
    const icon = s.type === 'fix' ? '✕' : s.type === 'tip' ? '!' : '✓';
    suggestEl.innerHTML += `
      <div class="suggestion-item">
        <div class="suggestion-icon ${iconCls}">${icon}</div>
        <span class="suggestion-text">${s.text}</span>
      </div>
    `;
  });

  detailPanel.classList.remove('hidden');
  detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- RENDER: AUDIENCE CARDS ----
function renderAudienceCards() {
  audienceGrid.innerHTML = '';

  state.audiences.forEach(aid => {
    const aconf = AUDIENCES[aid];
    const text = state.results.audienceRewrites[aid];
    if (!text) return;

    const card = document.createElement('div');
    card.className = 'audience-card';
    card.innerHTML = `
      <div class="audience-card-header">
        <span class="audience-card-title">${aconf.emoji} ${aconf.name}</span>
        <span class="audience-card-tag">${aconf.tag}</span>
      </div>
      <div class="audience-card-body">
        <div class="audience-card-text">${text}</div>
      </div>
      <div class="audience-card-footer">
        <button class="copy-btn" onclick="copyText(this, '${escapeForAttr(text)}')">Copy</button>
      </div>
    `;
    audienceGrid.appendChild(card);
  });
}

// ---- RENDER: NATIVE CARDS ----
function renderNativeCards() {
  nativeGrid.innerHTML = '';

  state.platforms.forEach(pid => {
    const pconf = PLATFORMS[pid];
    const data = state.results.nativeVersions[pid];
    if (!data) return;

    const card = document.createElement('div');
    card.className = 'native-card';
    card.innerHTML = `
      <div class="native-card-header">
        <span class="native-platform-badge" style="background: ${pconf.accent}">${pconf.name}</span>
        <span class="native-format-tag">${data.format}</span>
      </div>
      <div class="native-card-body">
        <div class="native-card-text">${data.text}</div>
      </div>
      <div class="native-card-footer">
        <span class="native-meta">${data.charCount} chars · ${data.hashtags} hashtags</span>
        <button class="copy-btn" onclick="copyText(this, '${escapeForAttr(data.text)}')">Copy</button>
      </div>
    `;
    nativeGrid.appendChild(card);
  });
}

// ---- RENDER: SCHEDULE ----
function renderSchedule() {
  scheduleGrid.innerHTML = '';

  state.platforms.forEach(pid => {
    const pconf = PLATFORMS[pid];
    const sched = state.results.schedule[pid];
    if (!sched) return;

    const card = document.createElement('div');
    card.className = 'schedule-card';
    card.innerHTML = `
      <div class="schedule-platform">${pconf.name}</div>
      <div class="schedule-time">${sched.time}</div>
      <div class="schedule-day">${sched.day}</div>
      <div class="schedule-timezone">AST (Arabia Standard Time)</div>
    `;
    scheduleGrid.appendChild(card);
  });
}

// ---- COPY HELPER ----
function copyText(btn, text) {
  const decoded = text.replace(/\\n/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  navigator.clipboard.writeText(decoded).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = 'var(--green)';
    btn.style.color = '#fff';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 1500);
  });
}

function escapeForAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n');
}

// ---- UTILS ----
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ================================================
// MOCK DATA GENERATOR
// Replace all of this with real backend calls.
// This exists purely so the UI works standalone.
// ================================================

function generateMockResults(draft, platforms, audiences) {
  const len = draft.length;
  const hasHashtags = (draft.match(/#/g) || []).length;
  const hasEmoji = /[\u{1F600}-\u{1F9FF}]/u.test(draft);
  const hasCTA = /apply|click|visit|sign up|watch|follow|share|link|subscribe/i.test(draft);
  const hasQuestion = draft.includes('?');
  const wordCount = draft.split(/\s+/).length;

  // base score influenced by real content signals
  const baseScore = Math.min(95, 40
    + (hasCTA ? 12 : 0)
    + (hasHashtags > 0 ? Math.min(hasHashtags * 4, 12) : 0)
    + (hasEmoji ? 5 : 0)
    + (hasQuestion ? 6 : 0)
    + Math.min(wordCount * 0.5, 15)
    + (len > 50 ? 8 : 0)
  );

  const scores = {};
  const platformBias = {
    instagram: { ideal: [80, 150], bonus: hasEmoji ? 8 : -5, format: 'Carousel or Reel' },
    linkedin:  { ideal: [100, 300], bonus: wordCount > 30 ? 8 : -3, format: 'Text post' },
    x:         { ideal: [30, 280], bonus: len <= 280 ? 10 : -15, format: 'Thread or single tweet' },
    tiktok:    { ideal: [20, 80], bonus: hasEmoji ? 6 : -4, format: 'Video caption' },
    youtube:   { ideal: [60, 200], bonus: hasCTA ? 8 : -3, format: 'Community post or description' },
  };

  platforms.forEach(pid => {
    const pb = platformBias[pid];
    const lengthFit = (len >= pb.ideal[0] && len <= pb.ideal[1]) ? 10 : -8;
    const overall = clamp(baseScore + pb.bonus + lengthFit + rand(-5, 5), 15, 98);

    const breakdown = CRITERIA.map(label => ({
      label,
      score: clamp(overall + rand(-18, 12), 10, 99),
    }));

    const suggestions = generateSuggestions(pid, draft, overall, hasCTA, hasHashtags, len, pb);

    scores[pid] = { overall, breakdown, suggestions };
  });

  // audience rewrites (mocked — replace with LLM calls)
  const audienceRewrites = {};
  if (audiences.includes('applicants')) {
    audienceRewrites.applicants = `🚀 Your idea could change the Arab world — literally.\n\nStars of Science is looking for the next generation of innovators. If you've got a prototype, a dream, or even just a napkin sketch — this is your shot.\n\nMentorship. Funding. A global stage.\n\n👉 Apply now before the deadline hits.\n#StarsOfScience #Innovation #ApplyNow`;
  }
  if (audiences.includes('viewers')) {
    audienceRewrites.viewers = `New season. New inventors. Who will you root for? 👀\n\nStars of Science is back — and this season's lineup is going to surprise you. Real people, real inventions, real drama.\n\nTune in and pick your champion.\n\n📺 Streaming now on your favorite platform.\n#StarsOfScience #MustWatch`;
  }
  if (audiences.includes('sponsors')) {
    audienceRewrites.sponsors = `Stars of Science reaches 80M+ viewers across the MENA region.\n\nSeason after season, we connect forward-thinking brands with the innovation narrative of the Arab world. Our audience: educated, 18–35, tech-curious, and high-intent.\n\nLet's talk about how your brand fits into the story.\n\n📩 partnerships@starsofscience.com`;
  }
  if (audiences.includes('public')) {
    audienceRewrites.public = `Did you know there's a TV show where Arab inventors compete to build the future? 🤯\n\nStars of Science takes everyday people with extraordinary ideas and gives them the tools to make it real. Think Shark Tank meets MIT.\n\nYou need to see this.\n#StarsOfScience #ArabInnovation`;
  }

  // native versions (mocked)
  const nativeVersions = {};
  platforms.forEach(pid => {
    const p = PLATFORMS[pid];
    const pb = platformBias[pid];
    let text, charCnt, tags;

    switch (pid) {
      case 'instagram':
        text = `${audienceRewrites[audiences[0]] || draft}\n\n.\n.\n.\n#StarsOfScience #Innovation #MENA #QatarFoundation #Entrepreneurs #Season17`;
        charCnt = text.length;
        tags = 6;
        break;
      case 'linkedin':
        text = `Stars of Science isn't just a TV show — it's a launchpad.\n\nEvery season, we take Arab innovators from idea to prototype to business. The results speak for themselves: 80M+ viewers, dozens of funded ventures, and a pipeline of talent that keeps growing.\n\nApplications for the new season are open. If you know someone with a bold idea, tag them below.\n\n#Innovation #MENA #Startups #StarsOfScience`;
        charCnt = text.length;
        tags = 4;
        break;
      case 'x':
        text = `Stars of Science applications are OPEN 🚀\n\nIf you've got an idea that could change lives in the Arab world — this is your moment.\n\nMentorship ✓\nFunding ✓\nGlobal stage ✓\n\nApply → starsofscience.com`;
        charCnt = text.length;
        tags = 0;
        break;
      case 'tiktok':
        text = `POV: you just got accepted to Stars of Science 😳🔬\n\n#StarsOfScience #Innovation #ArabInventors #FYP #Science`;
        charCnt = text.length;
        tags = 5;
        break;
      case 'youtube':
        text = `🔬 Stars of Science — Applications Open for Season 17\n\nAre you an Arab innovator with a game-changing idea? Stars of Science, Qatar Foundation's flagship innovation program, is looking for you.\n\nIn this video, we break down:\n• How to apply\n• What judges look for\n• Tips from past winners\n\nApply now: starsofscience.com\n\n#StarsOfScience #Innovation #QatarFoundation`;
        charCnt = text.length;
        tags = 3;
        break;
    }

    nativeVersions[pid] = {
      text,
      format: pb.format,
      charCount: charCnt,
      hashtags: tags,
    };
  });

  // schedule (MENA optimal times)
  const schedule = {
    instagram: { time: '8:00 PM', day: 'Tuesday or Thursday' },
    linkedin:  { time: '10:00 AM', day: 'Tuesday or Wednesday' },
    x:         { time: '1:00 PM', day: 'Monday or Wednesday' },
    tiktok:    { time: '7:00 PM', day: 'Thursday or Friday' },
    youtube:   { time: '5:00 PM', day: 'Saturday or Sunday' },
  };

  return { scores, audienceRewrites, nativeVersions, schedule };
}

function generateSuggestions(pid, draft, score, hasCTA, hasHashtags, len, pb) {
  const suggestions = [];

  if (!hasCTA) {
    suggestions.push({ type: 'fix', text: `Missing a clear call to action. Add a specific CTA like "Apply now", "Watch here", or "Link in bio".` });
  } else {
    suggestions.push({ type: 'good', text: `Good — you have a clear call to action.` });
  }

  if (hasHashtags < 2 && (pid === 'instagram' || pid === 'tiktok')) {
    suggestions.push({ type: 'fix', text: `Add 5–10 relevant hashtags. Mix broad (#Innovation) with niche (#ArabInventors).` });
  }

  if (len > pb.ideal[1]) {
    suggestions.push({ type: 'tip', text: `Your caption is ${len} chars — ${PLATFORMS[pid].name} posts perform best under ${pb.ideal[1]}. Trim the fat.` });
  } else if (len < pb.ideal[0]) {
    suggestions.push({ type: 'tip', text: `At ${len} chars, this is thin for ${PLATFORMS[pid].name}. Aim for ${pb.ideal[0]}+ to give the algorithm more signal.` });
  } else {
    suggestions.push({ type: 'good', text: `Length is in the sweet spot for ${PLATFORMS[pid].name}.` });
  }

  if (pid === 'instagram' && !/[\u{1F600}-\u{1F9FF}]/u.test(draft)) {
    suggestions.push({ type: 'tip', text: `Instagram captions with emojis get ~15% more engagement. Add 2–3 relevant ones.` });
  }

  if (pid === 'x' && len > 280) {
    suggestions.push({ type: 'fix', text: `Over the 280-char limit. Either trim to one tweet or restructure as a thread.` });
  }

  if (pid === 'linkedin' && !draft.includes('\n')) {
    suggestions.push({ type: 'tip', text: `Break this into short paragraphs. LinkedIn's algorithm favors posts that keep people scrolling.` });
  }

  if (pid === 'tiktok') {
    suggestions.push({ type: 'tip', text: `Keep the caption punchy — the video does the heavy lifting. Front-load the hook.` });
  }

  if (score < 50) {
    suggestions.push({ type: 'fix', text: `This post needs significant rework for ${PLATFORMS[pid].name}. Consider rewriting with the platform's format in mind.` });
  }

  return suggestions;
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

// ---- BOOT ----
init();
