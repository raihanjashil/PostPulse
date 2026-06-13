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
  persona: 'general',  // "general" | "applicants" | "viewers" | "sponsors"
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
  $('persona-select')?.addEventListener('change', e => { state.persona = e.target.value; });

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
  initImageUpload();
  initInsightModal();
  initDesignEditor();
  initPexels();

  $('btn-load-insights')?.addEventListener('click', onLoadInsights);
  $('btn-generate-campaign')?.addEventListener('click', onGenerateCampaign);

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
function resetStep(el) {
  if (!el) return;
  el.classList.remove('active', 'done');
  el.classList.add('waiting');
  el.querySelector('.step-check')?.classList.add('hidden');
  const s = el.querySelector('.step-spinner');
  if (s) s.style.display = '';
}

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
          persona: state.persona,
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

  // ---- Rewrite (EN ⇄ AR toggle + re-score) ----
  const rewritePanel = $('detail-rewrite');
  const rewriteText  = $('rewrite-text');
  if (data.rewritten) {
    rewritePanel.classList.remove('hidden');

    const langToggle = $('rewrite-lang-toggle');
    let showAlt = false;
    const renderRewriteLang = () => {
      const text = showAlt ? data.rewritten_alt : data.rewritten;
      rewriteText.textContent = text;
      applyDir(rewriteText, text);
      if (data.rewritten_alt && langToggle) {
        langToggle.classList.remove('hidden');
        const nextText = showAlt ? data.rewritten : data.rewritten_alt;
        langToggle.textContent = isArabic(nextText) ? 'عربي' : 'EN';
      } else if (langToggle) {
        langToggle.classList.add('hidden');
      }
    };
    if (langToggle) langToggle.onclick = () => { showAlt = !showAlt; renderRewriteLang(); };
    renderRewriteLang();

    // Copy whatever language version is currently visible
    $('copy-rewrite-btn').onclick = () => {
      navigator.clipboard.writeText(rewriteText.textContent).then(() => {
        const btn = $('copy-rewrite-btn');
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--green)'; btn.style.color = '#fff';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1500);
      });
    };

    // Re-score: panel is shared across platforms — reset, then restore cached result
    const rescoreBtn = $('btn-rescore');
    if (rescoreBtn) {
      rescoreBtn.disabled = false;
      rescoreBtn.textContent = '⚡ Score this version';
      rescoreBtn.onclick = () => onRescoreRewrite(pid);
    }
    renderRescoreResult(data._rescore);
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

function renderAudienceTabs(variants, activeIdx, showAlt = false) {
  audienceTabs.innerHTML = variants.map((v, i) => `
    <button class="audience-tab${i === activeIdx ? ' active' : ''}" data-idx="${i}">${v.region} · ${v.audience}</button>
  `).join('');

  audienceTabs.querySelectorAll('.audience-tab').forEach(btn => {
    btn.addEventListener('click', () => renderAudienceTabs(variants, Number(btn.dataset.idx), showAlt));
  });

  const v = variants[activeIdx];
  const text = (showAlt && v.rewritten_alt) ? v.rewritten_alt : v.rewritten;
  const nextText = showAlt ? v.rewritten : v.rewritten_alt;
  audienceBody.innerHTML = `
    <div class="audience-rewrite-wrap">
      ${v.rewritten_alt ? `<button class="copy-btn audience-lang-btn">${isArabic(nextText) ? 'عربي' : 'EN'}</button>` : ''}
      <button class="copy-btn audience-copy-btn">Copy</button>
      <div class="audience-rewrite">${text}</div>
    </div>
    <div class="audience-rationale">${v.rationale}</div>
  `;
  applyDir(audienceBody.querySelector('.audience-rewrite'), text);
  audienceBody.querySelector('.audience-lang-btn')?.addEventListener('click', () => {
    renderAudienceTabs(variants, activeIdx, !showAlt);
  });
  audienceBody.querySelector('.audience-copy-btn').addEventListener('click', e => {
    navigator.clipboard.writeText(text).then(() => {
      const btn = e.target;
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green)'; btn.style.color = '#fff';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1500);
    });
  });
}

// ---- POSTING-TIME HEATMAP ----
// Mirror of backend OPTIMAL_POSTING_TIMES, pre-bucketed into time-of-day columns.
const HEAT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HEAT_BUCKETS = [
  ['early', '🌅 6–9a'],
  ['lateam', '☀️ 9–12'],
  ['midday', '🌤️ 12–3'],
  ['afternoon', '🌇 3–6'],
  ['evening', '🌆 6–9p'],
  ['night', '🌙 9p+'],
];
const POSTING_HEATMAP = {
  instagram: { days: ['Tue', 'Wed', 'Fri'], buckets: ['early', 'midday', 'afternoon', 'evening'], note: 'Thursday evening high engagement pre-weekend in Gulf' },
  linkedin:  { days: ['Tue', 'Wed', 'Thu'], buckets: ['early', 'midday', 'afternoon'], note: 'Avoid Fri–Sat — MENA weekend, low B2B traffic' },
  tiktok:    { days: ['Tue', 'Thu', 'Fri'], buckets: ['early', 'lateam', 'evening'], note: 'Friday night peak across the Gulf region' },
  youtube:   { days: ['Thu', 'Fri', 'Sat'], buckets: ['midday', 'afternoon', 'evening', 'night'], note: 'Saturday afternoon peak for MENA viewership' },
  twitter:   { days: ['Mon', 'Wed', 'Fri'], buckets: ['early', 'lateam', 'midday'], note: 'News cycle peaks at 9am Gulf Standard Time' },
  facebook:  { days: ['Wed', 'Thu', 'Fri'], buckets: ['midday', 'evening'], note: 'Friday afternoon and evening peak across the Gulf' },
};

function renderSchedule() {
  scheduleGrid.innerHTML = '';

  // Header row: blank corner + bucket labels
  let html = '<div class="heatmap">';
  html += '<div class="hm-corner"></div>';
  HEAT_BUCKETS.forEach(([, label]) => { html += `<div class="hm-head">${label}</div>`; });

  // One row per day; each cell collects platforms active in that (day, bucket)
  HEAT_DAYS.forEach(day => {
    html += `<div class="hm-day">${day}</div>`;
    HEAT_BUCKETS.forEach(([bucket]) => {
      const hits = Object.entries(POSTING_HEATMAP)
        .filter(([, cfg]) => cfg.days.includes(day) && cfg.buckets.includes(bucket))
        .map(([pid]) => pid);
      const level = Math.min(hits.length, 3);
      const icons = hits.map(pid => `<span title="${PLATFORMS[pid]?.name || pid}">${PLATFORMS[pid]?.icon || ''}</span>`).join('');
      html += `<div class="hm-cell hm-${level}">${icons}</div>`;
    });
  });
  html += '</div>';

  // Legend with per-platform MENA notes
  html += '<div class="hm-legend">';
  Object.entries(POSTING_HEATMAP).forEach(([pid, cfg]) => {
    const p = PLATFORMS[pid];
    html += `<span class="hm-legend-item" title="${cfg.note}">${p?.icon || ''} ${p?.name || pid}</span>`;
  });
  html += '</div>';

  scheduleGrid.innerHTML = html;
}

// ---- ONE-CLICK PUBLISH ----
async function onPublish(platform) {
  const data = state.results?.results?.[platform];
  if (!data) return;

  const useRewrite = data.rewritten
    && confirm(`Publish the AI-rewritten version to ${PLATFORMS[platform].name}?\n\nOK = AI rewrite\nCancel = your original draft`);
  const textToPost = useRewrite ? data.rewritten : state.draft;

  const btns = [
    scoreGrid.querySelector(`.btn-publish[data-platform="${platform}"]`),
    $(`btn-publish-detail-${platform}`),
  ].filter(Boolean);

  await publishText(platform, textToPost, btns);
}

// Core publish call — shared by the Post Scorer detail panel and Campaign Pack cards.
async function publishText(platform, text, btns = []) {
  btns.forEach(b => { b.disabled = true; b.textContent = 'Publishing…'; });

  try {
    const res = await apiFetch('/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, text }),
    });

    if (res.ok) {
      const result = await res.json();
      showToast(`Posted to ${PLATFORMS[platform].name}!${result.url ? ' View →' : ''}`);
      btns.forEach(b => {
        b.textContent = 'Published ✓';
        b.style.background = 'var(--green)';
      });
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`Publish failed: ${err.detail || 'Unknown error'}`, 'error');
      btns.forEach(b => { b.disabled = false; b.textContent = 'Publish'; b.style.background = ''; });
      return false;
    }
  } catch {
    showToast('Network error — publish failed', 'error');
    btns.forEach(b => { b.disabled = false; b.textContent = 'Publish'; b.style.background = ''; });
    return false;
  }
}

