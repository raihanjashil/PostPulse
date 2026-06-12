/* ============================
   POSTPULSE — APP LOGIC

   Consumes: POST /score from FastAPI backend
   Backend runs: data_layer.py → scorer.py → main.py

   Response shape:
   {
     results: { platform: { overall_score, scores{hook,clarity,cta,format,tone},
                strengths, weaknesses, rule_flags, rewritten,
                best_time_to_post, hashtag_suggestions,
                algorithm_decoder: { verdict, signals: [{name, status, note}] },
                audience_variants: [{ region, audience, rewritten, rationale }] } },
     benchmarks: { platform: { avg_likes, avg_comments, comment_rate, engagement_quality,
                top_post_likes, post_count } },
     connected: { platform: { username, blocked } },
     recommendation: { goal, recommended_platform, recommended_score, best_time_to_post,
                ranked_platforms, rationale }
   }
   ============================ */

// ---- CONFIG ----
const API_BASE = 'http://localhost:8000';

// ---- SESSION ----
function getOrCreateSessionId() {
  let sid = localStorage.getItem('postpulse_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('postpulse_session_id', sid);
  }
  return sid;
}
const SESSION_ID = getOrCreateSessionId();

function apiFetch(path, options = {}) {
  options.headers = options.headers || {};
  options.headers['X-Session-Id'] = SESSION_ID;
  return fetch(`${API_BASE}${path}`, options);
}

// ---- STATE ----
const state = {
  draft: '',
  platforms: ['twitter', 'linkedin', 'facebook'],
  topic: 'science innovation',
  goal: 'reach',
  results: null,   // { results, benchmarks, recommendation }
  backendLive: false,
  connectedAccounts: {},   // { platform: { username, blocked } }
  platformConfig: {},      // { platform: { configured: bool } }
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
const goalSelect     = $('goal-select');
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
const recommendationSection = $('recommendation-section');
const recommendationCard    = $('recommendation-card');
const detailAlgorithm = $('detail-algorithm');
const algoVerdict     = $('algo-verdict');
const algoSignals     = $('algo-signals');
const detailAudience  = $('detail-audience');
const audienceTabs    = $('audience-tabs');
const audienceBody    = $('audience-body');
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
  goalSelect.addEventListener('change', () => { state.goal = goalSelect.value; });

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

  renderAccountsBanner();
  checkBackendHealth();
  initTabs();
  initVideoUpload();

  $('btn-load-insights')?.addEventListener('click', onLoadInsights);

  // Gear button toggles the Connected Accounts panel
  const btnSettings = $('btn-settings');
  const accountsSection = $('accounts-section');
  if (btnSettings && accountsSection) {
    btnSettings.addEventListener('click', () => {
      accountsSection.classList.toggle('hidden');
      if (!accountsSection.classList.contains('hidden')) renderAccountsBanner();
    });
  }
}

// ---- HEALTH CHECK ----
async function checkBackendHealth() {
  try {
    const res = await apiFetch('/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      state.backendLive = true;
      apiDot.className = 'status-dot live';
      apiStatusText.textContent = 'API Live';
      await loadAuthStatus();
      await loadConfigStatus();
    } else { throw 0; }
  } catch {
    state.backendLive = false;
    apiDot.className = 'status-dot mock';
    apiStatusText.textContent = 'Mock Mode';
  }
}

async function loadAuthStatus() {
  try {
    const res = await apiFetch('/auth/status');
    if (res.ok) {
      const data = await res.json();
      state.connectedAccounts = data.connected || {};
      renderAccountsBanner();
    }
  } catch { /* non-fatal */ }
}

async function loadConfigStatus() {
  try {
    const res = await apiFetch('/config');
    if (res.ok) {
      state.platformConfig = await res.json();
      renderAccountsBanner();  // re-render to show "Setup required" badges
    }
  } catch { /* non-fatal */ }
}

