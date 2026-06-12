/* ============================
   POSTPULSE — APP LOGIC
   
   Consumes: POST /score from FastAPI backend
   Backend runs: data_layer.py → scorer.py → main.py
   
   Response shape:
   {
     results: { platform: { overall_score, scores{hook,clarity,cta,format,tone}, 
                strengths, weaknesses, rule_flags, rewritten, 
                best_time_to_post, hashtag_suggestions } },
     benchmarks: { platform: { avg_likes, avg_comments, top_post_likes, post_count } }
   }
   ============================ */

// ---- CONFIG ----
const API_BASE = 'http://localhost:8000';

// ---- STATE ----
const state = {
  draft: '',
  platforms: ['instagram', 'tiktok', 'twitter', 'youtube', 'linkedin', 'facebook'],
  topic: 'science innovation',
  mediaType: 'text',
  results: null,   // { results, benchmarks }
  backendLive: false,
};

// ---- PLATFORM CONFIG ----
const PLATFORMS = {
  instagram: { name: 'Instagram',     color: '#E1306C', icon: '📸' },
  tiktok:    { name: 'TikTok',        color: '#010101', icon: '🎵' },
  twitter:   { name: 'X / Twitter',   color: '#1DA1F2', icon: '🐦' },
  youtube:   { name: 'YouTube',       color: '#FF0000', icon: '▶️' },
  linkedin:  { name: 'LinkedIn',      color: '#0077B5', icon: '💼' },
  facebook:  { name: 'Facebook',      color: '#1877F2', icon: '📘' },
};

// Score dimensions returned by backend (0-20 each)
const CRITERIA = [
  { key: 'hook',    label: 'Hook Strength' },
  { key: 'clarity', label: 'Copy Clarity' },
  { key: 'cta',     label: 'CTA Presence' },
  { key: 'format',  label: 'Format Fit' },
  { key: 'tone',    label: 'Tone Match' },
];

// ---- DOM REFS ----
const $ = id => document.getElementById(id);
const draftInput     = $('draft-input');
const charCount      = $('char-count');
const topicInput     = $('topic-input');
const mediaSelect    = $('media-select');
const btnAnalyze     = $('btn-analyze');
const btnClear       = $('btn-clear');
const loadingSection = $('loading-section');
const resultsSection = $('results-section');
const scoreGrid      = $('score-grid');
const detailPanel    = $('detail-panel');
const benchmarkGrid  = $('benchmark-grid');
const benchmarkSec   = $('benchmark-section');
const rulesList      = $('rules-list');
const scheduleGrid   = $('schedule-grid');
const apiDot         = $('api-dot');
const apiStatusText  = $('api-status');
const stepBenchmark  = $('step-benchmark');
const stepRules      = $('step-rules');
const stepAI         = $('step-ai');

// ---- INIT ----
function init() {
  draftInput.addEventListener('input', () => {
    state.draft = draftInput.value;
    charCount.textContent = state.draft.length;
  });

  topicInput.addEventListener('input', () => { state.topic = topicInput.value; });
  mediaSelect.addEventListener('change', () => { state.mediaType = mediaSelect.value; });

  btnAnalyze.addEventListener('click', onAnalyze);
  btnClear.addEventListener('click', () => {
    draftInput.value = '';
    state.draft = '';
    charCount.textContent = '0';
    resultsSection.classList.add('hidden');
    loadingSection.classList.add('hidden');
  });

  document.querySelectorAll('.chip[data-platform]').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const pid = chip.dataset.platform;
      if (chip.classList.contains('active')) {
        if (!state.platforms.includes(pid)) state.platforms.push(pid);
      } else {
        state.platforms = state.platforms.filter(p => p !== pid);
      }
    });
  });

  checkBackendHealth();
}

// ---- HEALTH CHECK ----
async function checkBackendHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      state.backendLive = true;
      apiDot.className = 'status-dot live';
      apiStatusText.textContent = 'API Live';
    } else { throw 0; }
  } catch {
    state.backendLive = false;
    apiDot.className = 'status-dot mock';
    apiStatusText.textContent = 'Mock Mode';
  }
}