// ---- RE-SCORE THE REWRITE ----
async function onRescoreRewrite(pid) {
  const data = state.results?.results?.[pid];
  if (!data) return;

  const btn = $('btn-rescore');
  const oldScore = data.overall_score || 0;
  const visibleRewrite = $('rewrite-text').textContent;

  btn.disabled = true;
  btn.textContent = 'Scoring…';

  let newScore = null;
  try {
    if (state.backendLive) {
      const res = await apiFetch('/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft: visibleRewrite,
          platform: pid,
          topic: state.topic,
          goal: state.goal,
          persona: state.persona,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      // Response stays local — never assign to state.results (single-platform
      // response would wipe the other platforms and the recommendation).
      const json = await res.json();
      newScore = json.results?.[pid]?.overall_score;
      if (newScore == null) throw new Error('No score in response');
    } else {
      await delay(900);
      newScore = clamp(oldScore + rand(8, 25), oldScore + 1, 98);
    }
  } catch {
    await delay(300);
    newScore = clamp(oldScore + rand(8, 25), oldScore + 1, 98);
    showToast('Using mock re-score (backend error)', 'warn');
  }

  data._rescore = { old: oldScore, new: newScore };
  renderRescoreResult(data._rescore);

  btn.disabled = false;
  btn.textContent = '⚡ Score this version';
}

function renderRescoreResult(rs) {
  const el = $('rescore-result');
  if (!el) return;
  if (!rs) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const diff = rs.new - rs.old;
  const sign = diff >= 0 ? '+' : '';
  el.innerHTML = `
    <span class="rescore-label">Rewrite impact:</span>
    <span class="rescore-scores">${rs.old} → <strong>${rs.new}</strong></span>
    <span class="delta ${diff >= 0 ? 'up' : 'down'}">${sign}${diff}</span>
  `;
  el.classList.remove('hidden');
}

// =============================
// HELPERS
// =============================

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmtNum(n) { if (n == null) return '—'; return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function isArabic(text) { return /[؀-ۿ]/.test(text || ''); }
function applyDir(el, text) {
  if (!el) return;
  if (isArabic(text)) {
    el.setAttribute('dir', 'rtl');
    el.classList.add('rtl');
  } else {
    el.removeAttribute('dir');
    el.classList.remove('rtl');
  }
}

// ---- Real Growth vs. Noise: two-axis tiers ----
// Below this many avg likes, comments-per-100-likes is statistical noise.
const MIN_LIKES_FOR_RATE = 50;

function reachTier(likes) {
  if (likes >= 100000) return { label: 'Huge',   level: 5 };
  if (likes >= 10000)  return { label: 'Large',  level: 4 };
  if (likes >= 1000)   return { label: 'Medium', level: 3 };
  if (likes >= 100)    return { label: 'Small',  level: 2 };
  return { label: 'Tiny', level: 1 };
}

function conversationTier(m) {
  if ((m.avg_likes || 0) < MIN_LIKES_FOR_RATE) {
    return { label: 'Not enough data', level: 0, cls: 'conv-none', weak: true };
  }
  const r = m.comment_rate || 0;
  if (r >= 5) return { label: 'Deep',     level: 3, cls: 'conv-deep' };
  if (r >= 1) return { label: 'Moderate', level: 2, cls: 'conv-moderate' };
  return { label: 'Shallow', level: 1, cls: 'conv-shallow' };
}

// Whose account a given Account-Intelligence row reflects (typed handle vs SoS default).
function sourceLabel(pid) {
  const v = lastInsightsSources[pid];
  if (!v) return 'Stars of Science (default)';
  const short = v.length > 28 ? v.slice(0, 28) + '…' : v;
  return (pid === 'youtube' || pid === 'facebook') ? short : '@' + short.replace(/^@/, '');
}

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
  const draftIsArabic = isArabic(draft);
  const MOCK_AR_REWRITE = '🚀 [وضع تجريبي] هنا تظهر النسخة العربية المعاد كتابتها بالذكاء الاصطناعي — شغّل الخادم لرؤية إعادة الكتابة الحقيقية المخصصة لكل منصة.';
  const MOCK_EN_REWRITE = '🚀 [Mock] This is where the English adaptation would appear — connect the backend for the real culturally adapted version.';

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
      rewritten: draftIsArabic
        ? MOCK_AR_REWRITE
        : `🚀 This is where the AI-rewritten version would appear.\n\nIn live mode, GPT-4o-mini rewrites your draft optimized for ${PLATFORMS[pid]?.name || pid}, with the right tone, length, and CTA.\n\n[Mock mode — connect the backend to see real rewrites]`,
      rewritten_alt: draftIsArabic ? MOCK_EN_REWRITE : MOCK_AR_REWRITE,
      draft_language: draftIsArabic ? 'ar' : 'en',
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
        { region: '🇶🇦🇦🇪 Qatar & UAE', audience: 'Gulf Youth (18-24)', rewritten: `🌟 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for Gulf youth.`, rewritten_alt: draftIsArabic ? MOCK_EN_REWRITE : '🌟 [وضع تجريبي] نسخة عربية مخصصة لشباب الخليج.', rationale: 'Youthful tone and emojis resonate with this audience.' },
        { region: '🇸🇦 Saudi Arabia', audience: 'STEM Students & Young Professionals', rewritten: `🔬 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for Saudi STEM audience.`, rewritten_alt: draftIsArabic ? MOCK_EN_REWRITE : '🔬 [وضع تجريبي] نسخة عربية مخصصة لطلاب العلوم في السعودية.', rationale: 'Frames the post around STEM relevance and career growth.' },
        { region: '🇪🇬 Egypt & Levant', audience: 'Parents & Educators', rewritten: `📚 [Mock] ${draft.slice(0, 80)}${draft.length > 80 ? '…' : ''} — rewritten for parents & educators.`, rewritten_alt: draftIsArabic ? MOCK_EN_REWRITE : '📚 [وضع تجريبي] نسخة عربية مخصصة للأهالي والمعلمين.', rationale: 'Speaks to families and the educational value of the program.' },
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

// Maps platform -> the handle the user typed (or null = SoS default). The 5 input
// fields cover ig/tiktok/twitter/youtube/facebook; linkedin has no field.
const INSIGHTS_FIELDS = {
  instagram: 'insights-instagram',
  tiktok: 'insights-tiktok',
  twitter: 'insights-twitter',
  youtube: 'insights-youtube',
  facebook: 'insights-facebook',
};
let lastInsightsSources = {};
let lastInsightsData = null;   // full payload from the last /insights call (for the modal)

async function onLoadInsights() {
  const btn        = $('btn-load-insights');
  const loadingEl  = $('insights-loading');
  const gridEl     = $('insights-grid');
  const overallEl  = $('insights-overall');
  const stepFetch  = $('step-insights-fetch');
  const stepAI     = $('step-insights-ai');

  // Capture which platforms the user typed a handle for (vs SoS default fallback)
  lastInsightsSources = {};
  Object.entries(INSIGHTS_FIELDS).forEach(([platform, inputId]) => {
    lastInsightsSources[platform] = $(inputId)?.value.trim() || null;
  });

  btn.disabled = true;
  btn.textContent = 'Loading…';
  loadingEl.classList.remove('hidden');
  gridEl.innerHTML = '';
  overallEl.classList.add('hidden');
  $('insights-growth')?.classList.add('hidden');

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
    let data, usedMock = false, mockReason = '';
    if (state.backendLive) {
      activateStep(stepFetch);
      const params = new URLSearchParams();
      Object.entries(lastInsightsSources).forEach(([platform, val]) => {
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
      usedMock = true;
      mockReason = 'The backend server isn’t running.';
      await delay(800);
      activateStep(stepFetch);
      await delay(600);
      completeStep(stepFetch);
      activateStep(stepAI);
      await delay(800);
      completeStep(stepAI);
      data = generateMockInsights(lastInsightsSources);
    }

    loadingEl.classList.add('hidden');
    renderInsights(data, { mock: usedMock, reason: mockReason });
    if (!usedMock) showToast('Account Intelligence loaded');
  } catch {
    loadingEl.classList.add('hidden');
    renderInsights(generateMockInsights(lastInsightsSources), {
      mock: true,
      reason: 'The live request failed (network or API error).',
    });
    showToast('Using mock insights data', 'warn');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">🔄</span> Refresh Intelligence';
}

// Account Intelligence targets these 5 (LinkedIn has no scraper — excluded).
const INSIGHTS_PLATFORMS = ['instagram', 'tiktok', 'twitter', 'youtube', 'facebook'];

// Map the backend's per-platform engagement_quality to the Conversation axis.
const QUALITY_CONV = {
  high:   { label: 'Deep',     level: 3, cls: 'conv-deep' },
  medium: { label: 'Moderate', level: 2, cls: 'conv-moderate' },
  low:    { label: 'Shallow',  level: 1, cls: 'conv-shallow' },
};
function conversationFromStats(stats) {
  if ((stats.avg_likes || 0) < MIN_LIKES_FOR_RATE) {
    return { label: 'Not enough data', level: 0, cls: 'conv-none', weak: true };
  }
  return QUALITY_CONV[stats.engagement_quality] || QUALITY_CONV.low;
}

function fmtFollowers(v) {
  if (v == null) return null;
  return typeof v === 'number' ? `${fmtNum(v)} followers` : escapeHtml(String(v));
}

function renderAcctColumn(stats) {
  if (!stats) return '';
  const name = stats.is_default ? 'Stars of Science' : escapeHtml(stats.handle || 'Account');
  if (!stats.has_data) {
    return `<div class="acct-col">
      <div class="acct-name">${name}</div>
      <div class="acct-error">⚠️ ${escapeHtml(stats.error || 'no data')}</div>
    </div>`;
  }
  const reach = reachTier(stats.avg_likes || 0);
  const conv  = conversationFromStats(stats);
  const convValue = conv.weak ? '—' : `${conv.label} · ${stats.comment_rate}/100 likes`;
  const chips = [fmtFollowers(stats.follower_count), stats.engagement_rate != null ? `${stats.engagement_rate}% eng. rate` : null]
    .filter(Boolean).map(c => `<span class="acct-chip">${c}</span>`).join('');
  return `<div class="acct-col">
    <div class="acct-name">${name}</div>
    ${chips ? `<div class="acct-chips">${chips}</div>` : ''}
    <div class="axis">
      <span class="axis-label">Reach</span>
      <div class="axis-bar"><div class="axis-fill reach" style="width:${(reach.level / 5) * 100}%"></div></div>
      <span class="axis-value">${reach.label} · ${fmtNum(stats.avg_likes)} likes</span>
    </div>
    <div class="axis">
      <span class="axis-label">Conversation</span>
      <div class="axis-bar"><div class="axis-fill ${conv.cls}" style="width:${(conv.level / 3) * 100}%"></div></div>
      <span class="axis-value" title="${stats.avg_comments || 0} avg comments/post">${convValue}</span>
    </div>
  </div>`;
}

function renderTopPosts(sos, competitor) {
  const block = (stats) => {
    const tp = (stats && stats.top_posts) || [];
    if (!tp.length) return '';
    const who = stats.is_default ? 'Stars of Science' : escapeHtml(stats.handle || 'Account');
    const items = tp.map(post => `
      <div class="insight-post">
        <div class="insight-post-caption">${escapeHtml(post.caption || '(no caption)')}</div>
        <div class="insight-post-stats">❤ ${fmtNum(post.likes || 0)} · 💬 ${fmtNum(post.comments || 0)}${post.views != null ? ` · ▶ ${fmtNum(post.views)}` : ''}</div>
      </div>`).join('');
    return `<div class="insight-posts-group"><div class="insight-posts-who">${who}</div>${items}</div>`;
  };
  const out = block(sos) + (competitor ? block(competitor) : '');
  return out ? `<div class="insight-posts"><div class="insight-posts-label">Top posts (real data)</div>${out}</div>` : '';
}

// Section explainers — moved off-page, surfaced via the (i) info icons.
const STRATEGY_EXPLAINER = "A cross-platform read of where Stars of Science should focus. It's synthesized from the real per-platform metrics below — which platforms carry genuine engagement versus just raw reach — so effort goes where the audience actually responds.";
const GROWTH_EXPLAINER = "Reach = audience size (likes). Conversation = how often people actually comment (per 100 likes, judged per platform). Engagement rate = (likes + comments) ÷ followers. Big reach + shallow conversation = vanity; small but deep = real community. Tap any platform to open its full AI insights.";

function renderInsights(data, opts = {}) {
  const gridEl    = $('insights-grid');
  const overallEl = $('insights-overall');
  const growthEl  = $('insights-growth');
  const banner    = $('insights-mock-banner');
  if (gridEl) { gridEl.innerHTML = ''; gridEl.classList.add('hidden'); }  // content now lives in the modal

  lastInsightsData = data;  // cached so the modal can read each platform's insight on demand

  // Persistent mock-mode banner — fabricated data must never masquerade as real
  if (banner) {
    if (opts.mock) {
      const reasonEl = $('insights-mock-reason');
      if (reasonEl) reasonEl.textContent = opts.reason || '';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  if (data.overall_strategy) {
    overallEl.innerHTML = `
      <div class="overall-strategy-card">
        <div class="overall-strategy-label">🎯 Cross-Platform Strategy
          <button class="info-icon section-info" data-info="strategy" title="What is this?" aria-label="About Cross-Platform Strategy">i</button>
        </div>
        <div class="overall-strategy-text">${escapeHtml(data.overall_strategy)}</div>
      </div>`;
    overallEl.classList.remove('hidden');
    overallEl.querySelector('.section-info')?.addEventListener('click', () =>
      openInfoModal('Cross-Platform Strategy', STRATEGY_EXPLAINER, '🎯'));
  } else {
    overallEl.classList.add('hidden');
  }

  // ---- Real Growth vs. Noise (side-by-side SoS vs competitor) ----
  const accounts = data.accounts || {};
  const platformsData = data.platforms || {};
  if (growthEl && Object.keys(accounts).length) {
    const rows = INSIGHTS_PLATFORMS.map(pid => {
      const p = PLATFORMS[pid];
      const acc = accounts[pid] || {};
      const insight = platformsData[pid];
      const hasInsight = insight && !insight.no_data;  // clickable only when there's something to show
      const cols = [renderAcctColumn(acc.sos)];
      if (acc.competitor) cols.push(renderAcctColumn(acc.competitor));
      return `
        <div class="growth-row${hasInsight ? ' clickable' : ''}" data-platform="${pid}">
          <div class="growth-head">
            <span class="growth-platform">${p.icon} ${p.name}</span>
            ${hasInsight ? `
              <button class="info-icon" data-platform="${pid}" title="View ${p.name} insights" aria-label="View ${p.name} insights">i</button>
              <span class="growth-row-cta">View insights →</span>` : ''}
          </div>
          <div class="acct-compare cols-${cols.length}">${cols.join('')}</div>
        </div>`;
    }).join('');

    growthEl.innerHTML = `
      <div class="growth-card">
        <div class="growth-title">📊 Real Growth vs. Noise
          <button class="info-icon section-info" data-info="growth" title="What does this mean?" aria-label="About Real Growth vs. Noise">i</button>
        </div>
        ${data.real_growth_summary ? `<div class="growth-summary">${escapeHtml(data.real_growth_summary)}</div>` : ''}
        <div class="growth-rows">${rows}</div>
        <div class="growth-hint">Tap a platform to open its full AI insights →</div>
      </div>`;
    growthEl.classList.remove('hidden');

    // Section info icon → explainer modal
    growthEl.querySelector('.section-info')?.addEventListener('click', e => {
      e.stopPropagation();
      openInfoModal('Real Growth vs. Noise', GROWTH_EXPLAINER, '📊');
    });
    // Clicking a platform row (or its info icon) → 4-slide insight modal
    growthEl.querySelectorAll('.growth-row.clickable').forEach(row => {
      row.addEventListener('click', () => openInsightModal(row.dataset.platform));
    });
  } else if (growthEl) {
    growthEl.classList.add('hidden');
    growthEl.innerHTML = '';
  }
}

// =============================
// INSIGHT / INFO MODAL
// =============================

const modalState = { slides: [], idx: 0 };

function buildInsightSlides(pid, data) {
  const insight = (data.platforms || {})[pid] || {};
  const acc     = (data.accounts  || {})[pid] || {};

  if (insight.error) {
    return [{ label: 'Overview', html: `<div class="insight-error">⚠️ ${escapeHtml(insight.error)}</div>` }];
  }

  const comparison = insight.comparison
    ? `<div class="insight-comparison">⚖️ ${escapeHtml(insight.comparison)}</div>`
    : '<div class="modal-empty">No competitor comparison for this account.</div>';
  const patterns = (insight.patterns || []).map(pat => `<li>${escapeHtml(pat)}</li>`).join('')
    || '<li class="modal-empty">No patterns identified.</li>';
  const verdict = insight.growth_verdict
    ? `<div class="insight-verdict">${escapeHtml(insight.growth_verdict)}</div>`
    : '';
  const posts = renderTopPosts(acc.sos, acc.competitor) || '<div class="modal-empty">No post-level data available.</div>';

  return [
    {
      label: 'Overview',
      html: `
        <div class="insight-headline">${escapeHtml(insight.headline || '—')}</div>
        ${comparison}`,
    },
    {
      label: 'Patterns',
      html: `
        <div class="insight-patterns-label">Key Patterns</div>
        <ul class="insight-patterns">${patterns}</ul>`,
    },
    {
      label: 'Recommendation & Verdict',
      html: `
        <div class="insight-recommendation">
          <span class="insight-rec-label">Recommendation</span>
          <div class="insight-rec-text">${escapeHtml(insight.recommendation || '—')}</div>
        </div>
        ${verdict || '<div class="modal-empty">No verdict available.</div>'}`,
    },
    {
      label: 'Post Analysis',
      html: posts,
    },
  ];
}

function openInsightModal(pid) {
  if (!lastInsightsData) return;
  const p = PLATFORMS[pid];
  openModal({
    icon: p?.icon || '📊',
    title: `${p?.name || pid} — Account Insights`,
    slides: buildInsightSlides(pid, lastInsightsData),
  });
}

function openInfoModal(title, text, icon = 'ℹ️') {
  openModal({ icon, title, slides: [{ html: `<div class="modal-text">${escapeHtml(text)}</div>` }] });
}

function openModal({ icon = 'ℹ️', title = '', slides = [] }) {
  const modal = $('insight-modal');
  if (!modal) return;
  modalState.slides = slides;
  modalState.idx = 0;
  $('insight-modal-icon').textContent = icon;
  $('insight-modal-title').textContent = title;
  renderModalSlide();
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function renderModalSlide() {
  const { slides, idx } = modalState;
  const slide = slides[idx] || { html: '' };
  const body  = $('insight-modal-body');
  const nav   = $('insight-modal-nav');

  body.innerHTML = `
    <div class="insight-modal-slide">
      ${slide.label ? `<div class="insight-modal-slide-label">${escapeHtml(slide.label)}</div>` : ''}
      ${slide.html}
    </div>`;

  if (slides.length > 1) {
    nav.classList.remove('hidden');
    $('insight-modal-indicator').textContent = `${idx + 1} / ${slides.length}`;
    $('insight-modal-prev').disabled = idx === 0;
    $('insight-modal-next').disabled = idx === slides.length - 1;
  } else {
    nav.classList.add('hidden');
  }
}

function modalStep(delta) {
  const next = modalState.idx + delta;
  if (next < 0 || next >= modalState.slides.length) return;
  modalState.idx = next;
  renderModalSlide();
}

function closeModal() {
  $('insight-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function initInsightModal() {
  const modal = $('insight-modal');
  if (!modal) return;
  $('insight-modal-close')?.addEventListener('click', closeModal);
  $('insight-modal-backdrop')?.addEventListener('click', closeModal);
  $('insight-modal-prev')?.addEventListener('click', () => modalStep(-1));
  $('insight-modal-next')?.addEventListener('click', () => modalStep(1));
  document.addEventListener('keydown', e => {
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'ArrowLeft') modalStep(-1);
    else if (e.key === 'ArrowRight') modalStep(1);
  });
}

// Per-platform mock comment-rate thresholds (mirror of the backend) so labels look right.
const COMMENT_RATE_MOCK = {
  instagram: [1.5, 0.5], tiktok: [1, 0.3], twitter: [10, 3], youtube: [2, 0.5], facebook: [3, 1],
};

function generateMockInsights(sources = {}) {
  const accounts = {};
  const platforms = {};

  const mkStats = (pid, handle, isDefault) => {
    const tiny = pid === 'facebook' && isDefault;   // show the small-sample guard offline
    const avgLikes = tiny ? 18 : rand(200, 4000);
    const avgComments = tiny ? 1 : rand(5, 120);
    const commentRate = avgLikes > 0 ? Math.round((avgComments / avgLikes) * 10000) / 100 : 0;
    const [hi, med] = COMMENT_RATE_MOCK[pid] || [5, 1];
    const quality = commentRate >= hi ? 'high' : commentRate >= med ? 'medium' : 'low';
    const followers = rand(3000, 2000000);
    const isVideo = pid === 'tiktok' || pid === 'youtube';
    return {
      platform: pid,
      handle: isDefault ? 'Stars of Science (default)' : handle,
      is_default: isDefault,
      has_data: true,
      error: null,
      post_count: 10,
      follower_count: followers,
      avg_likes: avgLikes,
      avg_comments: avgComments,
      avg_views: isVideo ? rand(2000, 600000) : null,
      avg_retweets: pid === 'twitter' ? rand(2, 200) : null,
      avg_caption_len: rand(40, 180),
      avg_hashtags: rand(0, 6),
      comment_rate: commentRate,
      engagement_quality: quality,
      engagement_rate: Math.round(((avgLikes + avgComments) / followers) * 100 * 100) / 100,
      top_posts: [1, 2, 3].map(i => ({
        caption: `[Mock] ${PLATFORMS[pid].name} post ${i} — a science moment that did numbers`,
        likes: avgLikes + rand(50, 2000),
        comments: avgComments + rand(1, 60),
        views: isVideo ? rand(5000, 900000) : null,
        retweets: null,
        hashtags: ['#StarsOfScience', '#Innovation'].slice(0, rand(0, 2)),
      })),
    };
  };

  INSIGHTS_PLATFORMS.forEach(pid => {
    const p = PLATFORMS[pid];
    const competitorHandle = sources[pid];
    accounts[pid] = {
      sos: mkStats(pid, null, true),
      competitor: competitorHandle ? mkStats(pid, '@' + String(competitorHandle).replace(/^@/, ''), false) : null,
    };
    const tiny = pid === 'facebook';
    platforms[pid] = {
      headline: `[Mock] ${p.name} rewards curiosity-driven hooks`,
      patterns: [
        '[Mock] Top posts run longer captions than the account average',
        '[Mock] Posts framed as questions lift comments',
        '[Mock] Best posts keep hashtags modest',
      ],
      recommendation: `[Mock] Lead every ${p.name} post with a surprising stat or question.`,
      growth_verdict: tiny
        ? '[Mock] Too few likes to read conversation reliably.'
        : '[Mock] Healthy comment rate — this looks like real conversation, not just reach.',
      comparison: competitorHandle
        ? `[Mock] vs @${String(competitorHandle).replace(/^@/, '')}: comparable reach, but SoS edges ahead on comment rate.`
        : null,
    };
  });

  return {
    platforms,
    accounts,
    overall_strategy: '[Mock] Lead with curiosity hooks across platforms and chase comments, not just likes.',
    real_growth_summary: '[Mock] The real community lives where the comment rate is highest; platforms with big likes but quiet comment sections are vanity reach.',
    generated_at: 'mock',
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

// =============================
// IMAGE ANALYZER
// =============================

let selectedImageFile = null;
let imagePreviewUrl = null;

const IMAGE_CRITERIA = [
  { key: 'visual_hook',        label: 'Visual Hook' },
  { key: 'composition',        label: 'Composition' },
  { key: 'text_readability',   label: 'Text Readability' },
  { key: 'brand_fit',          label: 'Brand Fit' },
  { key: 'platform_readiness', label: 'Platform Readiness' },
];

function initImageUpload() {
  const area       = $('image-upload-area');
  const fileInput  = $('image-file-input');
  const prompt     = $('upload-prompt-image');
  const selected   = $('upload-selected-image');
  const fileLabel  = $('image-filename');
  const analyzeBtn = $('btn-analyze-image');
  const clearBtn   = $('btn-clear-image');
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
    if (file) setImageFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) setImageFile(fileInput.files[0]);
  });
  clearBtn?.addEventListener('click', e => {
    e.stopPropagation();
    selectedImageFile = null;
    if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null; }
    fileInput.value = '';
    prompt.classList.remove('hidden');
    selected.classList.add('hidden');
    analyzeBtn.disabled = true;
    $('image-results')?.classList.add('hidden');
  });

  function setImageFile(file) {
    selectedImageFile = file;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = URL.createObjectURL(file);
    if (fileLabel) fileLabel.textContent = file.name;
    prompt.classList.add('hidden');
    selected.classList.remove('hidden');
    analyzeBtn.disabled = false;
  }

  analyzeBtn?.addEventListener('click', onAnalyzeImage);
}

async function onAnalyzeImage() {
  if (!selectedImageFile) return;

  const analyzeBtn = $('btn-analyze-image');
  const loadingEl  = $('image-loading');
  const resultsEl  = $('image-results');
  const stepRead   = $('step-image-read');
  const stepAI     = $('step-image-ai');

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="btn-icon">⏳</span> Analyzing…';
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  [stepRead, stepAI].forEach(resetStep);

  try {
    let data;
    if (state.backendLive) {
      activateStep(stepRead);
      const formData = new FormData();
      formData.append('file', selectedImageFile);
      formData.append('topic', $('image-topic-input')?.value || 'science innovation');
      const res = await apiFetch('/analyze-image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`API ${res.status}`);
      completeStep(stepRead);
      activateStep(stepAI);
      data = await res.json();
      completeStep(stepAI);
    } else {
      await delay(500); activateStep(stepRead);
      await delay(700); completeStep(stepRead); activateStep(stepAI);
      await delay(800); completeStep(stepAI);
      data = generateMockImageResults();
    }
    if (data.error) throw new Error(data.error);

    loadingEl.classList.add('hidden');
    renderImageResults(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    loadingEl.classList.add('hidden');
    renderImageResults(generateMockImageResults());
    resultsEl.classList.remove('hidden');
    showToast('Using mock image analysis (backend error)', 'warn');
  }

  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Image';
}

function renderImageResults(data) {
  // ---- Preview (uses the locally selected file; backend doesn't echo the image) ----
  const previewEl = $('image-preview');
  if (previewEl) {
    previewEl.innerHTML = imagePreviewUrl
      ? `<img class="image-preview-img" src="${imagePreviewUrl}" alt="Uploaded image">`
      : '';
  }

  // ---- Summary ----
  $('image-summary-card').innerHTML = `
    <div class="video-summary-card">
      <div class="vsummary-header"><span class="vsummary-title">🖼️ Image Summary</span></div>
      <div class="vsummary-description">${data.image_summary || '—'}</div>
    </div>
  `;

  // ---- Score + breakdown ----
  $('image-score').textContent = data.overall_score ?? 0;
  const breakdownEl = $('image-breakdown');
  breakdownEl.innerHTML = '<div class="section-label">Visual Breakdown</div>';
  const scores = data.scores || {};
  IMAGE_CRITERIA.forEach(c => {
    const val = scores[c.key] || 0;
    const pct = (val / 20) * 100;
    const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--orange)' : 'var(--red)';
    breakdownEl.innerHTML += `
      <div class="breakdown-row">
        <span class="breakdown-label">${c.label}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-bg"><div class="breakdown-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="breakdown-score" style="color:${color}">${val}/20</span>
        </div>
      </div>`;
  });

  // ---- Strengths / weaknesses / suggestions ----
  const analysisEl = $('image-analysis');
  analysisEl.innerHTML = '<div class="section-label">AI Analysis</div>';
  (data.strengths || []).forEach(s => {
    analysisEl.innerHTML += `<div class="suggestion-item"><div class="suggestion-icon good">✓</div><span class="suggestion-text">${s}</span></div>`;
  });
  (data.weaknesses || []).forEach(w => {
    analysisEl.innerHTML += `<div class="suggestion-item"><div class="suggestion-icon tip">!</div><span class="suggestion-text">${w}</span></div>`;
  });
  (data.suggestions || []).forEach(s => {
    analysisEl.innerHTML += `<div class="suggestion-item"><div class="suggestion-icon fix">→</div><span class="suggestion-text">${s}</span></div>`;
  });

  // ---- Platform fit (reuse the video platform-fit grid) ----
  const platformEl = $('image-platform-fit');
  platformEl.innerHTML = '';
  if (data.platforms) {
    const headerEl = document.createElement('div');
    headerEl.className = 'results-header';
    headerEl.style.marginTop = '32px';
    headerEl.innerHTML = '<h2>Platform Fit</h2><p class="results-sub">How this image lands on each platform</p>';
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
        <div class="pfit-header"><span class="pfit-icon">${p.icon}</span><span class="pfit-name">${p.name}</span></div>
        <div class="pfit-headline">${fit.headline || '—'}</div>
        <ul class="pfit-patterns">${(fit.patterns || []).map(pat => `<li>${pat}</li>`).join('')}</ul>
        <div class="pfit-recommendation">💡 ${fit.recommendation || '—'}</div>
      `;
      gridEl.appendChild(card);
    });
  }
}

function generateMockImageResults() {
  const platforms = {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    platforms[pid] = {
      headline: `[Mock] This visual works on ${p.name} with the right crop.`,
      patterns: [
        '[Mock] Clear focal subject',
        '[Mock] Text legibility is borderline at small sizes',
        '[Mock] Colors fit a science / innovation brand',
      ],
      recommendation: `[Mock] Crop to ${p.name}'s aspect ratio and boost contrast on any overlaid text.`,
    };
  });
  return {
    image_summary: '[Mock mode] A graphic with a central subject and some overlaid text on a clean background.',
    overall_score: rand(55, 85),
    scores: {
      visual_hook: rand(10, 18),
      composition: rand(10, 18),
      text_readability: rand(8, 16),
      brand_fit: rand(12, 19),
      platform_readiness: rand(9, 17),
    },
    strengths: ['Strong focal subject', 'On-brand color palette'],
    weaknesses: ['Text may be hard to read on mobile', 'Edges feel slightly cramped'],
    suggestions: ['Increase text size / contrast', 'Add safe-margin padding around key elements', 'Test a 1:1 and a 9:16 crop'],
    platforms,
  };
}

// =============================
// CAMPAIGN PACK
// =============================

let lastCampaign = null;

async function onGenerateCampaign() {
  const goalText = $('campaign-goal-input')?.value.trim();
  if (!goalText) { showToast('Describe your campaign goal first', 'warn'); return; }

  const btn       = $('btn-generate-campaign');
  const loadingEl = $('campaign-loading');
  const resultsEl = $('campaign-results');
  const stepPlan  = $('step-campaign-plan');
  const stepAI    = $('step-campaign-ai');
  const persona   = $('campaign-persona')?.value || 'general';
  const goal      = $('campaign-goal-select')?.value || 'reach';

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Generating…';
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  [stepPlan, stepAI].forEach(resetStep);

  try {
    let data;
    if (state.backendLive) {
      activateStep(stepPlan);
      const res = await apiFetch('/campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_goal: goalText, persona, goal }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      completeStep(stepPlan);
      activateStep(stepAI);
      data = await res.json();
      completeStep(stepAI);
    } else {
      await delay(600); activateStep(stepPlan);
      await delay(700); completeStep(stepPlan); activateStep(stepAI);
      await delay(900); completeStep(stepAI);
      data = generateMockCampaign(goalText, persona);
    }

    loadingEl.classList.add('hidden');
    renderCampaign(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    loadingEl.classList.add('hidden');
    renderCampaign(generateMockCampaign(goalText, persona));
    resultsEl.classList.remove('hidden');
    showToast('Using mock campaign pack (backend error)', 'warn');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">🚀</span> Generate Campaign Pack';
}

function renderCampaign(data) {
  lastCampaign = data;
  const overallEl = $('campaign-overall');
  const gridEl    = $('campaign-grid');
  gridEl.innerHTML = '';

  renderCreatives(data);

  if (data.overall_note) {
    overallEl.innerHTML = `
      <div class="overall-strategy-card">
        <div class="overall-strategy-label">🚀 Campaign Strategy</div>
        <div class="overall-strategy-text">${data.overall_note}</div>
      </div>`;
    overallEl.classList.remove('hidden');
  } else {
    overallEl.classList.add('hidden');
  }

  const posts = data.posts || {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    const post = posts[pid];
    if (!post) return;

    const conn = state.connectedAccounts[pid];
    const canPublish = conn && !conn.blocked;

    const card = document.createElement('div');
    card.className = 'campaign-card';
    card.innerHTML = `
      <div class="campaign-head">
        <span class="campaign-platform">${p.icon} ${p.name}</span>
        ${post.text_alt ? '<button class="copy-btn campaign-lang-btn">عربي</button>' : ''}
      </div>
      <div class="campaign-post-text"></div>
      <div class="campaign-hashtags">${(post.hashtags || []).map(t => `<span class="hashtag-pill">${t}</span>`).join('')}</div>
      <div class="campaign-meta">🕒 ${post.best_time || '—'}</div>
      ${post.persona_note ? `<div class="campaign-meta">🎯 ${post.persona_note}</div>` : ''}
      <div class="campaign-actions">
        <button class="copy-btn campaign-copy-btn">Copy</button>
        ${canPublish
          ? `<button class="btn-publish campaign-publish-btn">Publish</button>`
          : `<span class="campaign-connect-note">Connect ${p.name} to publish</span>`}
      </div>
    `;

    const textEl = card.querySelector('.campaign-post-text');
    let showAlt = false;
    const renderText = () => {
      const t = (showAlt && post.text_alt) ? post.text_alt : post.text;
      textEl.textContent = t || '';
      applyDir(textEl, t);
      const langBtn = card.querySelector('.campaign-lang-btn');
      if (langBtn) {
        const next = showAlt ? post.text : post.text_alt;
        langBtn.textContent = isArabic(next) ? 'عربي' : 'EN';
      }
    };
    renderText();

    card.querySelector('.campaign-lang-btn')?.addEventListener('click', () => { showAlt = !showAlt; renderText(); });
    card.querySelector('.campaign-copy-btn').addEventListener('click', e => {
      navigator.clipboard.writeText(textEl.textContent).then(() => {
        const b = e.target; b.textContent = 'Copied!';
        b.style.background = 'var(--green)'; b.style.color = '#fff';
        setTimeout(() => { b.textContent = 'Copy'; b.style.background = ''; b.style.color = ''; }, 1500);
      });
    });
    const pubBtn = card.querySelector('.campaign-publish-btn');
    if (pubBtn) pubBtn.addEventListener('click', () => publishText(pid, textEl.textContent, [pubBtn]));

    gridEl.appendChild(card);
  });
}

function generateMockCampaign(goalText, persona) {
  const bestTimes = {
    instagram: 'Fri 7pm GST', tiktok: 'Fri 8pm GST', twitter: 'Wed 9am GST',
    youtube: 'Sat 3pm GST', linkedin: 'Tue 8am GST', facebook: 'Thu 7pm GST',
  };
  const posts = {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    posts[pid] = {
      text: `🚀 [Mock ${p.name}] ${goalText} — connect the backend to generate a real ${p.name}-native post for the "${persona}" audience.`,
      text_alt: `🚀 [وضع تجريبي · ${p.name}] ${goalText} — شغّل الخادم لإنشاء منشور حقيقي مخصص لمنصة ${p.name}.`,
      hashtags: ['#StarsOfScience', '#Innovation', '#MENA'],
      best_time: bestTimes[pid] || 'Wed 6pm GST',
      persona_note: `Tailored for the ${persona} audience.`,
      rationale: `[Mock] ${p.name}-specific framing.`,
    };
  });
  const shortGoal = goalText.split(/\s+/).slice(0, 3).join(' ');
  return {
    campaign_goal: goalText,
    posts,
    creatives: {
      social: {
        headline: shortGoal || 'Stars of Science',
        subheadline: 'Where Arab innovation takes the stage',
        cta: 'Apply Now',
        background_prompt: 'vibrant futuristic science lab, teal and lime energy, no text',
        theme: { text: '#FFFFFF', accent: '#B8D930' },
      },
      linkedin: {
        headline: shortGoal || 'Stars of Science',
        subheadline: 'Backing the region’s next generation of innovators',
        cta: 'Learn More',
        background_prompt: 'clean professional innovation backdrop, deep teal, minimal, no text',
        theme: { text: '#FFFFFF', accent: '#B8D930' },
      },
    },
    overall_note: `[Mock] A coordinated 6-platform push for "${goalText}" — lead with the hook on TikTok/Instagram, drive applications via the link on X/LinkedIn, and sustain reach on YouTube/Facebook.`,
  };
}

// =============================
// CAMPAIGN CREATIVES — DESIGN MODEL + FABRIC EDITOR
// =============================

// Which generated image each platform uses (Facebook grouped with social).
const CREATIVE_GROUP = {
  instagram: 'social', tiktok: 'social', twitter: 'social', youtube: 'social',
  facebook: 'social', linkedin: 'linkedin',
};

// Canvas sizes + layer layouts per group (positions are in design-space pixels).
const DESIGN_TEMPLATES = {
  social: {
    width: 1080, height: 1080,
    gradient: ['#0D7377', '#B8D930'],
    layers: (c, theme) => ([
      { id: 'headline',    text: c.headline || 'Your Headline',      x: 80, y: 140, fontSize: 104, fontFamily: 'Montserrat', fontWeight: '800', fill: theme.text,   width: 920 },
      { id: 'subheadline', text: c.subheadline || '',                x: 80, y: 380, fontSize: 48,  fontFamily: 'Poppins',    fontWeight: '600', fill: theme.text,   width: 900 },
      { id: 'cta',         text: c.cta || 'Learn More',              x: 80, y: 900, fontSize: 56,  fontFamily: 'Montserrat', fontWeight: '700', fill: theme.accent, width: 700 },
    ]),
  },
  linkedin: {
    width: 1200, height: 627,
    gradient: ['#0A1E24', '#0D7377'],
    layers: (c, theme) => ([
      { id: 'headline',    text: c.headline || 'Your Headline',      x: 64, y: 110, fontSize: 80, fontFamily: 'Poppins', fontWeight: '700', fill: theme.text,   width: 800 },
      { id: 'subheadline', text: c.subheadline || '',                x: 64, y: 250, fontSize: 38, fontFamily: 'Inter',   fontWeight: '500', fill: theme.text,   width: 820 },
      { id: 'cta',         text: c.cta || 'Learn More',              x: 64, y: 470, fontSize: 42, fontFamily: 'Poppins', fontWeight: '700', fill: theme.accent, width: 560 },
    ]),
  },
};

const PREVIEW_W = 320;       // px width of the small card preview
const EDITOR_MAX_W = 560;    // max on-screen canvas width in the editor

let campaignDesigns = {};    // { social: design, linkedin: design }
const editorState = { group: null, design: null, canvas: null, scale: 1, displayW: 0, displayH: 0, activeId: null };

// ---- font loading (canvas needs glyphs ready before measuring) ----
let _fontsReady = null;
function ensureFonts() {
  if (_fontsReady) return _fontsReady;
  const specs = [
    '800 96px Montserrat', '700 56px Montserrat', '700 80px Poppins', '600 48px Poppins',
    '700 64px Oswald', '700 64px "Playfair Display"', '700 64px "Space Grotesk"', '500 48px Inter',
  ];
  _fontsReady = Promise.all(specs.map(s => document.fonts.load(s).catch(() => {})))
    .then(() => document.fonts.ready);
  return _fontsReady;
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function fillGradient(ctx, w, h, colors) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function gradientToDataUrl(w, h, colors) {
  const c = document.createElement('canvas');
  const ratio = h / w;
  c.width = 256; c.height = Math.round(256 * ratio);
  fillGradient(c.getContext('2d'), c.width, c.height, colors);
  return c.toDataURL('image/png');
}

function drawWrapped(ctx, text, x, y, maxW, lineH) {
  const words = String(text || '').split(/\s+/);
  let line = '', yy = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = word; yy += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

// Paint a design onto a 2D canvas at a target width (used for previews + standalone export).
async function paintDesign(canvasEl, design, targetWidth) {
  await ensureFonts();
  const scale = targetWidth / design.width;
  const w = Math.round(targetWidth), h = Math.round(design.height * scale);
  canvasEl.width = w; canvasEl.height = h;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const grad = design.background?.gradient || DESIGN_TEMPLATES[design.group].gradient;
  if (design.background?.dataUrl) {
    try {
      const img = await loadImage(design.background.dataUrl);
      const s = Math.max(w / img.width, h / img.height);
      const iw = img.width * s, ih = img.height * s;
      ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } catch { fillGradient(ctx, w, h, grad); }
  } else {
    fillGradient(ctx, w, h, grad);
  }

  design.layers.forEach(layer => {
    ctx.save();
    ctx.fillStyle = layer.fill;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8 * scale; ctx.shadowOffsetY = 2 * scale;
    const fs = layer.fontSize * scale;
    ctx.font = `${layer.fontWeight || '700'} ${fs}px "${layer.fontFamily}"`;
    drawWrapped(ctx, layer.text, layer.x * scale, layer.y * scale, layer.width * scale, fs * 1.15);
    ctx.restore();
  });
}

function buildDesigns(creatives) {
  campaignDesigns = {};
  ['social', 'linkedin'].forEach(group => {
    const c = (creatives && creatives[group]) || {};
    const theme = c.theme && c.theme.text ? c.theme : { text: '#FFFFFF', accent: '#B8D930' };
    const tpl = DESIGN_TEMPLATES[group];
    campaignDesigns[group] = {
      group, width: tpl.width, height: tpl.height,
      background_prompt: c.background_prompt || '',
      background: { source: 'gradient', dataUrl: gradientToDataUrl(tpl.width, tpl.height, tpl.gradient), gradient: tpl.gradient },
      layers: tpl.layers(c, theme),
    };
  });
}

function previewCanvas(group) { return document.querySelector(`.creative-preview[data-group="${group}"]`); }
function previewLoading(group) { return document.querySelector(`.creative-loading[data-group="${group}"]`); }

async function renderPreview(group) {
  const el = previewCanvas(group);
  if (el && campaignDesigns[group]) await paintDesign(el, campaignDesigns[group], PREVIEW_W);
}

// Apply a resolved background (AI / Pexels / upload) to a creative — updates the
// design model, the card preview, and the live editor canvas if it's open on that group.
function applyBackgroundToGroup(group, dataUrl, source, gradient) {
  const design = campaignDesigns[group];
  if (!design || !dataUrl) return;
  design.background = { source, dataUrl, gradient: gradient || design.background.gradient };
  renderPreview(group);
  if (editorState.group === group && !$('design-editor').classList.contains('hidden')) {
    setEditorBackground(dataUrl);
  }
}

// Generate an AI background on demand (card "AI" button + editor "Generate AI").
async function generateAIForGroup(group) {
  const design = campaignDesigns[group];
  if (!design) return;
  if (!state.backendLive) { showToast('Connect the backend to generate an AI image', 'warn'); return; }
  const loadingEl = previewLoading(group);
  loadingEl?.classList.remove('hidden');
  try {
    const res = await apiFetch('/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: design.background_prompt || '', group }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.image) { applyBackgroundToGroup(group, data.image, 'openai'); showToast('AI background applied'); }
      else if (Array.isArray(data.gradient)) { applyBackgroundToGroup(group, gradientToDataUrl(design.width, design.height, data.gradient), 'fallback', data.gradient); showToast('Image API unavailable — used gradient', 'warn'); }
    } else { showToast('Image generation failed', 'error'); }
  } catch { showToast('Image generation failed', 'error'); }
  loadingEl?.classList.add('hidden');
}

async function renderCreatives(data) {
  const section = $('creatives-section');
  if (!section) return;
  if (!data.creatives) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  buildDesigns(data.creatives);
  ['social', 'linkedin'].forEach(g => previewLoading(g)?.classList.add('hidden'));
  await ensureFonts();
  await Promise.all(['social', 'linkedin'].map(renderPreview));
  // No auto image generation — the user explicitly picks AI or a Pexels photo per creative.
}

// ---- Fabric editor ----
function getEditorCanvas() {
  if (!editorState.canvas) {
    editorState.canvas = new fabric.Canvas('design-canvas', { preserveObjectStacking: true });
    const canvas = editorState.canvas;
    canvas.on('selection:created', e => setActiveLayer(e.selected?.[0]));
    canvas.on('selection:updated', e => setActiveLayer(e.selected?.[0]));
    canvas.on('selection:cleared', () => setActiveLayer(null));
    canvas.on('object:modified', e => syncFromObject(e.target));
    canvas.on('object:moving', e => syncFromObject(e.target));
    canvas.on('text:changed', e => { syncFromObject(e.target); renderLayerList(); });
  }
  return editorState.canvas;
}

function layerForObject(obj) {
  return obj && editorState.design ? editorState.design.layers.find(l => l.id === obj.layerId) : null;
}

function syncFromObject(obj) {
  const layer = layerForObject(obj);
  if (!layer) return;
  const s = editorState.scale;
  layer.x = obj.left / s;
  layer.y = obj.top / s;
  layer.width = obj.getScaledWidth() / s;
  layer.fontSize = (obj.fontSize * (obj.scaleY || 1)) / s;
  layer.fontFamily = obj.fontFamily;
  layer.fill = obj.fill;
  layer.text = obj.text;
  // Normalize any scaling back into fontSize/width so future math stays clean.
  if ((obj.scaleX && obj.scaleX !== 1) || (obj.scaleY && obj.scaleY !== 1)) {
    obj.set({ width: obj.getScaledWidth(), fontSize: obj.fontSize * obj.scaleY, scaleX: 1, scaleY: 1 });
  }
}

async function openDesignEditor(group) {
  const design = campaignDesigns[group];
  if (!design) return;
  editorState.group = group;
  editorState.design = design;
  editorState.activeId = null;

  const displayW = Math.min(design.width, EDITOR_MAX_W);
  const scale = displayW / design.width;
  const displayH = Math.round(design.height * scale);
  editorState.scale = scale; editorState.displayW = displayW; editorState.displayH = displayH;

  $('design-editor-title').textContent = group === 'linkedin' ? 'Edit LinkedIn Creative' : 'Edit Social Creative';
  $('design-editor').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const canvas = getEditorCanvas();
  canvas.clear();
  canvas.setWidth(displayW);
  canvas.setHeight(displayH);

  await ensureFonts();

  // Background (cover-fit)
  const applyBg = () => new Promise(resolve => {
    fabric.Image.fromURL(design.background.dataUrl, img => {
      const s = Math.max(displayW / img.width, displayH / img.height);
      img.set({ originX: 'left', originY: 'top', left: (displayW - img.width * s) / 2, top: (displayH - img.height * s) / 2, scaleX: s, scaleY: s });
      canvas.setBackgroundImage(img, () => { canvas.requestRenderAll(); resolve(); });
    });
  });
  await applyBg();

  // Text layers
  design.layers.forEach(layer => {
    const tb = new fabric.Textbox(layer.text, {
      left: layer.x * scale, top: layer.y * scale,
      width: layer.width * scale, fontSize: layer.fontSize * scale,
      fontFamily: layer.fontFamily, fontWeight: layer.fontWeight || '700',
      fill: layer.fill, editable: true,
      shadow: 'rgba(0,0,0,0.45) 0px 2px 8px',
      lockScalingFlip: true,
    });
    tb.layerId = layer.id;
    canvas.add(tb);
  });
  canvas.requestRenderAll();
  ensureFonts().then(() => canvas.requestRenderAll());

  renderLayerList();
  setActiveLayer(null);
}

function renderLayerList() {
  const wrap = $('dc-layers');
  if (!wrap || !editorState.design) return;
  wrap.innerHTML = '';
  editorState.design.layers.forEach(layer => {
    const btn = document.createElement('button');
    btn.className = `dc-layer-btn${layer.id === editorState.activeId ? ' active' : ''}`;
    btn.textContent = `${layer.id}: ${layer.text || '(empty)'}`;
    btn.addEventListener('click', () => {
      const obj = editorState.canvas.getObjects().find(o => o.layerId === layer.id);
      if (obj) { editorState.canvas.setActiveObject(obj); editorState.canvas.requestRenderAll(); setActiveLayer(obj); }
    });
    wrap.appendChild(btn);
  });
}

function setActiveLayer(obj) {
  const layer = layerForObject(obj);
  editorState.activeId = layer ? layer.id : null;

  const enabled = !!layer;
  ['dc-text', 'dc-font', 'dc-color', 'dc-size', 'dc-regen'].forEach(id => { const el = $(id); if (el) el.disabled = !enabled; });
  $('dc-regen-options')?.classList.add('hidden');

  if (layer) {
    $('dc-text').value = layer.text;
    $('dc-font').value = layer.fontFamily;
    $('dc-color').value = toHex(layer.fill);
    $('dc-size').value = Math.round(layer.fontSize);
    $('dc-size-val').textContent = Math.round(layer.fontSize);
  } else {
    $('dc-text').value = '';
  }
  renderLayerList();
}

function toHex(c) {
  if (!c) return '#FFFFFF';
  if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c;
  const m = c.match(/\d+/g);
  if (!m) return '#FFFFFF';
  return '#' + m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
}

function activeObject() { return editorState.canvas?.getActiveObject(); }

function initDesignEditor() {
  // Card buttons (present in DOM from load)
  document.querySelectorAll('.creative-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => openDesignEditor(btn.dataset.group)));
  document.querySelectorAll('.creative-png-btn').forEach(btn =>
    btn.addEventListener('click', () => exportGroupPNG(btn.dataset.group)));

  const close = () => { $('design-editor').classList.add('hidden'); document.body.style.overflow = ''; if (editorState.group) renderPreview(editorState.group); };
  $('design-editor-close')?.addEventListener('click', close);
  $('design-editor-backdrop')?.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('design-editor').classList.contains('hidden')) {
      // don't close while editing text inside the canvas
      if (!(activeObject() && activeObject().isEditing)) close();
    }
  });

  $('dc-text')?.addEventListener('input', e => {
    const obj = activeObject(); if (!obj) return;
    obj.set('text', e.target.value); editorState.canvas.requestRenderAll(); syncFromObject(obj); renderLayerList();
  });
  $('dc-font')?.addEventListener('change', e => {
    const obj = activeObject(); if (!obj) return;
    obj.set('fontFamily', e.target.value);
    ensureFonts().then(() => editorState.canvas.requestRenderAll());
    editorState.canvas.requestRenderAll(); syncFromObject(obj);
  });
  $('dc-color')?.addEventListener('input', e => {
    const obj = activeObject(); if (!obj) return;
    obj.set('fill', e.target.value); editorState.canvas.requestRenderAll(); syncFromObject(obj);
  });
  $('dc-size')?.addEventListener('input', e => {
    const obj = activeObject(); if (!obj) return;
    const v = Number(e.target.value);
    $('dc-size-val').textContent = v;
    obj.set({ fontSize: v * editorState.scale, scaleX: 1, scaleY: 1 });
    editorState.canvas.requestRenderAll(); syncFromObject(obj);
  });

  $('dc-regen')?.addEventListener('click', onRegenerateLayer);
  $('dc-bg-regen')?.addEventListener('click', onRegenerateBackground);
  $('dc-bg-file')?.addEventListener('change', onReplaceBackground);
  $('dc-export')?.addEventListener('click', () => exportEditorPNG());
}

async function onRegenerateLayer() {
  if (!editorState.activeId || !lastCampaign) return;
  const btn = $('dc-regen');
  const optsEl = $('dc-regen-options');
  btn.disabled = true; btn.textContent = '✨ Thinking…';
  let options = [];
  try {
    if (state.backendLive) {
      const res = await apiFetch('/regenerate-layer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_goal: lastCampaign.campaign_goal || '',
          group: editorState.group, layer: editorState.activeId,
          persona: $('campaign-persona')?.value || 'general',
        }),
      });
      if (res.ok) options = (await res.json()).options || [];
    }
  } catch { /* fall through to mock */ }
  if (!options.length) {
    options = ['Bank Smarter', 'Built for You', 'Your Future Starts Here', 'Join the Stars', 'Apply Today'];
  }
  optsEl.innerHTML = '';
  options.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'dc-regen-option'; b.textContent = opt;
    b.addEventListener('click', () => {
      const obj = activeObject(); if (!obj) return;
      obj.set('text', opt); editorState.canvas.requestRenderAll(); syncFromObject(obj);
      $('dc-text').value = opt; renderLayerList(); optsEl.classList.add('hidden');
    });
    optsEl.appendChild(b);
  });
  optsEl.classList.remove('hidden');
  btn.disabled = false; btn.textContent = '✨ Regenerate options';
}