// ---- OAUTH POPUP FLOW ----
function startOAuthFlow(platform) {
  const width = 520, height = 660;
  const left  = Math.round(window.screenX + (window.outerWidth  - width)  / 2);
  const top   = Math.round(window.screenY + (window.outerHeight - height) / 2);
  const url   = `${API_BASE}/auth/${platform}/start?session_id=${SESSION_ID}`;

  const popup = window.open(
    url,
    `oauth_${platform}`,
    `width=${width},height=${height},left=${left},top=${top},toolbar=0,menubar=0,scrollbars=1`
  );

  function onMessage(e) {
    if (e.origin !== 'http://localhost:8000') return;
    const msg = e.data;
    if (!msg || !msg.type || msg.platform !== platform) return;
    window.removeEventListener('message', onMessage);

    if (msg.type === 'oauth_success') {
      state.connectedAccounts[platform] = { username: msg.username, blocked: false };
      renderAccountsBanner();
      renderScoreCards();  // refresh publish buttons if results exist
      showToast(`Connected to ${PLATFORMS[platform].name} as @${msg.username}`);
    } else if (msg.type === 'oauth_blocked') {
      state.connectedAccounts[platform] = { username: '', blocked: true };
      renderAccountsBanner();
      showToast(`${PLATFORMS[platform].name}: ${msg.reason}`, 'warn');
    } else if (msg.type === 'oauth_error') {
      showToast(`Failed to connect ${PLATFORMS[platform].name}`, 'error');
    }
  }
  window.addEventListener('message', onMessage);
}

async function disconnectPlatform(platform) {
  delete state.connectedAccounts[platform];
  renderAccountsBanner();
  renderScoreCards();
  try {
    await apiFetch(`/auth/${platform}`, { method: 'DELETE' });
  } catch { /* non-fatal */ }
}

// ---- ACCOUNTS BANNER ----
// Instagram/TikTok/YouTube/Facebook connections aren't available yet — always "Coming soon".
const COMING_SOON_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook'];
// Twitter/LinkedIn require operator-supplied OAuth Client ID/Secret before connecting.
const CONFIGURABLE_PLATFORMS = ['twitter', 'linkedin'];

let openCredentialForm = null; // platform id whose Client ID/Secret form is currently expanded