// ---- PIPELINE ANIMATION ----
function resetPipeline() {
  [stepBenchmark, stepRules, stepAI].forEach(el => {
    el.classList.remove('active', 'done');
    el.classList.add('waiting');
    el.querySelector('.step-check').classList.add('hidden');
    el.querySelector('.step-spinner').style.display = '';
  });
}
function activateStep(el) { el.classList.remove('waiting'); el.classList.add('active'); }
function completeStep(el) { el.classList.remove('active'); el.classList.add('done'); }

// ---- MAIN ANALYZE FLOW ----
async function onAnalyze() {
  if (!state.draft.trim() || state.platforms.length === 0) return;

  resultsSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');
  btnAnalyze.disabled = true;
  resetPipeline();
  activateStep(stepBenchmark);

  try {
    let data;

    if (state.backendLive) {
      // ---- REAL BACKEND CALL ----
      // Backend picks platforms based on "all" or single
      // We always send "all" and filter on our end
      const res = await fetch(`${API_BASE}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: state.draft,
          platform: 'all',
          topic: state.topic,
          media_type: state.mediaType,
        }),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);

      completeStep(stepBenchmark);
      activateStep(stepRules);
      await delay(200);
      completeStep(stepRules);
      activateStep(stepAI);

      data = await res.json();
      completeStep(stepAI);
    } else {
      // ---- MOCK FALLBACK ----
      await delay(700);
      completeStep(stepBenchmark);
      activateStep(stepRules);
      await delay(500);
      completeStep(stepRules);
      activateStep(stepAI);
      await delay(900);
      completeStep(stepAI);

      data = generateMockData(state.draft, state.platforms);
    }

    // Filter to only selected platforms
    const results = {};
    const benchmarks = {};
    state.platforms.forEach(p => {
      if (data.results?.[p]) results[p] = data.results[p];
      if (data.benchmarks?.[p]) benchmarks[p] = data.benchmarks[p];
    });

    state.results = { results, benchmarks };

    await delay(300);
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    renderBenchmarks();
    renderRuleFlags();
    renderScoreCards();
    renderSchedule();

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('Analysis failed:', err);
    loadingSection.classList.add('hidden');

    // Fall back to mock
    state.backendLive = false;
    apiDot.className = 'status-dot mock';
    apiStatusText.textContent = 'Mock Mode (error)';

    const data = generateMockData(state.draft, state.platforms);
    state.results = data;

    resultsSection.classList.remove('hidden');
    renderBenchmarks();
    renderRuleFlags();
    renderScoreCards();
    renderSchedule();
  }

  btnAnalyze.disabled = false;
}

// =============================
// RENDERERS
// =============================

function renderBenchmarks() {
  const bm = state.results.benchmarks || {};
  benchmarkGrid.innerHTML = '';

  const entries = Object.entries(bm).filter(([p]) => state.platforms.includes(p) && bm[p]?.avg_likes > 0);
  if (entries.length === 0) {
    benchmarkSec.classList.add('hidden');
    return;
  }
  benchmarkSec.classList.remove('hidden');

  entries.forEach(([pid, d]) => {
    const p = PLATFORMS[pid];
    const card = document.createElement('div');
    card.className = 'benchmark-card';
    card.innerHTML = `
      <div class="benchmark-platform">${p?.name || pid}</div>
      <div class="benchmark-stat">${fmtNum(d.avg_likes)}</div>
      <div class="benchmark-label">avg likes/post</div>
      <div class="benchmark-detail">Top post: ${fmtNum(d.top_post_likes)} likes · ${d.post_count} posts</div>
    `;
    benchmarkGrid.appendChild(card);
  });
}

function renderRuleFlags() {
  rulesList.innerHTML = '';
  const res = state.results.results || {};

  // Collect all rule_flags across platforms
  const allFlags = [];
  Object.entries(res).forEach(([pid, data]) => {
    (data.rule_flags || []).forEach(msg => {
      allFlags.push({ platform: pid, message: msg });
    });
  });

  if (allFlags.length === 0) {
    rulesList.innerHTML = '<div class="rules-all-clear">✓ All pre-flight checks passed</div>';
    return;
  }

  allFlags.forEach(f => {
    const item = document.createElement('div');
    item.className = 'rule-item fail';
    item.innerHTML = `
      <span class="rule-icon">✕</span>
      <span class="rule-text">${f.message}</span>
      <span class="rule-platform-tag">${PLATFORMS[f.platform]?.name || f.platform}</span>
    `;
    rulesList.appendChild(item);
  });
}

function renderScoreCards() {
  scoreGrid.innerHTML = '';
  detailPanel.classList.add('hidden');
  const res = state.results.results || {};

  state.platforms.forEach(pid => {
    const data = res[pid];
    const p = PLATFORMS[pid];
    if (!p) return;

    const card = document.createElement('div');

    if (!data || data.error) {
      card.className = 'score-card error-card';
      card.innerHTML = `
        <div class="score-platform-name">${p.name}</div>
        <div class="score-number" style="color:var(--gray-400)">—</div>
        <div class="score-error-msg">${data?.error ? 'Error' : 'No data'}</div>
      `;
      scoreGrid.appendChild(card);
      return;
    }

    const score = data.overall_score || 0;
    const color = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--orange)' : 'var(--red)';

    card.className = 'score-card';
    card.innerHTML = `
      <div class="score-platform-name">${p.name}</div>
      <div class="score-number" style="color:${color}">${score}</div>
      <div class="score-label">out of 100</div>
    `;
    card.addEventListener('click', () => showDetail(pid));
    scoreGrid.appendChild(card);
  });
}

function showDetail(pid) {
  const p = PLATFORMS[pid];
  const data = state.results.results[pid];
  if (!data || data.error) return;

  // highlight active
  scoreGrid.querySelectorAll('.score-card').forEach(c => c.classList.remove('active'));
  // find the right card
  const cards = scoreGrid.querySelectorAll('.score-card:not(.error-card)');
  const activePlatforms = state.platforms.filter(pp => {
    const d = state.results.results[pp];
    return d && !d.error;
  });
  const idx = activePlatforms.indexOf(pid);
  if (idx >= 0 && cards[idx]) cards[idx].classList.add('active');

  $('detail-platform-name').textContent = p.name;
  $('detail-score-big').textContent = data.overall_score || 0;

  // ---- Breakdown bars (scores are 0-20, display as /20) ----
  const breakdownEl = $('detail-breakdown');
  breakdownEl.innerHTML = '<div class="section-label">Score Breakdown</div>';

  const scores = data.scores || {};
  CRITERIA.forEach(c => {
    const val = scores[c.key] || 0;
    const pct = (val / 20) * 100;
    const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';
    breakdownEl.innerHTML += `
      <div class="breakdown-row">
        <span class="breakdown-label">${c.label}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-bg">
            <div class="breakdown-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="breakdown-score" style="color:${color}">${val}/20</span>
        </div>
      </div>
    `;
  });

  // ---- Hashtags ----
  const hashEl = $('detail-hashtags');
  const tags = data.hashtag_suggestions || [];
  if (tags.length > 0) {
    hashEl.innerHTML = `
      <div class="hashtag-wrap">
        <div class="section-label">Suggested Hashtags</div>
        <div class="hashtag-pills">
          ${tags.map(t => `<span class="hashtag-pill">${t}</span>`).join('')}
        </div>
      </div>
    `;
  } else {
    hashEl.innerHTML = '';
  }

  // ---- Strengths + Weaknesses as suggestions ----
  const suggestEl = $('detail-suggestions');
  suggestEl.innerHTML = '<div class="section-label">AI Analysis</div>';

  (data.strengths || []).forEach(s => {
    suggestEl.innerHTML += `
      <div class="suggestion-item">
        <div class="suggestion-icon good">✓</div>
        <span class="suggestion-text">${s}</span>
      </div>
    `;
  });
  (data.weaknesses || []).forEach(w => {
    suggestEl.innerHTML += `
      <div class="suggestion-item">
        <div class="suggestion-icon tip">!</div>
        <span class="suggestion-text">${w}</span>
      </div>
    `;
  });

  // ---- Rewrite ----
  const rewritePanel = $('detail-rewrite');
  const rewriteText = $('rewrite-text');
  if (data.rewritten) {
    rewritePanel.classList.remove('hidden');
    rewriteText.textContent = data.rewritten;
    $('copy-rewrite-btn').onclick = () => {
      navigator.clipboard.writeText(data.rewritten).then(() => {
        const btn = $('copy-rewrite-btn');
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--green)'; btn.style.color = '#fff';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1500);
      });
    };
  } else {
    rewritePanel.classList.add('hidden');
  }

  detailPanel.classList.remove('hidden');
  detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderSchedule() {
  scheduleGrid.innerHTML = '';
  const res = state.results.results || {};

  state.platforms.forEach(pid => {
    const data = res[pid];
    const p = PLATFORMS[pid];
    if (!p || !data || data.error) return;

    const time = data.best_time_to_post || '—';
    const card = document.createElement('div');
    card.className = 'schedule-card';
    card.innerHTML = `
      <div class="schedule-platform">${p.name}</div>
      <div class="schedule-time">${time}</div>
      <div class="schedule-note">Gulf Standard Time</div>
    `;
    scheduleGrid.appendChild(card);
  });
}

// =============================
// HELPERS
// =============================

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtNum(n) { if (n == null) return '—'; return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }

// =============================
// MOCK DATA (offline fallback)
// =============================

function generateMockData(draft, platforms) {
  const len = draft.length;
  const hashCount = (draft.match(/#/g) || []).length;
  const hasEmoji = /[\u{1F600}-\u{1F9FF}]/u.test(draft);
  const hasCTA = /apply|click|visit|sign up|watch|follow|share|link|subscribe/i.test(draft);
  const wordCount = draft.split(/\s+/).length;

  const results = {};
  const benchmarks = {};

  platforms.forEach(pid => {
    // Mock benchmarks
    benchmarks[pid] = {
      avg_likes: rand(200, 800),
      avg_comments: rand(10, 60),
      top_post_likes: rand(900, 3500),
      top_post_caption: 'Applications for Season 16...',
      post_count: rand(5, 10),
    };

    // Mock rule flags
    const flags = [];
    if (pid === 'twitter' && len > 280) flags.push(`Over character limit (${len}/280 chars)`);
    if (pid === 'linkedin' && hashCount > 5) flags.push(`Too many hashtags for LinkedIn (${hashCount}) — max 3-5`);
    if (len < 20) flags.push('Post is too short — add more context');

    // Mock AI score
    const base = clamp(35 + (hasCTA ? 12 : 0) + (hasEmoji ? 5 : 0) + Math.min(wordCount * 0.8, 15) + (hashCount > 0 ? 8 : 0), 20, 95);
    const overall = clamp(base + rand(-10, 10), 15, 98);

    results[pid] = {
      overall_score: overall,
      scores: {
        hook:    clamp(rand(6, 18), 0, 20),
        clarity: clamp(rand(8, 18), 0, 20),
        cta:     hasCTA ? rand(12, 18) : rand(3, 8),
        format:  clamp(rand(8, 17), 0, 20),
        tone:    clamp(rand(10, 18), 0, 20),
      },
      strengths: hasCTA ? ['Has a clear call to action', 'Topic is relevant to audience'] : ['Topic is relevant'],
      weaknesses: !hasCTA
        ? ['Missing a clear call to action', 'Could use more specific language']
        : ['Hook could be stronger — lead with a question or bold stat'],
      rule_flags: flags,
      rewritten: `🚀 This is where the AI-rewritten version would appear.\n\nIn live mode, GPT-4o-mini rewrites your draft optimized for ${PLATFORMS[pid]?.name || pid}, with the right tone, length, and CTA.\n\n[Mock mode — connect the backend to see real rewrites]`,
      best_time_to_post: ['Tue 6pm GST', 'Wed 10am GST', 'Thu 7pm GST', 'Fri 8pm GST', 'Mon 1pm GST', 'Wed 3pm GST'][Object.keys(PLATFORMS).indexOf(pid)] || 'Wed 6pm GST',
      hashtag_suggestions: ['#StarsOfScience', '#Innovation', '#Qatar', '#MENA', '#ArabInventors'].slice(0, rand(3, 5)),
    };
  });

  return { results, benchmarks };
}

// ---- BOOT ----
init();