async function onRegenerateBackground() {
  if (!editorState.group) return;
  const btn = $('dc-bg-regen');
  btn.disabled = true; btn.textContent = '🤖 Generating…';
  await generateAIForGroup(editorState.group);
  btn.disabled = false; btn.textContent = '🤖 Generate AI';
}

function onReplaceBackground(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    editorState.design.background = { source: 'upload', dataUrl: reader.result, gradient: editorState.design.background.gradient };
    await setEditorBackground(reader.result);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function setEditorBackground(dataUrl) {
  return new Promise(resolve => {
    const canvas = editorState.canvas;
    const { displayW, displayH } = editorState;
    fabric.Image.fromURL(dataUrl, img => {
      const s = Math.max(displayW / img.width, displayH / img.height);
      img.set({ originX: 'left', originY: 'top', left: (displayW - img.width * s) / 2, top: (displayH - img.height * s) / 2, scaleX: s, scaleY: s });
      canvas.setBackgroundImage(img, () => { canvas.requestRenderAll(); resolve(); });
    });
  });
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

function exportEditorPNG() {
  const canvas = editorState.canvas;
  if (!canvas) return;
  canvas.discardActiveObject(); canvas.requestRenderAll();
  const multiplier = editorState.design.width / editorState.displayW;
  const dataUrl = canvas.toDataURL({ format: 'png', multiplier });
  downloadDataUrl(dataUrl, `${editorState.group}-creative.png`);
  showToast('PNG downloaded');
}

// Standalone export straight from the card (renders the design at full resolution).
async function exportGroupPNG(group) {
  const design = campaignDesigns[group];
  if (!design) return;
  const off = document.createElement('canvas');
  await paintDesign(off, design, design.width);
  downloadDataUrl(off.toDataURL('image/png'), `${group}-creative.png`);
  showToast('PNG downloaded');
}

// =============================
// PEXELS PHOTO PICKER
// =============================

let pexelsTarget = null;   // which creative group the picked photo applies to

function closePexels() {
  $('pexels-modal')?.classList.add('hidden');
  document.body.style.overflow = '';
}

function initPexels() {
  // Creative card source buttons
  document.querySelectorAll('.creative-ai-btn').forEach(b =>
    b.addEventListener('click', () => generateAIForGroup(b.dataset.group)));
  document.querySelectorAll('.creative-pexels-btn').forEach(b =>
    b.addEventListener('click', () => openPexelsPicker(b.dataset.group)));

  // Editor background buttons
  $('dc-bg-pexels')?.addEventListener('click', () => { if (editorState.group) openPexelsPicker(editorState.group); });

  // Modal controls
  $('pexels-close')?.addEventListener('click', closePexels);
  $('pexels-backdrop')?.addEventListener('click', closePexels);
  $('pexels-search-btn')?.addEventListener('click', () => searchPexels());
  $('pexels-query')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchPexels(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('pexels-modal').classList.contains('hidden')) closePexels();
  });
}