function renderAccountsBanner() {
  const grid = $('accounts-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const ALL = [...COMING_SOON_PLATFORMS, ...CONFIGURABLE_PLATFORMS];
  ALL.forEach(pid => {
    const p = PLATFORMS[pid];
    const card = document.createElement('div');

    if (COMING_SOON_PLATFORMS.includes(pid)) {
      card.className = 'account-card coming-soon';
      card.innerHTML = `
        <div class="account-platform-icon">${p.icon}</div>
        <div class="account-platform-name">${p.name}</div>
        <button class="btn-connect-blocked" disabled>Coming soon</button>
      `;
      grid.appendChild(card);
      return;
    }

    // CONFIGURABLE_PLATFORMS (twitter, linkedin)
    const conn = state.connectedAccounts[pid];
    const isConnected = conn && !conn.blocked;
    const isConfigured = state.platformConfig[pid]?.configured === true;
    const formOpen = openCredentialForm === pid;

    card.className = `account-card${isConnected ? ' connected' : ''}`;
    card.innerHTML = `
      <div class="account-platform-icon">${p.icon}</div>
      <div class="account-platform-name">${p.name}</div>
      ${isConnected
        ? `<div class="account-username">@${conn.username}</div>
           <button class="btn-disconnect" data-platform="${pid}">Disconnect</button>`
        : `<button class="btn-connect" data-platform="${pid}">Connect</button>
           <button class="btn-edit-credentials" data-platform="${pid}">${isConfigured ? '✎ Edit credentials' : '⚙ Set up credentials'}</button>`
      }
      ${formOpen ? `
        <div class="account-credential-form">
          <span class="settings-badge ${isConfigured ? 'configured' : 'not-set'}">
            ${isConfigured ? '● Configured' : '● Not set'}
          </span>
          <input class="settings-input" type="text" id="cfg-cid-${pid}" placeholder="Client ID" autocomplete="off" spellcheck="false" />
          <input class="settings-input" type="password" id="cfg-secret-${pid}" placeholder="Client Secret" autocomplete="off" />
          <button class="btn-settings-save" data-platform="${pid}">Save &amp; Connect</button>
          ${isConfigured ? `<button class="btn-settings-clear" data-platform="${pid}">Clear</button>` : ''}
        </div>
      ` : ''}
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.btn-connect').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.platform;
      if (state.platformConfig[pid]?.configured === true) {
        startOAuthFlow(pid);
      } else {
        openCredentialForm = openCredentialForm === pid ? null : pid;
        renderAccountsBanner();
      }
    });
  });
  grid.querySelectorAll('.btn-disconnect').forEach(btn => {
    btn.addEventListener('click', () => disconnectPlatform(btn.dataset.platform));
  });
  grid.querySelectorAll('.btn-edit-credentials').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.platform;
      openCredentialForm = openCredentialForm === pid ? null : pid;
      renderAccountsBanner();
    });
  });
  grid.querySelectorAll('.btn-settings-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid      = btn.dataset.platform;
      const clientId = $(`cfg-cid-${pid}`)?.value.trim();
      const secret   = $(`cfg-secret-${pid}`)?.value.trim();
      if (!clientId || !secret) {
        showToast('Both Client ID and Client Secret are required', 'warn');
        return;
      }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const res = await apiFetch('/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: pid, client_id: clientId, client_secret: secret }),
        });
        if (res.ok) {
          state.platformConfig[pid] = { configured: true };
          showToast(`${PLATFORMS[pid].name} credentials saved`);
          openCredentialForm = null;
          renderAccountsBanner();
          startOAuthFlow(pid);
        } else {
          showToast('Save failed', 'error');
          btn.disabled = false; btn.textContent = 'Save & Connect';
        }
      } catch {
        showToast('Network error', 'error');
        btn.disabled = false; btn.textContent = 'Save & Connect';
      }
    });
  });
  grid.querySelectorAll('.btn-settings-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.platform;
      btn.disabled = true; btn.textContent = 'Clearing…';
      try {
        await apiFetch(`/config/${pid}`, { method: 'DELETE' });
        state.platformConfig[pid] = { configured: false };
        showToast(`${PLATFORMS[pid].name} credentials cleared`);
        renderAccountsBanner();
      } catch { showToast('Network error', 'error'); }
    });
  });
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
      const res = await apiFetch('/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: state.draft,
          platform: 'all',
          topic: state.topic,
          goal: state.goal,
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

      // Merge connected account info returned by the score endpoint
      if (data.connected) {
        state.connectedAccounts = { ...state.connectedAccounts, ...data.connected };
        renderAccountsBanner();
      }
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

    state.results = { results, benchmarks, recommendation: data.recommendation || null };

    await delay(300);
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    renderRecommendation();
    renderBenchmarks();
    renderRuleFlags();
    renderScoreCards();
    renderSchedule();

    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('Analysis failed:', err);
    loadingSection.classList.add('hidden');

    state.backendLive = false;
    apiDot.className = 'status-dot mock';
    apiStatusText.textContent = 'Mock Mode (error)';

    const data = generateMockData(state.draft, state.platforms);
    state.results = data;

    resultsSection.classList.remove('hidden');
    renderRecommendation();
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

const GOAL_LABELS = {
  reach: '📈 Reach',
  engagement: '💬 Engagement',
  conversions: '🎯 Conversions',
};

function renderRecommendation() {
  const rec = state.results?.recommendation;
  if (!rec || !rec.recommended_platform) {
    recommendationSection.classList.add('hidden');
    return;
  }

  const p = PLATFORMS[rec.recommended_platform];
  const rankedChips = (rec.ranked_platforms || []).map((pid, i) => {
    const rp = PLATFORMS[pid];
    const isTop = pid === rec.recommended_platform;
    return `<span class="recommendation-chip${isTop ? ' top' : ''}">${i + 1}. ${rp?.icon || ''} ${rp?.name || pid}</span>`;
  }).join('');

  recommendationCard.innerHTML = `
    <div class="recommendation-goal">${GOAL_LABELS[rec.goal] || rec.goal}</div>
    <div class="recommendation-main">
      <span class="recommendation-platform">${p?.icon || ''} ${p?.name || rec.recommended_platform}</span>
      <span class="recommendation-score">${rec.recommended_score}/100</span>
    </div>
    <div class="recommendation-meta">Best time to post: ${rec.best_time_to_post || '—'}</div>
    <div class="recommendation-rationale">${rec.rationale || ''}</div>
    <div class="recommendation-ranked">${rankedChips}</div>
  `;
  recommendationSection.classList.remove('hidden');
}

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
    const quality = d.engagement_quality || 'low';
    const card = document.createElement('div');
    card.className = 'benchmark-card';
    card.innerHTML = `
      <div class="benchmark-platform">${p?.name || pid}</div>
      <div class="benchmark-stat">${fmtNum(d.avg_likes)}</div>
      <div class="benchmark-label">avg likes/post</div>
      <div class="benchmark-detail">Top post: ${fmtNum(d.top_post_likes)} likes · ${d.post_count} posts</div>
      <div class="benchmark-extra">${d.comment_rate ?? 0} comments per 100 likes</div>
      <span class="engagement-badge ${quality}">${quality} engagement</span>
    `;
    benchmarkGrid.appendChild(card);
  });
}

function renderRuleFlags() {
  rulesList.innerHTML = '';
  const res = state.results.results || {};

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
  const res = state.results?.results || {};

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
    const conn  = state.connectedAccounts[pid];
    const isConnected = conn && !conn.blocked;
    const isBlocked   = conn && conn.blocked;

    const publishBtnHtml = isConnected
      ? `<button class="btn-publish" data-platform="${pid}">Publish</button>`
      : isBlocked
        ? `<button class="btn-publish-soon" disabled>Publish — Coming soon</button>`
        : '';

    card.className = 'score-card';
    card.innerHTML = `
      <div class="score-platform-name">${p.name}</div>
      <div class="score-number" style="color:${color}">${score}</div>
      <div class="score-label">out of 100</div>
      ${publishBtnHtml}
    `;

    card.addEventListener('click', () => showDetail(pid));

    const pbtn = card.querySelector('.btn-publish');
    if (pbtn) {
      pbtn.addEventListener('click', e => {
        e.stopPropagation();
        onPublish(pid);
      });
    }

    scoreGrid.appendChild(card);
  });
}

function showDetail(pid) {
  const p = PLATFORMS[pid];
  const data = state.results.results[pid];
  if (!data || data.error) return;

  // highlight active card
  scoreGrid.querySelectorAll('.score-card').forEach(c => c.classList.remove('active'));
  const cards = scoreGrid.querySelectorAll('.score-card:not(.error-card)');
  const activePlatforms = state.platforms.filter(pp => {
    const d = state.results.results[pp];
    return d && !d.error;
  });
  const idx = activePlatforms.indexOf(pid);
  if (idx >= 0 && cards[idx]) cards[idx].classList.add('active');

  $('detail-platform-name').textContent = p.name;
  $('detail-score-big').textContent = data.overall_score || 0;

  // ---- Breakdown bars ----
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

  // ---- Strengths + Weaknesses ----
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

  // ---- Publish row ----
  const publishRow = $('detail-publish-row');
  if (publishRow) {
    const conn = state.connectedAccounts[pid];
    const isConnected = conn && !conn.blocked;
    const isBlocked   = conn && conn.blocked;

    if (isConnected) {
      publishRow.innerHTML = `
        <div class="detail-publish-row">
          <button class="btn-publish-detail" id="btn-publish-detail-${pid}">
            Publish to ${p.name}
          </button>
          <span class="publish-note">Posts your original draft (or AI rewrite)</span>
        </div>
      `;
      const dpBtn = $(`btn-publish-detail-${pid}`);
      if (dpBtn) dpBtn.addEventListener('click', () => onPublish(pid));
    } else if (isBlocked) {
      publishRow.innerHTML = `<div class="blocked-publish-note">Publishing to ${p.name} — coming soon (requires app approval)</div>`;
    } else {
      publishRow.innerHTML = '';
    }
  }

  // ---- Rewrite ----
  const rewritePanel = $('detail-rewrite');
  const rewriteText  = $('rewrite-text');
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

  // ---- Algorithm Decoder ----
  const decoder = data.algorithm_decoder;
  if (decoder && decoder.verdict) {
    algoVerdict.textContent = decoder.verdict;
    algoSignals.innerHTML = (decoder.signals || []).map(sig => `
      <div class="algo-signal-row">
        <span class="status-dot ${sig.status}"></span>
        <span class="algo-signal-name">${sig.name}</span>
        <span class="algo-signal-note">${sig.note}</span>
      </div>
    `).join('');
    detailAlgorithm.classList.remove('hidden');
  } else {
    detailAlgorithm.classList.add('hidden');
  }

  // ---- Audience & Geo Targeting ----
  const variants = data.audience_variants || [];
  if (variants.length > 0) {
    renderAudienceTabs(variants, 0);
    detailAudience.classList.remove('hidden');
  } else {
    detailAudience.classList.add('hidden');
  }

  detailPanel.classList.remove('hidden');
  detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderAudienceTabs(variants, activeIdx) {
  audienceTabs.innerHTML = variants.map((v, i) => `
    <button class="audience-tab${i === activeIdx ? ' active' : ''}" data-idx="${i}">${v.region} · ${v.audience}</button>
  `).join('');

  audienceTabs.querySelectorAll('.audience-tab').forEach(btn => {
    btn.addEventListener('click', () => renderAudienceTabs(variants, Number(btn.dataset.idx)));
  });

  const v = variants[activeIdx];
  audienceBody.innerHTML = `
    <div class="audience-rewrite-wrap">
      <button class="copy-btn audience-copy-btn">Copy</button>
      <div class="audience-rewrite">${v.rewritten}</div>
    </div>
    <div class="audience-rationale">${v.rationale}</div>
  `;
  audienceBody.querySelector('.audience-copy-btn').addEventListener('click', e => {
    navigator.clipboard.writeText(v.rewritten).then(() => {
      const btn = e.target;
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green)'; btn.style.color = '#fff';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1500);
    });
  });
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

// ---- ONE-CLICK PUBLISH ----
async function onPublish(platform) {
  const data = state.results?.results?.[platform];
  if (!data) return;

  const useRewrite = data.rewritten
    && confirm(`Publish the AI-rewritten version to ${PLATFORMS[platform].name}?\n\nOK = AI rewrite\nCancel = your original draft`);
  const textToPost = useRewrite ? data.rewritten : state.draft;

  // Disable all publish buttons for this platform while posting
  const btns = [
    scoreGrid.querySelector(`.btn-publish[data-platform="${platform}"]`),
    $(`btn-publish-detail-${platform}`),
  ].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.textContent = 'Publishing…'; });

  try {
    const res = await apiFetch('/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, text: textToPost }),
    });

    if (res.ok) {
      const result = await res.json();
      showToast(`Posted to ${PLATFORMS[platform].name}!${result.url ? ' View →' : ''}`);
      btns.forEach(b => {
        b.textContent = 'Published ✓';
        b.style.background = 'var(--green)';
      });
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`Publish failed: ${err.detail || 'Unknown error'}`, 'error');
      btns.forEach(b => { b.disabled = false; b.textContent = 'Publish'; b.style.background = ''; });
    }
  } catch {
    showToast('Network error — publish failed', 'error');
    btns.forEach(b => { b.disabled = false; b.textContent = 'Publish'; b.style.background = ''; });
  }
}

// =============================
// HELPERS
// =============================

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtNum(n) { if (n == null) return '—'; return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }

function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

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
    const avgLikes = rand(200, 800);
    const avgComments = rand(10, 60);
    const commentRate = avgLikes > 0 ? Math.round((avgComments / avgLikes) * 10000) / 100 : 0;
    const engagementQuality = commentRate >= 5 ? 'high' : commentRate >= 1 ? 'medium' : 'low';

    benchmarks[pid] = {
      avg_likes: avgLikes,
      avg_comments: avgComments,
      comment_rate: commentRate,
      engagement_quality: engagementQuality,
      top_post_likes: rand(900, 3500),
      top_post_caption: 'Applications for Season 16...',
      post_count: rand(5, 10),
    };

    const flags = [];
    if (pid === 'twitter' && len > 280) flags.push(`Over character limit (${len}/280 chars)`);
    if (pid === 'linkedin' && hashCount > 5) flags.push(`Too many hashtags for LinkedIn (${hashCount}) — max 3-5`);
    if (len < 20) flags.push('Post is too short — add more context');

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
      algorithm_decoder: {
        verdict: `${PLATFORMS[pid]?.name || pid}'s algorithm will give this post moderate distribution — the hook and CTA are doing some of the work, but engagement signals could be stronger.`,
        signals: [
          { name: 'Hook / Scroll-stop', status: hasEmoji ? 'strong' : 'average', note: hasEmoji ? 'Emoji-led opener helps it stand out in feed.' : 'Opening line could be punchier to stop the scroll.' },
          { name: 'Replies & Shares', status: hasCTA ? 'average' : 'weak', note: hasCTA ? 'CTA may drive some replies, but not designed to spark discussion.' : 'No prompt encouraging replies or shares.' },
          { name: 'Watch-through / Dwell time', status: 'average', note: '[Mock mode — connect the backend for real per-platform signals]' },
        ],
      },
      audience_variants: [
        { region: '🇶🇦🇦🇪 Qatar & UAE', audience: 'Gulf Youth (18-24)', rewritten: `🌟 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for Gulf youth.`, rationale: 'Youthful tone and emojis resonate with this audience.' },
        { region: '🇸🇦 Saudi Arabia', audience: 'STEM Students & Young Professionals', rewritten: `🔬 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for Saudi STEM audience.`, rationale: 'Frames the post around STEM relevance and career growth.' },
        { region: '🇪🇬 Egypt & Levant', audience: 'Parents & Educators', rewritten: `📚 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for parents & educators.`, rationale: 'Speaks to families and the educational value of the program.' },
      ],
    };
  });

  // Pick the platform with the highest score as the mock recommendation
  let topPid = platforms[0];
  platforms.forEach(pid => {
    if ((results[pid]?.overall_score || 0) > (results[topPid]?.overall_score || 0)) topPid = pid;
  });
  const ranked = [...platforms].sort((a, b) => (results[b]?.overall_score || 0) - (results[a]?.overall_score || 0));

  const recommendation = {
    goal: state.goal,
    recommended_platform: topPid,
    recommended_score: results[topPid]?.overall_score || 0,
    best_time_to_post: results[topPid]?.best_time_to_post,
    ranked_platforms: ranked,
    rationale: `[Mock mode] For maximizing ${state.goal}, ${PLATFORMS[topPid]?.name || topPid} scored highest on this draft.`,
  };

  return { results, benchmarks, recommendation };
}

// =============================
// TAB SWITCHING
// =============================

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });
}

// =============================
// ACCOUNT INTELLIGENCE
// =============================

async function onLoadInsights() {
  const btn        = $('btn-load-insights');
  const loadingEl  = $('insights-loading');
  const gridEl     = $('insights-grid');
  const overallEl  = $('insights-overall');
  const stepFetch  = $('step-insights-fetch');
  const stepAI     = $('step-insights-ai');

  btn.disabled = true;
  btn.textContent = 'Loading…';
  loadingEl.classList.remove('hidden');
  gridEl.innerHTML = '';
  overallEl.classList.add('hidden');

  // reset loading steps
  [stepFetch, stepAI].forEach(el => {
    if (!el) return;
    el.classList.remove('active', 'done');
    el.classList.add('waiting');
    el.querySelector('.step-check')?.classList.add('hidden');
    const s = el.querySelector('.step-spinner');
    if (s) s.style.display = '';
  });

  try {
    let data;
    if (state.backendLive) {
      activateStep(stepFetch);
      const identifierFields = {
        instagram: 'insights-instagram',
        tiktok: 'insights-tiktok',
        twitter: 'insights-twitter',
        youtube: 'insights-youtube',
        facebook: 'insights-facebook',
      };
      const params = new URLSearchParams();
      Object.entries(identifierFields).forEach(([platform, inputId]) => {
        const val = $(inputId)?.value.trim();
        if (val) params.set(platform, val);
      });
      const qs = params.toString();
      const res = await apiFetch(`/insights${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      completeStep(stepFetch);
      activateStep(stepAI);
      data = await res.json();
      completeStep(stepAI);
    } else {
      await delay(800);
      activateStep(stepFetch);
      await delay(600);
      completeStep(stepFetch);
      activateStep(stepAI);
      await delay(800);
      completeStep(stepAI);
      data = generateMockInsights();
    }

    loadingEl.classList.add('hidden');
    renderInsights(data);
    showToast('Account Intelligence loaded');
  } catch {
    loadingEl.classList.add('hidden');
    renderInsights(generateMockInsights());
    showToast('Using mock insights data', 'warn');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">🔄</span> Refresh Intelligence';
}

function renderInsights(data) {
  const gridEl    = $('insights-grid');
  const overallEl = $('insights-overall');
  gridEl.innerHTML = '';

  if (data.overall_strategy) {
    overallEl.innerHTML = `
      <div class="overall-strategy-card">
        <div class="overall-strategy-label">🎯 Cross-Platform Strategy</div>
        <div class="overall-strategy-text">${data.overall_strategy}</div>
      </div>
    `;
    overallEl.classList.remove('hidden');
  }

  const platformsData = data.platforms || {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    const insight = platformsData[pid];
    if (!insight) return;

    const card = document.createElement('div');
    card.className = 'insight-card';
    card.innerHTML = `
      <div class="insight-platform-header">
        <span class="insight-platform-icon">${p.icon}</span>
        <span class="insight-platform-name">${p.name}</span>
      </div>
      <div class="insight-headline">${insight.headline || '—'}</div>
      <div class="insight-patterns-label">Key Patterns</div>
      <ul class="insight-patterns">
        ${(insight.patterns || []).map(pat => `<li>${pat}</li>`).join('')}
      </ul>
      <div class="insight-recommendation">
        <span class="insight-rec-label">Recommendation</span>
        <div class="insight-rec-text">${insight.recommendation || '—'}</div>
      </div>
    `;
    gridEl.appendChild(card);
  });
}

function generateMockInsights() {
  const platforms = {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    platforms[pid] = {
      headline: `[Mock] ${p.name} rewards posts with strong visual hooks and consistent posting cadence`,
      patterns: [
        '[Mock] Posts with questions get 2-3x more comments',
        '[Mock] First line decides reach — emoji-led performs better',
        '[Mock] Science curiosity hooks outperform announcement posts',
      ],
      recommendation: `[Mock] Open every ${p.name} post with a surprising stat or question.`,
    };
  });
  return {
    platforms,
    overall_strategy: '[Mock] Across all platforms, curiosity-driven hooks and clear CTAs drive the most consistent engagement. Post consistently on Tue/Wed in the Gulf evening window (6–9pm GST).',
  };
}

// =============================
// VIDEO ANALYZER
// =============================

let selectedVideoFile = null;

function initVideoUpload() {
  const area       = $('video-upload-area');
  const fileInput  = $('video-file-input');
  const prompt     = $('upload-prompt');
  const selected   = $('upload-selected');
  const fileLabel  = $('upload-filename');
  const analyzeBtn = $('btn-analyze-video');
  const clearBtn   = $('btn-clear-video');
  if (!area) return;

  area.addEventListener('click', e => {
    if (clearBtn && (e.target === clearBtn || clearBtn.contains(e.target))) return;
    fileInput.click();
  });

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) setVideoFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) setVideoFile(fileInput.files[0]);
  });

  clearBtn?.addEventListener('click', e => {
    e.stopPropagation();
    selectedVideoFile = null;
    fileInput.value   = '';
    prompt.classList.remove('hidden');
    selected.classList.add('hidden');
    analyzeBtn.disabled = true;
    $('video-results')?.classList.add('hidden');
  });

  function setVideoFile(file) {
    selectedVideoFile = file;
    if (fileLabel) fileLabel.textContent = file.name;
    prompt.classList.add('hidden');
    selected.classList.remove('hidden');
    analyzeBtn.disabled = false;
  }

  analyzeBtn?.addEventListener('click', onAnalyzeVideo);
}

async function onAnalyzeVideo() {
  if (!selectedVideoFile) return;

  const analyzeBtn = $('btn-analyze-video');
  const loadingEl  = $('video-loading');
  const resultsEl  = $('video-results');
  const stepFrames = $('step-video-frames');
  const stepAI     = $('step-video-ai');

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span> Analyzing…';
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');

  [stepFrames, stepAI].forEach(el => {
    if (!el) return;
    el.classList.remove('active', 'done');
    el.classList.add('waiting');
    el.querySelector('.step-check')?.classList.add('hidden');
    const s = el.querySelector('.step-spinner');
    if (s) s.style.display = '';
  });

  try {
    let data;

    if (state.backendLive) {
      activateStep(stepFrames);
      const formData = new FormData();
      formData.append('file', selectedVideoFile);
      formData.append('topic', $('video-topic-input')?.value || 'science innovation');
      const res = await apiFetch('/analyze-video', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`API ${res.status}`);
      completeStep(stepFrames);
      activateStep(stepAI);
      data = await res.json();
      completeStep(stepAI);
    } else {
      await delay(600); activateStep(stepFrames);
      await delay(800); completeStep(stepFrames); activateStep(stepAI);
      await delay(800); completeStep(stepAI);
      data = generateMockVideoResults();
    }

    loadingEl.classList.add('hidden');
    renderVideoResults(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch {
    loadingEl.classList.add('hidden');
    renderVideoResults(generateMockVideoResults());
    resultsEl.classList.remove('hidden');
    showToast('Using mock video analysis (backend error)', 'warn');
  }

  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Video';
}

function renderVideoResults(data) {
  const summaryEl  = $('video-summary-card');
  const bestEl     = $('video-best-thumbnail');
  const framesEl   = $('video-frames-grid');
  const platformEl = $('video-platform-fit');
  const bestIdx    = data.best_thumbnail_index ?? 0;

  // ---- Summary card ----
  summaryEl.innerHTML = `
    <div class="video-summary-card">
      <div class="vsummary-header"><span class="vsummary-title">📹 Video Summary</span></div>
      <div class="vsummary-description">${data.video_summary || '—'}</div>
      <div class="vsummary-verdict">
        <div class="vsummary-verdict-label">Overall Verdict</div>
        <div class="vsummary-verdict-text">${data.overall_verdict || '—'}</div>
      </div>
      ${(data.key_improvements?.length) ? `
        <div class="vsummary-improvements">
          <div class="vsummary-improvements-label">Key Improvements</div>
          <ul class="vsummary-improvements-list">
            ${data.key_improvements.map(imp => `<li>${imp}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  // ---- Best thumbnail (full size) ----
  const bestFrame = (data.frames || []).find(f => f.index === bestIdx);
  if (bestFrame?.thumbnail) {
    const score = bestFrame.score ?? 0;
    const color = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--orange)' : 'var(--red)';
    bestEl.innerHTML = `
      <div class="results-header" style="margin-top:32px;">
        <h2>★ Best Thumbnail</h2>
        <p class="results-sub">AI-picked frame for your cover image</p>
      </div>
      <div class="best-thumbnail-card">
        <img class="best-thumbnail-img" src="${bestFrame.thumbnail}" alt="Best thumbnail">
        <div class="best-thumbnail-meta">
          <span class="frame-score" style="color:${color}">${score}/10</span>
          <div class="frame-feedback">${bestFrame.feedback || ''}</div>
        </div>
      </div>
    `;
    bestEl.classList.remove('hidden');
  } else {
    bestEl.innerHTML = '';
    bestEl.classList.add('hidden');
  }

  // ---- Frames grid ----
  framesEl.innerHTML = '';
  (data.frames || []).forEach(frame => {
    const isBest = frame.index === bestIdx;
    const score  = frame.score ?? 0;
    const color  = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--orange)' : 'var(--red)';
    const card   = document.createElement('div');
    card.className = `video-frame-card${isBest ? ' best-thumbnail' : ''}`;
    card.innerHTML = `
      ${isBest ? '<div class="thumbnail-badge">★ Best Thumbnail</div>' : ''}
      ${frame.thumbnail
        ? `<img class="frame-thumb" src="${frame.thumbnail}" alt="Frame ${frame.index}">`
        : `<div class="frame-thumb-placeholder">Frame ${frame.index + 1}</div>`}
      <div class="frame-meta">
        <div class="frame-top">
          <span class="frame-number">Frame ${frame.index + 1}</span>
          ${frame.timestamp != null ? `<span class="frame-ts">${frame.timestamp}s</span>` : ''}
          <span class="frame-score" style="color:${color}">${score}/10</span>
        </div>
        <div class="frame-feedback">${frame.feedback || ''}</div>
        <div class="frame-suggestion">💡 ${frame.suggestion || ''}</div>
      </div>
    `;
    framesEl.appendChild(card);
  });

  // ---- Platform fit ----
  platformEl.innerHTML = '';
  if (data.platforms) {
    const headerEl = document.createElement('div');
    headerEl.className = 'results-header';
    headerEl.style.marginTop = '32px';
    headerEl.innerHTML = '<h2>Platform Fit</h2><p class="results-sub">How this video lands on each platform</p>';
    platformEl.appendChild(headerEl);

    const gridEl = document.createElement('div');
    gridEl.className = 'video-platform-grid';
    platformEl.appendChild(gridEl);

    Object.entries(PLATFORMS).forEach(([pid, p]) => {
      const fit = data.platforms[pid];
      if (!fit) return;
      const card = document.createElement('div');
      card.className = 'platform-fit-card';
      card.innerHTML = `
        <div class="pfit-header">
          <span class="pfit-icon">${p.icon}</span>
          <span class="pfit-name">${p.name}</span>
        </div>
        <div class="pfit-headline">${fit.headline || '—'}</div>
        <ul class="pfit-patterns">
          ${(fit.patterns || []).map(pat => `<li>${pat}</li>`).join('')}
        </ul>
        <div class="pfit-recommendation">💡 ${fit.recommendation || '—'}</div>
      `;
      gridEl.appendChild(card);
    });
  }
}

function generateMockVideoResults() {
  const frames = Array.from({ length: 5 }, (_, i) => ({
    index: i,
    score: 5 + Math.floor(Math.random() * 5),
    feedback: `[Mock] Frame ${i + 1}: moderate visual quality, decent composition.`,
    suggestion: i === 0
      ? 'Overlay a bold opening question to create a hook.'
      : 'Brighten the shot and add a text annotation.',
    timestamp: i * 2.5,
    thumbnail: null,
  }));

  const platforms = {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    platforms[pid] = {
      headline: `[Mock] This footage suits ${p.name} with the right aspect ratio adjustment.`,
      patterns: [
        '[Mock] Good subject visibility — works as a short clip',
        '[Mock] Hook could be stronger in the opening second',
        '[Mock] Audio quality not assessable from frames alone',
      ],
      recommendation: `[Mock] Crop to ${p.name}'s optimal aspect ratio and add a text overlay on frame 1.`,
    };
  });

  return {
    video_summary: '[Mock mode] A short video clip with a subject in focus. Lighting is acceptable.',
    frames,
    best_thumbnail_index: 2,
    overall_verdict: '[Mock mode] Pacing is steady. Add a strong hook in the first second and a CTA in the last 3 seconds.',
    key_improvements: [
      'Open with a bold question or surprising stat overlay',
      'Add subtitles for silent viewing',
      'End with an explicit CTA screen',
    ],
    platforms,
  };
}

// ---- BOOT ----
init();