// Seed the search box from the creative's background prompt (strip the "no text" tail).
function pexelsQueryFromDesign(group) {
  const design = campaignDesigns[group];
  const prompt = (design?.background_prompt || '').replace(/[,.]?\s*no text.*$/i, '').trim();
  return prompt.split(/\s+/).slice(0, 6).join(' ') || 'science innovation';
}

function openPexelsPicker(group) {
  if (!campaignDesigns[group]) return;
  pexelsTarget = group;
  $('pexels-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('pexels-query').value = pexelsQueryFromDesign(group);
  searchPexels();
}

async function searchPexels() {
  const grid = $('pexels-grid');
  const loading = $('pexels-loading');
  const empty = $('pexels-empty');
  const query = $('pexels-query').value.trim();
  grid.innerHTML = '';
  empty.classList.add('hidden');

  if (!state.backendLive) {
    empty.textContent = 'Connect the backend to search Pexels.';
    empty.classList.remove('hidden');
    return;
  }

  loading.classList.remove('hidden');
  let photos = [];
  try {
    const res = await apiFetch('/pexels/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, group: pexelsTarget }),
    });
    if (res.ok) photos = (await res.json()).photos || [];
  } catch { /* handled below */ }
  loading.classList.add('hidden');

  if (!photos.length) {
    empty.textContent = 'No photos found — try a different search.';
    empty.classList.remove('hidden');
    return;
  }

  photos.forEach(ph => {
    const div = document.createElement('div');
    div.className = 'pexels-thumb';
    if (ph.photographer) div.title = `Photo by ${ph.photographer}`;
    div.innerHTML = `<img src="${ph.thumb}" alt="${escapeHtml(ph.alt || '')}" loading="lazy">` +
      (ph.photographer ? `<span class="pexels-credit-tag">📷 ${escapeHtml(ph.photographer)}</span>` : '');
    div.addEventListener('click', () => applyPexelsPhoto(ph.full, div));
    grid.appendChild(div);
  });
}

async function applyPexelsPhoto(url, thumbEl) {
  if (!pexelsTarget) return;
  if (thumbEl) thumbEl.style.opacity = '0.5';
  try {
    const res = await apiFetch('/pexels/image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.image) {
        applyBackgroundToGroup(pexelsTarget, data.image, 'pexels');
        closePexels();
        showToast('Pexels photo applied');
        return;
      }
    }
    showToast('Could not load that photo', 'error');
  } catch { showToast('Could not load that photo', 'error'); }
  if (thumbEl) thumbEl.style.opacity = '';
}

// ---- BOOT ----
init();
