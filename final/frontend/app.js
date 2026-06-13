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
  const growthEl  = $('insights-growth');
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

  // ---- Real Growth vs. Noise ----
  if (growthEl && data.metrics) {
    const rows = Object.entries(PLATFORMS).map(([pid, p]) => {
      const m = data.metrics[pid];
      if (!m) return '';
      const verdict = data.platforms?.[pid]?.growth_verdict || '';
      if (!m.has_data) {
        return `
          <div class="growth-row no-data">
            <span class="growth-platform">${p.icon} ${p.name}</span>
            <span class="growth-verdict">No data available for this account</span>
          </div>
        `;
      }
      return `
        <div class="growth-row">
          <span class="growth-platform">${p.icon} ${p.name}</span>
          <span class="growth-reach">${fmtNum(m.avg_likes)} <small>avg likes</small></span>
          <span class="engagement-badge ${m.engagement_quality}">${m.engagement_quality} engagement</span>
          <span class="growth-verdict">${verdict}</span>
        </div>
      `;
    }).join('');

    growthEl.innerHTML = `
      <div class="growth-card">
        <div class="growth-title">📊 Real Growth vs. Noise</div>
        ${data.real_growth_summary ? `<div class="growth-summary">${data.real_growth_summary}</div>` : ''}
        <div class="growth-rows">${rows}</div>
      </div>
    `;
    growthEl.classList.remove('hidden');
  } else if (growthEl) {
    growthEl.classList.add('hidden');
    growthEl.innerHTML = '';
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
  const metrics = {};
  Object.entries(PLATFORMS).forEach(([pid, p]) => {
    const avgLikes = rand(200, 2500);
    const avgComments = rand(5, 80);
    const commentRate = avgLikes > 0 ? Math.round((avgComments / avgLikes) * 10000) / 100 : 0;
    const quality = commentRate >= 5 ? 'high' : commentRate >= 1 ? 'medium' : 'low';
    metrics[pid] = {
      avg_likes: avgLikes,
      avg_comments: avgComments,
      comment_rate: commentRate,
      engagement_quality: quality,
      has_data: true,
    };
    platforms[pid] = {
      headline: `[Mock] ${p.name} rewards posts with strong visual hooks and consistent posting cadence`,
      patterns: [
        '[Mock] Posts with questions get 2-3x more comments',
        '[Mock] First line decides reach — emoji-led performs better',
        '[Mock] Science curiosity hooks outperform announcement posts',
      ],
      recommendation: `[Mock] Open every ${p.name} post with a surprising stat or question.`,
      growth_verdict: quality === 'low'
        ? `[Mock] Big reach but shallow — only ${commentRate} comments per 100 likes. Vanity numbers.`
        : `[Mock] This audience talks back — ${commentRate} comments per 100 likes is a real community signal.`,
    };
  });
  return {
    platforms,
    metrics,
    overall_strategy: '[Mock] Across all platforms, curiosity-driven hooks and clear CTAs drive the most consistent engagement. Post consistently on Tue/Wed in the Gulf evening window (6–9pm GST).',
    real_growth_summary: '[Mock] The real engaged community lives where the comment rate is highest — chase conversations, not just impressions. Big like counts with silent comment sections are vanity reach.',
  };
}

// =============================
// VIDEO ANALYZER
// =============================

let selectedVideoFile = null;
let lastVideoAnalysisResult = null;
let latestEditRenderResult = null;
let editStudioState = buildEditStudioState();
let musicMatchState = buildMusicMatchState();

function buildEditStudioState() {
  return {
    enabled: false,
    busy: false,
    statusMessage: '',
    videoId: '',
    currentVersion: 'edited_v1.mp4',
    previewUrl: '',
    downloadUrl: '',
    versionHistory: ['Original Video'],
    currentEditHistory: [],
    appliedEdits: [],
    messages: [
      {
        role: 'assistant',
        text: 'Apply Auto Edit first, then I can help turn chat instructions into new rendered versions.',
      },
    ],
  };
}

function buildMusicMatchState() {
  return {
    busy: false,
    searched: false,
    selectedMood: '',
    detectedMood: '',
    confidence: null,
    moodReason: '',
    tags: '',
    tracks: [],
    warnings: [],
    selectedTrackId: '',
    selectedTrackData: null,
    previewTrackId: '',
    previewVolume: 1.0,
    previewPlaying: false,
    jamendoConfigured: false,
    statusMessage: '',
    // Audio analysis
    audioDetected: false,
    speechDetected: false,
    musicDetected: null,
    audioDuration: 0,
    audioWarnings: [],
    // Music mixing
    audioMode: 'mix_background_music',
    musicVolume: 0.18,
    originalVolume: 1.0,
    fadeInSeconds: 1.0,
    fadeOutSeconds: 1.5,
    addingMusic: false,
    addMusicResult: null,
  };
}

function resetEditStudioState() {
  editStudioState = buildEditStudioState();
  latestEditRenderResult = null;
  musicMatchState = buildMusicMatchState();
}

async function onAnalyzeVideoLegacy() {
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

  if (!state.backendLive) {
    loadingEl.classList.add('hidden');
    renderVideoUnavailableState(
      'Legacy video analyzer is offline.',
      'The frontend will no longer render mock frame-analysis cards when the backend is unavailable.'
    );
    resultsEl.classList.remove('hidden');
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Video';
    return;
  }

  try {
    activateStep(stepFrames);
    const formData = new FormData();
    formData.append('file', selectedVideoFile);
    formData.append('topic', $('video-topic-input')?.value || 'science innovation');
    const res = await apiFetch('/analyze-video', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`API ${res.status}`);
    completeStep(stepFrames);
    activateStep(stepAI);
    const data = await res.json();
    completeStep(stepAI);

    loadingEl.classList.add('hidden');
    renderVideoResultsLegacy(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    loadingEl.classList.add('hidden');
    renderVideoUnavailableState(
      'Legacy video analyzer request failed.',
      error?.message || 'Unknown error'
    );
    resultsEl.classList.remove('hidden');
    showToast('Legacy video analyzer failed.', 'warn');
  }

  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = '<span class="btn-icon">🔍</span> Analyze Video';
}

function renderVideoResultsLegacy(data) {
  const summaryEl  = $('video-summary-card');
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

function generateMockVideoResultsLegacy() {
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
// ACTIVE AI EDIT SUGGESTIONS UI
// =============================

function initVideoUpload() {
  const area = $('video-upload-area');
  const fileInput = $('video-file-input');
  const prompt = $('upload-prompt');
  const selected = $('upload-selected');
  const fileLabel = $('upload-filename');
  const analyzeBtn = $('btn-analyze-video');
  const clearBtn = $('btn-clear-video');
  if (!area) return;

  area.addEventListener('click', e => {
    if (clearBtn && (e.target === clearBtn || clearBtn.contains(e.target))) return;
    fileInput.click();
  });

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
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
    lastVideoAnalysisResult = null;
    resetEditStudioState();
    fileInput.value = '';
    prompt.classList.remove('hidden');
    selected.classList.add('hidden');
    analyzeBtn.disabled = true;
    $('video-results')?.classList.add('hidden');
  });

  function setVideoFile(file) {
    selectedVideoFile = file;
    lastVideoAnalysisResult = null;
    resetEditStudioState();
    if (fileLabel) fileLabel.textContent = file.name;
    prompt.classList.add('hidden');
    selected.classList.remove('hidden');
    analyzeBtn.disabled = false;
  }

  analyzeBtn?.addEventListener('click', onAnalyzeVideo);
}

function formatVideoTimestamp(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function onAnalyzeVideo() {
  if (!selectedVideoFile) return;

  const analyzeBtn = $('btn-analyze-video');
  const loadingEl = $('video-loading');
  const resultsEl = $('video-results');
  const stepFrames = $('step-video-frames');
  const stepAI = $('step-video-ai');
  const targetPlatform = $('video-platform-select')?.value || 'instagram';
  const goal = ($('video-goal-input')?.value || '').trim();

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Generating AI Edit Suggestions...';
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
  resetEditStudioState();

  [stepFrames, stepAI].forEach(el => {
    if (!el) return;
    el.classList.remove('active', 'done');
    el.classList.add('waiting');
    el.querySelector('.step-check')?.classList.add('hidden');
    const spinner = el.querySelector('.step-spinner');
    if (spinner) spinner.style.display = '';
  });

  if (!state.backendLive) {
    loadingEl.classList.add('hidden');
    renderVideoUnavailableState(
      'AI Edit Suggestions backend is not live.',
      'Start the FastAPI server on http://localhost:8000 so the analyzer can return real metadata, frames, transcript, and edit suggestions.'
    );
    resultsEl.classList.remove('hidden');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Generate AI Edit Suggestions';
    showToast('Backend is offline. The video analyzer will not use mock results anymore.', 'warn');
    return;
  }

  try {
    activateStep(stepFrames);
    const formData = new FormData();
    formData.append('file', selectedVideoFile);
    formData.append('target_platform', targetPlatform);
    if (goal) formData.append('goal', goal);
    const res = await apiFetch('/analyze-video', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`API ${res.status}`);
    completeStep(stepFrames);
    activateStep(stepAI);
    const data = await res.json();
    lastVideoAnalysisResult = data;
    completeStep(stepAI);

    loadingEl.classList.add('hidden');
    renderVideoResults(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    loadingEl.classList.add('hidden');
    lastVideoAnalysisResult = null;
    renderVideoUnavailableState(
      'AI Edit Suggestions request failed.',
      error?.message || 'Unknown error'
    );
    resultsEl.classList.remove('hidden');
    showToast('AI Edit Suggestions failed. Check the backend server and logs.', 'warn');
  }

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = 'Generate AI Edit Suggestions';
}

function renderVideoUnavailableState(title, detail = '') {
  const summaryEl = $('video-summary-card');
  const suggestionsEl = $('video-edit-suggestions');
  if (!summaryEl || !suggestionsEl) return;

  const safeTitle = escapeHtml(title || 'Video analysis is unavailable.');
  const safeDetail = escapeHtml(detail || 'No additional detail was returned.');
  summaryEl.innerHTML = `
    <div class="video-summary-card ai-edit-shell">
      <div class="video-analysis-header">
        <div>
          <div class="video-kicker">AI Edit Suggestions</div>
          <h3 class="video-analysis-title">Live analysis unavailable</h3>
          <div class="video-source-badge">No mock fallback</div>
        </div>
      </div>
      <div class="video-analysis-warning">
        <strong>${safeTitle}</strong><br>${safeDetail}
      </div>
    </div>
  `;

  suggestionsEl.innerHTML = `
    <div class="video-analysis-card">
      <div class="video-card-label">What To Do Next</div>
      <div class="video-card-copy">
        Bring the backend online, then run the upload again. This tab now avoids fake mock analyzer output so we only show real results.
      </div>
    </div>
  `;
}

function renderVideoResults(data) {
  const summaryEl = $('video-summary-card');
  const suggestionsEl = $('video-edit-suggestions');
  if (!summaryEl || !suggestionsEl) return;

  const metadata = data.metadata || {};
  const transcript = data.transcript || { segments: [] };
  const analysis = data.analysis || {};
  const transcriptPreview = (transcript.segments || []).slice(0, 3);
  const transcriptError = transcript.error || '';
  const scoreBreakdown = analysis.scores || {};
  const score = analysis.overall_score || 0;
  const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--orange)' : 'var(--red)';
  const sourceLabel = data.source === 'openai' ? 'Live OpenAI analysis' : 'Demo fallback';
  const confidenceLabel = (analysis.content_analysis_confidence || 'low').toUpperCase();
  const warningText = data.warning || (Array.isArray(data.warnings) ? data.warnings.join(' ') : '');
  const durationLabel = metadata.duration_seconds != null ? `${metadata.duration_seconds}s` : 'Unavailable';
  const resolutionLabel = metadata.width && metadata.height ? `${metadata.width} x ${metadata.height}` : 'Unavailable';
  const aspectRatioLabel = metadata.aspect_ratio || 'Unavailable';
  const orientationLabel = metadata.orientation || 'Unavailable';
  const fpsLabel = metadata.fps != null ? metadata.fps : 'Unavailable';
  const audioLabel = metadata.has_audio === true ? 'Available' : metadata.has_audio === false ? 'Not detected' : 'Unknown';

  summaryEl.innerHTML = `
    <div class="video-summary-card ai-edit-shell">
      <div class="video-analysis-header">
        <div>
          <div class="video-kicker">AI Edit Suggestions</div>
          <h3 class="video-analysis-title">Video analysis for ${data.target_platform || 'instagram'}</h3>
          <div class="video-source-badge">${sourceLabel}</div>
          <div class="video-confidence-badge confidence-${(analysis.content_analysis_confidence || 'low')}">Content confidence: ${confidenceLabel}</div>
        </div>
        <div class="video-score-badge" style="border-color:${scoreColor};color:${scoreColor};">
          <span class="video-score-label">Overall Score</span>
          <span class="video-score-value">${score}</span>
        </div>
      </div>

      ${warningText ? `<div class="video-analysis-warning">${warningText}</div>` : ''}

      <div class="video-metadata-grid">
        <div class="video-meta-chip"><span class="video-meta-label">Duration</span><span class="video-meta-value">${durationLabel}</span></div>
        <div class="video-meta-chip"><span class="video-meta-label">Resolution</span><span class="video-meta-value">${resolutionLabel}</span></div>
        <div class="video-meta-chip"><span class="video-meta-label">Aspect Ratio</span><span class="video-meta-value">${aspectRatioLabel}</span></div>
        <div class="video-meta-chip"><span class="video-meta-label">Orientation</span><span class="video-meta-value">${orientationLabel}</span></div>
        <div class="video-meta-chip"><span class="video-meta-label">FPS</span><span class="video-meta-value">${fpsLabel}</span></div>
        <div class="video-meta-chip"><span class="video-meta-label">Audio</span><span class="video-meta-value">${audioLabel}</span></div>
      </div>

      <div class="video-analysis-grid">
        <div class="video-analysis-card">
          <div class="video-card-label">Summary</div>
          <div class="video-card-copy">${analysis.summary || 'No summary available.'}</div>
          <div class="video-card-copy video-card-copy-secondary"><strong>Platform fit:</strong> ${analysis.platform_fit || 'No platform fit notes available.'}</div>
        </div>
        <div class="video-analysis-card">
          <div class="video-card-label">Transcript Preview</div>
          ${transcriptError ? `<div class="video-analysis-warning transcript-warning">${transcriptError}</div>` : ''}
          ${transcriptPreview.length
            ? transcriptPreview.map(segment => `
              <div class="transcript-segment">
                <strong>${formatVideoTimestamp(segment.start)} - ${formatVideoTimestamp(segment.end)}</strong>
                <span>${segment.text || ''}</span>
              </div>
            `).join('')
            : '<div class="video-analysis-empty">No transcript preview available.</div>'}
        </div>
      </div>

      <div class="video-analysis-card">
        <div class="video-card-label">Score Breakdown</div>
        <div class="score-breakdown-grid">
          ${renderScoreChip('Visual Quality', scoreBreakdown.visual_quality)}
          ${renderScoreChip('Platform Fit', scoreBreakdown.platform_fit)}
          ${renderScoreChip('Content Clarity', scoreBreakdown.content_clarity, true)}
          ${renderScoreChip('Engagement Potential', scoreBreakdown.engagement_potential)}
        </div>
      </div>

      <div class="video-analysis-grid">
        <div class="video-analysis-card">
          <div class="video-card-label">Recommended Caption</div>
          <div class="video-card-copy">${analysis.recommended_caption || 'No caption suggestion available.'}</div>
        </div>
        <div class="video-analysis-card">
          <div class="video-card-label">Recommended CTA</div>
          <div class="video-card-copy">${analysis.recommended_cta || 'No CTA suggestion available.'}</div>
        </div>
      </div>

      <div class="video-analysis-card">
        <div class="video-card-label">Recommended Hashtags</div>
        <div class="video-hashtag-row">
          ${(analysis.recommended_hashtags || []).map(tag => `<span class="video-hashtag">${tag}</span>`).join('') || '<span class="video-analysis-empty">No hashtags suggested.</span>'}
        </div>
      </div>

      ${renderAutoEditNote()}
    </div>
  `;

  suggestionsEl.innerHTML = `
    <div class="results-header" style="margin-top:32px;">
      <h2>AI Edit Suggestions</h2>
      <p class="results-sub">Time-stamped edit notes generated from metadata and transcript context</p>
    </div>
    <div class="video-suggestions-grid">
      ${(analysis.edit_suggestions || []).map((suggestion, index) => {
        const typeColors = {
          cut: '#ef4444',
          hook_rewrite: '#0ea5e9',
          text_overlay: '#8b5cf6',
          subtitle: '#f59e0b',
          cta_overlay: '#10b981',
          resize: '#f97316',
          pacing_fix: '#22c55e',
          caption_rewrite: '#06b6d4',
        };
        const typeColor = typeColors[suggestion.type] || 'var(--gray-500)';
        return `
          <div class="edit-suggestion-card" style="border-color:${typeColor}33;">
            <div class="edit-suggestion-top">
              <span class="edit-type-badge" style="background:${typeColor}18;color:${typeColor};">${(suggestion.type || 'cut').replaceAll('_', ' ')}</span>
              <span class="edit-time">${formatVideoTimestamp(suggestion.start)} - ${formatVideoTimestamp(suggestion.end)}</span>
            </div>
            <div class="edit-suggestion-title">Suggestion ${index + 1}</div>
            <div class="edit-suggestion-copy"><strong>Issue:</strong> ${suggestion.issue || 'No issue provided.'}</div>
            <div class="edit-suggestion-copy"><strong>Action:</strong> ${suggestion.action || 'No action provided.'}</div>
            <div class="edit-suggestion-copy"><strong>Reason:</strong> ${suggestion.reason || 'No reason provided.'}</div>
            ${suggestion.replacement_text
              ? `<div class="edit-replacement"><strong>Replacement text:</strong> ${suggestion.replacement_text}</div>`
              : ''}
          </div>
        `;
      }).join('') || '<div class="video-analysis-empty">No edit suggestions were returned.</div>'}
    </div>
    ${renderEditStudioSection()}
  `;

  bindEditStudioEvents();
  bindMusicMatchEvents();
}

function renderAutoEditNote() {
  if (!editStudioState.statusMessage && !latestEditRenderResult) {
    return '<div class="auto-edit-note hidden" id="video-auto-edit-note"></div>';
  }

  const warningLines = Array.isArray(latestEditRenderResult?.warnings) && latestEditRenderResult.warnings.length
    ? `<div class="auto-edit-warnings">${latestEditRenderResult.warnings.map(w => `<div>${escapeHtml(w)}</div>`).join('')}</div>`
    : '';
  const linkMarkup = latestEditRenderResult?.download_url
    ? `<div>Latest render ready: <a href="${API_BASE}${latestEditRenderResult.download_url}" target="_blank" rel="noopener">${escapeHtml(latestEditRenderResult.version_filename || 'Download edited video')}</a></div>`
    : '';
  const appliedCount = Array.isArray(latestEditRenderResult?.applied_edits) ? latestEditRenderResult.applied_edits.length : 0;

  return `
    <div class="auto-edit-note" id="video-auto-edit-note">
      ${editStudioState.statusMessage ? `<div>${escapeHtml(editStudioState.statusMessage)}</div>` : ''}
      ${linkMarkup}
      ${latestEditRenderResult ? `<div class="auto-edit-meta">Applied edits in current render: ${appliedCount}</div>` : ''}
      ${warningLines}
    </div>
  `;
}

function renderEditStudioSection() {
  const suggestedCommands = [
    'Cut from 00:04 to 00:08',
    'Add hook text at the beginning',
    'Add CTA at the end',
    'Resize for TikTok',
    'Add subtitles',
    'Increase audio volume',
  ];
  const hasFirstRender = Boolean(editStudioState.enabled && (editStudioState.previewUrl || editStudioState.downloadUrl || latestEditRenderResult));
  const canStartFirstRender = Boolean(state.backendLive && selectedVideoFile && lastVideoAnalysisResult && !hasFirstRender && !editStudioState.busy);
  const canSend = state.backendLive && editStudioState.enabled && !editStudioState.busy;
  const studioButtonDisabled = !(canSend || canStartFirstRender);
  const previewUrl = editStudioState.previewUrl
    ? `${editStudioState.previewUrl}${editStudioState.previewUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(editStudioState.currentVersion)}`
    : '';
  const previewMarkup = editStudioState.previewUrl
    ? `
      <video class="edit-studio-video" controls preload="auto" src="${previewUrl}"></video>
    `
    : `
      <div class="edit-studio-preview">
        <div class="edit-studio-play">Preview</div>
        <div class="edit-studio-preview-copy">Generate the first edited version to unlock chat edits.</div>
      </div>
    `;
  const messageMarkup = editStudioState.messages.map(message => `
    <div class="studio-message studio-message-${message.role}">
      ${escapeHtml(message.text)}
    </div>
  `).join('');
  const appliedEditsMarkup = editStudioState.appliedEdits.length
    ? editStudioState.appliedEdits.slice(-6).map(item => `<span>${escapeHtml(describeEditItem(item))}</span>`).join('')
    : '<span>No edits applied yet. The first render will appear after Auto Edit.</span>';
  const versionMarkup = editStudioState.versionHistory.map(item => `
    <span class="${item === editStudioState.currentVersion ? 'version-current' : ''}">${escapeHtml(item)}</span>
  `).join('');
  const buttonLabel = editStudioState.busy ? 'Rendering...' : canSend ? 'Send Edit' : 'Apply Auto Edit';
  const helperLabel = editStudioState.busy
    ? 'Rendering your next version now.'
    : canSend
      ? 'Conversational editing is live for this version.'
      : canStartFirstRender
        ? 'Create edited_v1.mp4, then ask for changes in chat.'
        : 'Generate AI Edit Suggestions first to unlock rendering.';
  const studioStatus = editStudioState.busy
    ? 'Rendering version'
    : canSend
      ? 'Conversational editing active'
      : canStartFirstRender
        ? 'Ready for first render'
        : 'Waiting for analysis';
  const duration = getVideoDurationSeconds();
  const timelineEndLabel = formatVideoTimestamp(duration);
  const assistantPanelMarkup = `
    <aside class="edit-studio-panel edit-studio-assistant-panel">
      <div class="edit-assistant-header">
        <div>
          <div class="video-card-label">Edit Assistant</div>
          <div class="edit-assistant-title">Ask for your next edit</div>
        </div>
        <span class="edit-beta-pill">Beta</span>
      </div>

      ${renderStudioQuickControls(canSend)}

      <div class="edit-chat-placeholder">
        ${messageMarkup}
        <div class="command-chip-row">
          ${suggestedCommands.map(command => `<button class="command-chip" type="button" data-command="${escapeHtml(command)}">${escapeHtml(command)}</button>`).join('')}
        </div>
      </div>

      <div class="edit-chat-input-row">
        <input
          id="edit-studio-input"
          class="edit-chat-input"
          type="text"
          placeholder="Example: cut from 00:04 to 00:08"
        />
        <button class="btn-primary" id="btn-send-edit-studio" type="button" data-studio-primary-action="chat" ${canSend ? '' : 'disabled'}>${buttonLabel}</button>
      </div>
      <div class="edit-coming-soon-label">${helperLabel}</div>
    </aside>
  `;

  return `
    <section class="edit-studio-shell" aria-label="Edit Studio Beta">
      <div class="edit-studio-header">
        <div>
          <div class="video-kicker">Interactive Editing Workspace</div>
          <h2>Edit Studio (Beta)</h2>
          <p class="results-sub">Refine the current render with chat-based edit instructions and versioned outputs.</p>
        </div>
        <span class="edit-studio-status">${studioStatus}</span>
      </div>

      <div class="edit-studio-grid">
        ${assistantPanelMarkup}

        <section class="edit-studio-panel edit-studio-video-card">
          <div class="edit-studio-theater-frame">
            ${previewMarkup}
          </div>

          <div class="edit-studio-theater-meta">
            <div class="edit-version-label">Version: ${escapeHtml(editStudioState.currentVersion)}</div>
            ${editStudioState.downloadUrl
              ? `<a class="edit-download-link" href="${editStudioState.downloadUrl}" target="_blank" rel="noopener">Download ${escapeHtml(editStudioState.currentVersion)}</a>`
              : ''}
          </div>

          ${hasFirstRender ? `
            <div class="edit-studio-panel edit-studio-preview-panel">
              <div class="timeline-placeholder" data-duration="${duration}">
                <div class="timeline-ruler">
                  <span>00:00</span>
                  <span>${formatVideoTimestamp(duration / 2)}</span>
                  <span>${timelineEndLabel}</span>
                </div>
                <div class="timeline-track" id="studio-timeline-track">
                  <span class="timeline-clip"></span>
                  <span class="timeline-selected-range" id="timeline-selected-range"></span>
                  <span class="timeline-handle timeline-start-handle" id="timeline-start-handle"></span>
                  <span class="timeline-handle timeline-end-handle" id="timeline-end-handle"></span>
                </div>
                <div class="timeline-controls-row">
                  <span id="timeline-selection-label">Selected: 00:04 - 00:08</span>
                  <button class="studio-tool-button timeline-cut-button" type="button" data-studio-action="cut">Cut selected range</button>
                </div>
              </div>
            </div>
          ` : `
            <div class="edit-studio-start">
              <button class="btn-primary" id="btn-apply-auto-edit" type="button" data-studio-primary-action="auto-edit" ${studioButtonDisabled ? 'disabled' : ''}>${buttonLabel}</button>
              <div class="edit-coming-soon-label">${helperLabel}</div>
            </div>
          `}
        </section>

        <section class="edit-studio-panel edit-studio-music-card">
          ${renderMusicMatchSection()}
        </section>
      </div>
    </section>
  `;
}

function renderMusicMatchSection() {
  const moods = [
    ['inspiring', 'Inspiring'],
    ['energetic', 'Energetic'],
    ['emotional', 'Emotional'],
    ['dramatic', 'Dramatic'],
    ['futuristic', 'Futuristic'],
    ['calm', 'Calm'],
    ['corporate', 'Corporate'],
    ['motivational', 'Motivational'],
  ];
  const canFindMusic = Boolean(state.backendLive && lastVideoAnalysisResult && !musicMatchState.busy);
  const canAddMusic = Boolean(
    canFindMusic && 
    musicMatchState.selectedTrackId && 
    editStudioState.videoId &&
    !musicMatchState.addingMusic
  );
  const confidenceLabel = musicMatchState.confidence == null
    ? 'Not analyzed yet'
    : `${Math.round(Number(musicMatchState.confidence || 0) * 100)}%`;
  
  // Audio status section
  const audioStatusHtml = musicMatchState.audioDetected !== undefined
    ? `
      <div class="audio-status-section">
        <div class="audio-status-header">Audio Analysis</div>
        <div class="audio-status-grid">
          <div class="audio-status-item">
            <span class="audio-status-label">Audio Detected:</span>
            <span class="audio-status-value ${musicMatchState.audioDetected ? 'yes' : 'no'}">
              ${musicMatchState.audioDetected ? '✓ Yes' : '✗ No'}
            </span>
          </div>
          <div class="audio-status-item">
            <span class="audio-status-label">Speech Detected:</span>
            <span class="audio-status-value ${musicMatchState.speechDetected ? 'yes' : 'no'}">
              ${musicMatchState.speechDetected ? '✓ Yes' : '✗ No'}
            </span>
          </div>
          ${musicMatchState.audioDuration > 0 ? `
            <div class="audio-status-item">
              <span class="audio-status-label">Duration:</span>
              <span class="audio-status-value">${formatVideoTimestamp(musicMatchState.audioDuration)}</span>
            </div>
          ` : ''}
        </div>
        ${musicMatchState.audioWarnings.length > 0 ? `
          <details class="warning-panel audio-warning-panel">
            <summary>Audio analysis warnings</summary>
            <div class="warning-list">
              ${musicMatchState.audioWarnings.map(w => `<div class="warning-item">⚠️ ${formatWarning(w)}</div>`).join('')}
            </div>
          </details>
        ` : ''}
      </div>
    `
    : '';
  
  // Audio mode selector
  const audioModeSelectorHtml = musicMatchState.selectedTrackId
    ? `
      <div class="audio-mode-selector">
        <div class="audio-mode-header">How to add music?</div>
        
        <div class="audio-mode-option">
          <input type="radio" name="audio-mode" value="keep_original" id="mode-keep" ${musicMatchState.audioMode === 'keep_original' ? 'checked' : ''}>
          <label for="mode-keep">
            <span class="mode-title">Keep Original Audio</span>
            <span class="mode-desc">No music added. Original audio preserved.</span>
          </label>
        </div>
        
        <div class="audio-mode-option">
          <input type="radio" name="audio-mode" value="mix_background_music" id="mode-mix" ${musicMatchState.audioMode === 'mix_background_music' ? 'checked' : ''}>
          <label for="mode-mix">
            <span class="mode-title">Add Background Music</span>
            <span class="mode-desc">Mix selected music underneath original audio${musicMatchState.speechDetected ? ' (music will be at low volume due to detected speech)' : ''}.</span>
          </label>
          <div class="mix-controls">
            <div class="control-group">
              <label for="music-volume">Music Volume:</label>
              <input type="range" id="music-volume" min="0" max="1" step="0.05" value="${musicMatchState.musicVolume}">
              <span id="music-volume-display">${musicMatchState.musicVolume.toFixed(2)}</span>
            </div>
            <div class="control-group">
              <label for="original-volume">Original Audio Volume:</label>
              <input type="range" id="original-volume" min="0" max="1" step="0.05" value="${musicMatchState.originalVolume}">
              <span id="original-volume-display">${musicMatchState.originalVolume.toFixed(2)}</span>
            </div>
          </div>
        </div>
        
        <div class="audio-mode-option">
          <input type="radio" name="audio-mode" value="replace_audio" id="mode-replace" ${musicMatchState.audioMode === 'replace_audio' ? 'checked' : ''}>
          <label for="mode-replace">
            <span class="mode-title">Replace Original Audio</span>
            <span class="mode-desc">Remove original audio, use selected music only.</span>
          </label>
        </div>
      </div>
    `
    : '';

  const formatWarning = warning => {
    const normalized = String(warning || '')
      .replace(/FFmpeg\/ffprobe not installed/gi, 'Audio analysis unavailable. Install FFmpeg and ensure ffprobe is available in PATH.');
    return escapeHtml(normalized);
  };

  const warningMarkup = musicMatchState.warnings.length
    ? `<details class="warning-panel">
         <summary>Audio warnings</summary>
         <div class="music-warning-list">${musicMatchState.warnings.map(warning => `<div>⚠️ ${formatWarning(warning)}</div>`).join('')}</div>
       </details>`
    : '';
  
  const trackMarkup = musicMatchState.tracks.length
    ? musicMatchState.tracks.map(track => {
      const isSelected = String(track.id) === String(musicMatchState.selectedTrackId);
      return `
        <div class="music-track-card ${isSelected ? 'music-track-selected' : ''}">
          ${track.image ? `<img class="music-track-image" src="${escapeHtml(track.image)}" alt="">` : '<div class="music-track-image music-track-image-empty">🎵</div>'}
          <div class="music-track-body">
            <div class="music-track-title">${escapeHtml(track.title || 'Untitled track')}</div>
            <div class="music-track-artist">${escapeHtml(track.artist || 'Unknown artist')}</div>
            <div class="music-track-meta">
              <span>${formatVideoTimestamp(track.duration || 0)}</span>
              ${track.album ? `<span>${escapeHtml(track.album)}</span>` : ''}
            </div>
            <div class="music-track-actions">
              <button class="studio-tool-button music-preview-button" type="button" data-preview-audio="${escapeHtml(track.preview_audio_url || '')}" data-preview-track="${escapeHtml(track.id || '')}" ${track.preview_audio_url ? '' : 'disabled'}>🎧 Preview</button>
              <button class="studio-tool-button music-select-button ${isSelected ? 'selected' : ''}" type="button" data-select-track="${escapeHtml(track.id || '')}">${isSelected ? '✓ Selected' : 'Select'}</button>
            </div>
            ${musicMatchState.previewTrackId === String(track.id) ? `
              <div class="music-preview-panel" data-preview-container="${escapeHtml(track.id || '')}">
                <div class="music-preview-controls">
                  <button class="studio-tool-button preview-control-play" type="button" data-preview-play="${escapeHtml(track.id || '')}">${musicMatchState.previewPlaying ? 'Pause' : 'Play'}</button>
                  <button class="studio-tool-button preview-control-stop" type="button" data-preview-stop="${escapeHtml(track.id || '')}">Stop</button>
                  <div class="preview-progress-row">
                    <div class="preview-progress-bar" data-preview-progress="${escapeHtml(track.id || '')}"><span></span></div>
                    <div class="preview-time"><span data-preview-current="${escapeHtml(track.id || '')}">00:00</span> / <span data-preview-duration="${escapeHtml(track.id || '')}">00:00</span></div>
                  </div>
                  <label class="preview-volume-label">
                    Volume
                    <input class="preview-volume-slider" type="range" min="0" max="1" step="0.01" value="${musicMatchState.previewVolume.toFixed(2)}" data-preview-volume="${escapeHtml(track.id || '')}">
                  </label>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('')
    : `<div class="music-empty-state">${musicMatchState.searched ? 'No music recommendations returned yet.' : 'Choose a mood or let AI detect one, then find matching music.'}</div>`;

  // Add Music result
  const addMusicResultHtml = musicMatchState.addMusicResult
    ? `<div class="add-music-result ${musicMatchState.addMusicResult.success ? 'success' : 'error'}">
        <div class="result-header">${musicMatchState.addMusicResult.success ? '✓ Music Added Successfully!' : '✗ Error Adding Music'}</div>
        ${musicMatchState.addMusicResult.success ? `
          <div class="result-content">
            <p>Added "${escapeHtml(musicMatchState.addMusicResult.track_title)}" by ${escapeHtml(musicMatchState.addMusicResult.track_artist)}</p>
            <p>Mode: ${musicMatchState.addMusicResult.audio_mode.replace(/_/g, ' ')}</p>
            <p>File: ${escapeHtml(musicMatchState.addMusicResult.output_filename)}</p>
          </div>
        ` : `
          <div class="result-content">
            ${(musicMatchState.addMusicResult.warnings || []).map(w => `<p>⚠️ ${escapeHtml(w)}</p>`).join('')}
          </div>
        `}
        ${musicMatchState.addMusicResult.warnings && musicMatchState.addMusicResult.warnings.length > 0 ? `
          <div class="result-warnings">
            ${musicMatchState.addMusicResult.warnings.map(w => `<div class="warning-item">⚠️ ${escapeHtml(w)}</div>`).join('')}
          </div>
        ` : ''}
      </div>`
    : '';

  return `
    <section class="music-match-shell" aria-label="AI Music Match">
      <div class="music-match-header">
        <div>
          <div class="video-kicker">AI Music Match</div>
          <h2>AI Music Match</h2>
          <p class="results-sub">Match background tracks to the transcript mood, platform, and video pacing.</p>
        </div>
        <span class="music-status-pill">${musicMatchState.busy ? 'Finding tracks' : musicMatchState.addingMusic ? 'Adding music...' : musicMatchState.detectedMood ? `Mood: ${escapeHtml(musicMatchState.detectedMood)}` : 'Ready'}</span>
      </div>

      <div class="music-match-controls">
        <div class="music-mood-summary">
          <div class="video-card-label">Detected Mood</div>
          <div class="music-mood-value">${escapeHtml(musicMatchState.detectedMood || 'Not detected yet')}</div>
          <div class="music-confidence">Confidence: ${confidenceLabel}</div>
          ${musicMatchState.moodReason ? `<div class="music-reason">${escapeHtml(musicMatchState.moodReason)}</div>` : ''}
          ${musicMatchState.tags ? `<div class="music-tags">Jamendo tags: ${escapeHtml(musicMatchState.tags)}</div>` : ''}
        </div>

        <div class="music-action-panel">
          <label class="studio-field">
            <span>Manual mood override</span>
            <select id="music-mood-select">
              <option value="">Auto detect mood</option>
              ${moods.map(([value, label]) => `<option value="${value}" ${musicMatchState.selectedMood === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <button class="btn-primary" id="btn-find-music" type="button" ${canFindMusic ? '' : 'disabled'}>${musicMatchState.busy ? '⏳ Finding...' : '🎵 Find Music'}</button>
          <button class="btn-primary" id="btn-add-music" type="button" ${canAddMusic ? '' : 'disabled'} style="background-color: #10b981;">${musicMatchState.addingMusic ? '⏳ Adding music...' : '➕ Add Music To Video'}</button>
        </div>
      </div>

      ${audioStatusHtml}
      ${warningMarkup}
      ${musicMatchState.statusMessage ? `<div class="music-status-message">${escapeHtml(musicMatchState.statusMessage)}</div>` : ''}

      <div class="music-track-grid">
        ${trackMarkup}
      </div>

      ${audioModeSelectorHtml}
      ${addMusicResultHtml}

      <div class="music-future-notes">
        <!-- Music mixing integration complete -->
      </div>
    </section>
  `;
}

function bindMusicMatchEvents() {
  $('music-mood-select')?.addEventListener('change', event => {
    musicMatchState.selectedMood = event.target.value || '';
  });

  $('btn-find-music')?.addEventListener('click', onFindMusic);
  $('btn-add-music')?.addEventListener('click', onAddMusicToVideo);

  // Track selection
  document.querySelectorAll('[data-select-track]').forEach(button => {
    button.addEventListener('click', () => {
      const trackId = button.dataset.selectTrack || '';
      const track = musicMatchState.tracks.find(t => String(t.id) === String(trackId));
      if (track) {
        musicMatchState.selectedTrackId = trackId;
        musicMatchState.selectedTrackData = track;
        musicMatchState.addMusicResult = null;
        // Log for debugging
        console.log('[Music Match] Track selected:', track.title, 'ID:', trackId);
      }
      renderVideoResults(lastVideoAnalysisResult);
    });
  });

  // Audio preview - single shared player
  const audioPreviewElement = createOrGetAudioPreview();
  
  document.querySelectorAll('[data-preview-audio]').forEach(button => {
    button.addEventListener('click', () => {
      const audioUrl = button.dataset.previewAudio || '';
      const trackId = button.dataset.previewTrack || '';
      if (!audioUrl) {
        showToast('No preview URL available for this track.', 'warn');
        return;
      }
      
      musicMatchState.previewTrackId = String(trackId);
      musicMatchState.previewPlaying = true;
      musicMatchState.previewVolume = Number(musicMatchState.previewVolume) || 1.0;
      
      // Stop any currently playing preview
      if (audioPreviewElement.src && audioPreviewElement.src !== audioUrl) {
        audioPreviewElement.pause();
      }
      
      audioPreviewElement.src = audioUrl;
      audioPreviewElement.volume = musicMatchState.previewVolume;
      audioPreviewElement.currentTime = 0;
      audioPreviewElement.play().catch(err => {
        console.error('[Music Match] Preview playback failed:', err);
        showToast('Audio preview could not be played. Check browser audio permissions.', 'warn');
        musicMatchState.previewPlaying = false;
      });
      
      renderVideoResults(lastVideoAnalysisResult);
      
      console.log('[Music Match] Playing preview:', audioUrl);
    });
  });

  document.querySelectorAll('[data-preview-play]').forEach(button => {
    button.addEventListener('click', () => {
      const trackId = button.dataset.previewPlay || '';
      if (musicMatchState.previewTrackId !== String(trackId)) return;
      if (audioPreviewElement.paused) {
        audioPreviewElement.play();
        musicMatchState.previewPlaying = true;
      } else {
        audioPreviewElement.pause();
        musicMatchState.previewPlaying = false;
      }
      renderVideoResults(lastVideoAnalysisResult);
    });
  });

  document.querySelectorAll('[data-preview-stop]').forEach(button => {
    button.addEventListener('click', () => {
      const trackId = button.dataset.previewStop || '';
      if (musicMatchState.previewTrackId !== String(trackId)) return;
      audioPreviewElement.pause();
      audioPreviewElement.currentTime = 0;
      musicMatchState.previewPlaying = false;
      renderVideoResults(lastVideoAnalysisResult);
    });
  });

  document.querySelectorAll('[data-preview-volume]').forEach(input => {
    input.addEventListener('input', (event) => {
      const trackId = input.dataset.previewVolume || '';
      if (musicMatchState.previewTrackId !== String(trackId)) return;
      const value = parseFloat(event.target.value);
      musicMatchState.previewVolume = Number.isNaN(value) ? 1.0 : value;
      audioPreviewElement.volume = musicMatchState.previewVolume;
      renderVideoResults(lastVideoAnalysisResult);
    });
  });

  if (!audioPreviewElement._previewListenersAdded) {
    audioPreviewElement.addEventListener('timeupdate', () => {
      const progress = audioPreviewElement.duration ? (audioPreviewElement.currentTime / audioPreviewElement.duration) * 100 : 0;
      document.querySelectorAll(`[data-preview-progress="${musicMatchState.previewTrackId}"] span`).forEach(bar => {
        bar.style.width = `${progress}%`;
      });
      document.querySelectorAll(`[data-preview-current="${musicMatchState.previewTrackId}"]`).forEach(el => {
        el.textContent = formatVideoTimestamp(audioPreviewElement.currentTime);
      });
      document.querySelectorAll(`[data-preview-duration="${musicMatchState.previewTrackId}"]`).forEach(el => {
        el.textContent = formatVideoTimestamp(audioPreviewElement.duration || 0);
      });
    });

    audioPreviewElement.addEventListener('ended', () => {
      musicMatchState.previewPlaying = false;
      renderVideoResults(lastVideoAnalysisResult);
    });

    audioPreviewElement._previewListenersAdded = true;
  }

  const previewContainer = document.querySelector(`[data-preview-container="${musicMatchState.previewTrackId}"]`);
  if (previewContainer) {
    previewContainer.appendChild(audioPreviewElement);
  }

  // Audio mode radio buttons
  document.querySelectorAll('input[name="audio-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      musicMatchState.audioMode = e.target.value;
      console.log('[Music Match] Audio mode changed to:', musicMatchState.audioMode);
      renderVideoResults(lastVideoAnalysisResult);
    });
  });

  // Volume sliders
  const musicVolumeSlider = $('music-volume');
  const musicVolumeDisplay = $('music-volume-display');
  if (musicVolumeSlider) {
    musicVolumeSlider.addEventListener('input', (e) => {
      musicMatchState.musicVolume = parseFloat(e.target.value);
      if (musicVolumeDisplay) {
        musicVolumeDisplay.textContent = musicMatchState.musicVolume.toFixed(2);
      }
      console.log('[Music Match] Music volume set to:', musicMatchState.musicVolume);
    });
  }

  const originalVolumeSlider = $('original-volume');
  const originalVolumeDisplay = $('original-volume-display');
  if (originalVolumeSlider) {
    originalVolumeSlider.addEventListener('input', (e) => {
      musicMatchState.originalVolume = parseFloat(e.target.value);
      if (originalVolumeDisplay) {
        originalVolumeDisplay.textContent = musicMatchState.originalVolume.toFixed(2);
      }
      console.log('[Music Match] Original volume set to:', musicMatchState.originalVolume);
    });
  }
}

function createOrGetAudioPreview() {
  let audioEl = $('music-preview-player');
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = 'music-preview-player';
    audioEl.controls = false;
    audioEl.style.display = 'none';
    audioEl.style.width = '0';
    audioEl.style.height = '0';
    audioEl.style.visibility = 'hidden';
    document.body.appendChild(audioEl);
  }
  return audioEl;
}

async function onFindMusic() {
  if (!lastVideoAnalysisResult) {
    showToast('Generate AI Edit Suggestions first.', 'warn');
    return;
  }
  if (!state.backendLive) {
    showToast('Music matching requires the backend to be live.', 'warn');
    return;
  }

  musicMatchState = {
    ...musicMatchState,
    busy: true,
    statusMessage: 'Finding music recommendations...',
    warnings: [],
  };
  renderVideoResults(lastVideoAnalysisResult);

  try {
    const payload = {
      transcript: lastVideoAnalysisResult.transcript || '',
      metadata: lastVideoAnalysisResult.metadata || {},
      target_platform: lastVideoAnalysisResult.target_platform || $('video-platform-select')?.value || 'instagram',
      mood: musicMatchState.selectedMood || null,
    };
    const res = await apiFetch('/music/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || `API ${res.status}`);

    musicMatchState = {
      ...musicMatchState,
      busy: false,
      searched: true,
      detectedMood: data.mood || '',
      confidence: data.confidence ?? null,
      moodReason: data.mood_reason || '',
      tags: data.tags || '',
      tracks: Array.isArray(data.tracks) ? data.tracks : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
      selectedTrackId: '',
      jamendoConfigured: Boolean(data.jamendo_configured),
      statusMessage: data.jamendo_configured
        ? 'Music recommendations loaded.'
        : 'Jamendo API key not configured.',
    };
    
    // Analyze audio after getting recommendations
    if (editStudioState.videoId && lastVideoAnalysisResult.transcript) {
      await analyzeVideoAudio();
    }
    
    renderVideoResults(lastVideoAnalysisResult);
    showToast(data.jamendo_configured ? 'Music recommendations loaded.' : 'Jamendo API key not configured.', data.jamendo_configured ? 'success' : 'warn');
  } catch (error) {
    musicMatchState = {
      ...musicMatchState,
      busy: false,
      searched: true,
      warnings: [error?.message || 'Music matching failed.'],
      statusMessage: 'Music matching failed.',
    };
    renderVideoResults(lastVideoAnalysisResult);
    showToast('Music matching failed. Check the backend logs.', 'warn');
  }
}

async function analyzeVideoAudio() {
  if (!state.backendLive || !editStudioState.videoId) {
    console.log('[Audio Analysis] Skipping audio analysis - no backend or video ID');
    return;
  }

  try {
    console.log('[Audio Analysis] Starting for video:', editStudioState.videoId);
    const payload = {
      video_id: editStudioState.videoId,
      transcript: lastVideoAnalysisResult?.transcript || {},
    };
    
    const res = await apiFetch('/music/analyze-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) {
      console.warn('[Audio Analysis] API error:', res.status);
      return;
    }
    
    const data = await res.json();
    console.log('[Audio Analysis] Results:', data);
    
    musicMatchState = {
      ...musicMatchState,
      audioDetected: Boolean(data.audio_detected),
      speechDetected: Boolean(data.speech_detected),
      musicDetected: data.music_detected,
      audioDuration: Number(data.audio_duration) || 0,
      audioWarnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
    
    console.log('[Audio Analysis] Updated state - Audio detected:', musicMatchState.audioDetected, 'Speech detected:', musicMatchState.speechDetected);
  } catch (error) {
    console.error('[Audio Analysis] Failed:', error?.message);
    musicMatchState.audioWarnings.push(`Audio analysis error: ${error?.message || 'Unknown'}`);
  }
}

async function onAddMusicToVideo() {
  if (!editStudioState.videoId) {
    showToast('Apply Auto Edit first to generate a video version.', 'warn');
    return;
  }
  if (!musicMatchState.selectedTrackId || !musicMatchState.selectedTrackData) {
    showToast('Select a music track first.', 'warn');
    return;
  }
  if (!state.backendLive) {
    showToast('Music mixing requires the backend to be live.', 'warn');
    return;
  }

  musicMatchState.addingMusic = true;
  musicMatchState.statusMessage = 'Adding music to video...';
  musicMatchState.addMusicResult = null;
  renderVideoResults(lastVideoAnalysisResult);

  try {
    const track = musicMatchState.selectedTrackData;
    const payload = {
      video_id: editStudioState.videoId,
      track: {
        id: track.id,
        title: track.title,
        artist: track.artist,
        preview_audio_url: track.preview_audio_url,
        download_url: track.download_url,
        speech_detected: musicMatchState.speechDetected,
      },
      audio_url: track.preview_audio_url || track.download_url,
      audio_mode: musicMatchState.audioMode,
      music_volume: musicMatchState.musicVolume,
      original_volume: musicMatchState.originalVolume,
      fade_in_seconds: musicMatchState.fadeInSeconds,
      fade_out_seconds: musicMatchState.fadeOutSeconds,
    };

    console.log('[Add Music] Payload:', {
      videoId: editStudioState.videoId,
      trackTitle: track.title,
      audioMode: musicMatchState.audioMode,
      musicVolume: musicMatchState.musicVolume,
      originalVolume: musicMatchState.originalVolume,
    });

    const res = await apiFetch('/music/add-to-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('[Add Music] Response:', data);

    if (!res.ok) {
      throw new Error(data?.detail || `API ${res.status}`);
    }

    musicMatchState.addingMusic = false;
    musicMatchState.addMusicResult = data;
    musicMatchState.statusMessage = `Music added! File: ${data.output_filename}`;

    // Update the editStudioState with the new version
    if (data.output_filename) {
      editStudioState = {
        ...editStudioState,
        currentVersion: data.output_filename,
        previewUrl: data.output_url ? `${API_BASE}${data.output_url}` : editStudioState.previewUrl,
        downloadUrl: data.output_url ? `${API_BASE}${data.output_url}` : editStudioState.downloadUrl,
        versionHistory: Array.isArray(data.version_history) ? data.version_history : editStudioState.versionHistory,
        messages: [
          ...editStudioState.messages,
          {
            role: 'assistant',
            text: `Added music "${track.title}" in ${musicMatchState.audioMode.replace(/_/g, ' ')} mode. File: ${data.output_filename}`,
          },
        ],
      };
      
      console.log('[Add Music] Updated version history:', editStudioState.versionHistory);
      console.log('[Add Music] New current version:', editStudioState.currentVersion);
    }

    renderVideoResults(lastVideoAnalysisResult);
    showToast(`Music added successfully! File: ${data.output_filename}`, 'success');
  } catch (error) {
    console.error('[Add Music] Error:', error?.message);
    musicMatchState.addingMusic = false;
    musicMatchState.addMusicResult = {
      success: false,
      warnings: [error?.message || 'Music addition failed'],
    };
    musicMatchState.statusMessage = 'Failed to add music. See details below.';
    renderVideoResults(lastVideoAnalysisResult);
    showToast(`Music mixing failed: ${error?.message}`, 'warn');
  }
}


function renderStudioQuickControls(canSend) {
  const disabled = canSend ? '' : 'disabled';
  return `
    <div class="studio-toolbox">
      <div class="studio-toolbox-header">
        <span class="video-card-label">Quick Edits</span>
        <span class="studio-toolbox-hint">Render each edit as a new version</span>
      </div>

      <div class="studio-tool-grid">
        <label class="studio-field">
          <span>Cut start</span>
          <input id="studio-cut-start" type="text" value="00:04" ${disabled}>
        </label>
        <label class="studio-field">
          <span>Cut end</span>
          <input id="studio-cut-end" type="text" value="00:08" ${disabled}>
        </label>
        <button class="studio-tool-button" type="button" data-studio-action="cut" ${disabled}>Cut range</button>
      </div>

      <div class="studio-tool-grid">
        <label class="studio-field studio-field-wide">
          <span>Overlay text</span>
          <input id="studio-overlay-text" type="text" placeholder="Innovation begins here" ${disabled}>
        </label>
        <label class="studio-field">
          <span>At</span>
          <input id="studio-overlay-time" type="text" value="00:02" ${disabled}>
        </label>
        <button class="studio-tool-button" type="button" data-studio-action="text" ${disabled}>Add text</button>
      </div>

      <div class="studio-tool-grid">
        <label class="studio-field">
          <span>Format</span>
          <select id="studio-platform-select" ${disabled}>
            <option value="tiktok">TikTok 9:16</option>
            <option value="instagram">Instagram 9:16</option>
            <option value="youtube">YouTube 16:9</option>
            <option value="linkedin">LinkedIn 16:9</option>
            <option value="facebook">Facebook 16:9</option>
            <option value="twitter">X / Twitter 16:9</option>
          </select>
        </label>
        <button class="studio-tool-button" type="button" data-studio-action="crop" ${disabled}>Crop fill</button>
        <button class="studio-tool-button" type="button" data-studio-action="resize" ${disabled}>Fit resize</button>
      </div>

      <div class="studio-tool-grid studio-tool-grid-compact">
        <button class="studio-tool-button" type="button" data-studio-action="subtitle" ${disabled}>Add subtitles</button>
        <button class="studio-tool-button" type="button" data-studio-action="volume-up" ${disabled}>Boost volume</button>
        <button class="studio-tool-button" type="button" data-studio-action="mute" ${disabled}>Mute</button>
      </div>
    </div>
  `;
}

function bindEditStudioEvents() {
  const input = $('edit-studio-input');
  const sendButtons = Array.from(document.querySelectorAll('[data-studio-primary-action]'));

  const canSendInstruction = () => state.backendLive && editStudioState.enabled && !editStudioState.busy;
  const canApplyAutoEdit = () => state.backendLive && !editStudioState.busy;

  document.querySelectorAll('.command-chip[data-command]').forEach(button => {
    button.addEventListener('click', () => {
      if (!canSendInstruction()) return;
      if (input) input.value = button.dataset.command || '';
      input?.focus();
    });
  });

  sendButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.studioPrimaryAction === 'auto-edit') {
        if (!canApplyAutoEdit()) return;
        onApplyAutoEdit();
        return;
      }
      if (!canSendInstruction()) return;
      onSendStudioInstruction();
    });
  });

  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && canSendInstruction()) {
      event.preventDefault();
      onSendStudioInstruction();
    }
  });

  bindTimelineControls(canApplyAutoEdit());

  document.querySelectorAll('.studio-tool-button[data-studio-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (!canSendInstruction()) return;
      const instruction = buildStudioToolInstruction(button.dataset.studioAction || '');
      if (instruction) onSendStudioInstruction(instruction);
    });
  });
}

function bindTimelineControls(canSendInstruction) {
  const track = $('studio-timeline-track');
  const startHandle = $('timeline-start-handle');
  const endHandle = $('timeline-end-handle');
  const startInput = $('studio-cut-start');
  const endInput = $('studio-cut-end');
  if (!track || !startHandle || !endHandle) return;

  let start = Math.min(4, getVideoDurationSeconds());
  let end = Math.min(8, getVideoDurationSeconds());
  let activeHandle = '';

  const setValues = (nextStart, nextEnd) => {
    const duration = getVideoDurationSeconds();
    start = Math.max(0, Math.min(duration, nextStart));
    end = Math.max(0, Math.min(duration, nextEnd));
    if (start >= end) {
      if (activeHandle === 'start') start = Math.max(0, end - 0.1);
      else end = Math.min(duration, start + 0.1);
    }
    if (startInput) startInput.value = formatVideoTimestamp(start);
    if (endInput) endInput.value = formatVideoTimestamp(end);
    updateTimelineSelection(start, end);
  };

  const valueFromPointer = event => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * getVideoDurationSeconds();
  };

  const onPointerMove = event => {
    if (!activeHandle) return;
    const value = valueFromPointer(event);
    if (activeHandle === 'start') setValues(value, end);
    else setValues(start, value);
  };

  const stopDrag = () => {
    activeHandle = '';
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', stopDrag);
  };

  const startDrag = handle => event => {
    if (!canSendInstruction) return;
    activeHandle = handle;
    event.preventDefault();
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', stopDrag);
  };

  const syncFromFields = () => {
    setValues(parseTimestampInput(startInput?.value, start), parseTimestampInput(endInput?.value, end));
  };

  startHandle.addEventListener('pointerdown', startDrag('start'));
  endHandle.addEventListener('pointerdown', startDrag('end'));
  startInput?.addEventListener('change', syncFromFields);
  endInput?.addEventListener('change', syncFromFields);
  setValues(start, end);
}

function updateTimelineSelection(start, end) {
  const duration = getVideoDurationSeconds();
  const rangeEl = $('timeline-selected-range');
  const startHandle = $('timeline-start-handle');
  const endHandle = $('timeline-end-handle');
  const labelEl = $('timeline-selection-label');
  if (rangeEl && duration > 0) {
    const left = Math.max(0, Math.min(100, (start / duration) * 100));
    const right = Math.max(0, Math.min(100, (end / duration) * 100));
    rangeEl.style.left = `${left}%`;
    rangeEl.style.width = `${Math.max(1, right - left)}%`;
    if (startHandle) startHandle.style.left = `${left}%`;
    if (endHandle) endHandle.style.left = `${right}%`;
  }
  if (labelEl) {
    labelEl.textContent = `Selected: ${formatVideoTimestamp(start)} - ${formatVideoTimestamp(end)}`;
  }
}

function getVideoDurationSeconds() {
  const metadata = lastVideoAnalysisResult?.metadata || {};
  const duration = Number(metadata.duration_seconds || latestEditRenderResult?.input_duration_seconds || 20);
  return Number.isFinite(duration) && duration > 0 ? Math.max(1, duration) : 20;
}

function parseTimestampInput(value, fallback = 0) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map(part => Number(part));
  if (parts.some(part => !Number.isFinite(part))) return fallback;
  return parts.reduce((total, part) => (total * 60) + part, 0);
}

function buildStudioToolInstruction(action) {
  const cutStart = ($('studio-cut-start')?.value || '00:04').trim();
  const cutEnd = ($('studio-cut-end')?.value || '00:08').trim();
  const overlayText = ($('studio-overlay-text')?.value || '').trim();
  const overlayTime = ($('studio-overlay-time')?.value || '00:02').trim();
  const platform = ($('studio-platform-select')?.value || lastVideoAnalysisResult?.target_platform || 'tiktok').trim();

  if (action === 'cut') return `cut from ${cutStart} to ${cutEnd}`;
  if (action === 'text') {
    if (!overlayText) {
      showToast('Add overlay text first.', 'warn');
      return '';
    }
    return `add text at ${overlayTime} saying ${overlayText}`;
  }
  if (action === 'crop') return `crop for ${platform}`;
  if (action === 'resize') return `resize for ${platform}`;
  if (action === 'subtitle') return 'add subtitles';
  if (action === 'volume-up') return 'increase audio volume';
  if (action === 'mute') return 'mute audio';
  return '';
}

async function onApplyAutoEdit() {
  const button = $('btn-apply-auto-edit') || $('btn-send-edit-studio');
  if (!button) return;

  if (!state.backendLive) {
    editStudioState.statusMessage = 'Auto-edit requires the backend to be live.';
    renderVideoResults(lastVideoAnalysisResult);
    showToast('Auto-edit requires the backend to be live.', 'warn');
    return;
  }

  if (!selectedVideoFile || !lastVideoAnalysisResult) {
    editStudioState.statusMessage = 'Generate AI Edit Suggestions first so the auto-edit pipeline can reuse the current analysis JSON.';
    if (lastVideoAnalysisResult) {
      renderVideoResults(lastVideoAnalysisResult);
    } else {
      renderVideoUnavailableState(
        'Auto Edit needs a real analysis result first.',
        'Upload a video and run AI Edit Suggestions while the backend is live.'
      );
    }
    showToast('Generate AI Edit Suggestions first.', 'warn');
    return;
  }

  editStudioState.busy = true;
  editStudioState.statusMessage = 'Rendering your edited video. This may take a moment.';
  renderVideoResults(lastVideoAnalysisResult);

  try {
    const formData = new FormData();
    formData.append('file', selectedVideoFile);
    formData.append('analysis_json', JSON.stringify(lastVideoAnalysisResult));
    formData.append('target_platform', lastVideoAnalysisResult.target_platform || $('video-platform-select')?.value || 'instagram');
    if (editStudioState.videoId) formData.append('video_id', editStudioState.videoId);

    const res = await apiFetch('/apply-auto-edit', { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `API ${res.status}`);
    }

    const data = await res.json();
    latestEditRenderResult = data;
    editStudioState = {
      ...editStudioState,
      enabled: true,
      busy: false,
      statusMessage: '',
      videoId: data.video_id || editStudioState.videoId,
      currentVersion: data.version_filename || 'edited_v1.mp4',
      previewUrl: data.preview_url ? `${API_BASE}${data.preview_url}` : '',
      downloadUrl: data.download_url ? `${API_BASE}${data.download_url}` : '',
      versionHistory: Array.isArray(data.version_history) && data.version_history.length ? data.version_history : ['Original Video', data.version_filename || 'edited_v1.mp4'],
      currentEditHistory: Array.isArray(data.current_edit_history) ? data.current_edit_history : [],
      appliedEdits: Array.isArray(data.applied_edits) ? data.applied_edits : [],
      messages: [
        {
          role: 'assistant',
          text: data.assistant_response || 'The first editable version is ready. You can now ask for another change.',
        },
      ],
    };
    renderVideoResults(lastVideoAnalysisResult);
    showToast('Edited video is ready for download.', 'success');
  } catch (error) {
    editStudioState.busy = false;
    editStudioState.statusMessage = `Auto-edit failed: ${error?.message || 'Unknown error'}`;
    renderVideoResults(lastVideoAnalysisResult);
    showToast('Auto-edit failed. Check the backend logs.', 'warn');
  }
}

async function onSendStudioInstruction(forcedInstruction = '') {
  const input = $('edit-studio-input');
  const instruction = (forcedInstruction || input?.value || '').trim();
  if (!instruction) return;

  if (!lastVideoAnalysisResult) {
    showToast('Generate AI Edit Suggestions first.', 'warn');
    return;
  }
  if (!state.backendLive) {
    showToast('Conversational editing requires the backend to be live.', 'warn');
    return;
  }
  if (!selectedVideoFile && !editStudioState.videoId) {
    showToast('The source video is missing. Re-upload the clip and try again.', 'warn');
    return;
  }

  const priorMessages = [...editStudioState.messages, { role: 'user', text: instruction }];
  editStudioState = {
    ...editStudioState,
    busy: true,
    statusMessage: 'Applying your edit instruction and rendering the next version.',
    messages: priorMessages,
  };
  if (input && !forcedInstruction) input.value = '';
  renderVideoResults(lastVideoAnalysisResult);

  try {
    const formData = new FormData();
    if (selectedVideoFile) formData.append('file', selectedVideoFile);
    if (editStudioState.videoId) formData.append('video_id', editStudioState.videoId);
    formData.append('analysis_json', JSON.stringify(lastVideoAnalysisResult));
    formData.append('current_edit_history_json', JSON.stringify(editStudioState.currentEditHistory || []));
    formData.append('user_instruction', instruction);
    formData.append('current_version', editStudioState.currentVersion || 'edited_v1.mp4');
    formData.append('target_platform', lastVideoAnalysisResult.target_platform || $('video-platform-select')?.value || 'instagram');

    const res = await apiFetch('/chat-edit-video', { method: 'POST', body: formData });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `API ${res.status}`);
    }

    const data = await res.json();
    if (data.needs_clarification) {
      const assistantText = data.assistant_response || data.question || 'I need a bit more detail.';
      editStudioState = {
        ...editStudioState,
        busy: false,
        statusMessage: '',
        videoId: data.video_id || editStudioState.videoId,
        messages: [...priorMessages, { role: 'assistant', text: assistantText }],
      };
      renderVideoResults(lastVideoAnalysisResult);
      if (!data.conversation_only) {
        showToast('The edit assistant needs one more detail.', 'warn');
      }
      return;
    }

    latestEditRenderResult = data;
    editStudioState = {
      ...editStudioState,
      enabled: true,
      busy: false,
      statusMessage: '',
      videoId: data.video_id || editStudioState.videoId,
      currentVersion: data.version_filename || editStudioState.currentVersion,
      previewUrl: data.preview_url ? `${API_BASE}${data.preview_url}` : editStudioState.previewUrl,
      downloadUrl: data.download_url ? `${API_BASE}${data.download_url}` : editStudioState.downloadUrl,
      versionHistory: Array.isArray(data.version_history) && data.version_history.length ? data.version_history : editStudioState.versionHistory,
      currentEditHistory: Array.isArray(data.current_edit_history) ? data.current_edit_history : editStudioState.currentEditHistory,
      appliedEdits: Array.isArray(data.applied_edits) ? data.applied_edits : editStudioState.appliedEdits,
      messages: [...priorMessages, { role: 'assistant', text: data.assistant_response || 'I applied that edit and rendered a new version.' }],
    };
    renderVideoResults(lastVideoAnalysisResult);
    showToast(`Rendered ${data.version_filename || 'a new version'}.`, 'success');
  } catch (error) {
    editStudioState = {
      ...editStudioState,
      busy: false,
      statusMessage: `Edit Studio failed: ${error?.message || 'Unknown error'}`,
      messages: [...priorMessages, { role: 'assistant', text: 'That edit did not render successfully. Please try again with a more specific instruction.' }],
    };
    renderVideoResults(lastVideoAnalysisResult);
    showToast('Edit Studio failed. Check the backend logs.', 'warn');
  }
}

function describeEditItem(item) {
  const type = (item?.type || 'edit').replaceAll('_', ' ');
  const start = Number(item?.start ?? 0);
  const end = Number(item?.end ?? 0);
  if (type === 'cut') return `Cut ${formatVideoTimestamp(start)} to ${formatVideoTimestamp(end)}`;
  if (type === 'resize') return `Resize for ${(item?.platform || lastVideoAnalysisResult?.target_platform || 'platform')}`;
  if (type === 'crop') return `Crop for ${(item?.platform || lastVideoAnalysisResult?.target_platform || 'platform')}`;
  if (type === 'cta overlay') return 'Add CTA overlay';
  if (type === 'text overlay') return item?.text ? `Add text: ${item.text}` : 'Add text overlay';
  if (type === 'subtitle') return 'Add subtitles';
  if (type === 'volume adjust') return 'Adjust audio volume';
  if (type === 'mute') return 'Mute audio';
  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderScoreChip(label, value, allowUnknown = false) {
  const isUnknown = allowUnknown && (value == null);
  const numericValue = Number(value ?? 0);
  const scoreClass = isUnknown ? 'unknown' : numericValue >= 70 ? 'good' : numericValue >= 40 ? 'mid' : 'low';
  const scoreText = isUnknown ? 'Unknown' : `${numericValue}/100`;
  return `
    <div class="score-chip score-chip-${scoreClass}">
      <span class="score-chip-label">${label}</span>
      <span class="score-chip-value">${scoreText}</span>
    </div>
  `;
}

function generateMockVideoResults(targetPlatform = 'instagram', goal = '') {
  return {
    target_platform: targetPlatform,
    goal,
    source: 'demo',
    metadata: {
      duration_seconds: 24.6,
      width: 1080,
      height: 1920,
      aspect_ratio: '9:16',
      orientation: 'portrait',
      fps: 30,
      file_size_mb: 12.4,
      has_audio: true,
    },
    transcript: {
      source: 'faster-whisper',
      available: true,
      error: null,
      text: 'Stars of Science is where bold ideas step into the spotlight. This cut introduces the concept, but the hook could land faster. A tighter middle section would help hold attention through the payoff.',
      segments: [
        { start: 0, end: 3.2, text: 'Stars of Science is where bold ideas step into the spotlight.' },
        { start: 3.2, end: 8.5, text: 'This cut introduces the concept, but the hook could land faster.' },
        { start: 8.5, end: 13.7, text: 'A tighter middle section would help hold attention through the payoff.' },
      ],
    },
    analysis: {
      overall_score: 72,
      content_analysis_confidence: 'high',
      scores: {
        visual_quality: 76,
        platform_fit: 72,
        content_clarity: 70,
        engagement_potential: 69,
      },
      summary: 'Demo AI suggestions are shown because the live OpenAI video analysis is unavailable right now.',
      platform_fit: `The clip has a workable foundation for ${targetPlatform}, but it would benefit from a sharper opening, cleaner pacing, and a clearer call to action.`,
      edit_suggestions: [
        {
          type: 'hook_rewrite',
          start: 0,
          end: 4,
          issue: 'The opening may not create enough immediate curiosity for fast-scrolling viewers.',
          action: 'Replace the opening line or subtitle with a bolder promise, question, or surprising insight.',
          reason: `${targetPlatform.charAt(0).toUpperCase() + targetPlatform.slice(1)} audiences usually decide within the first few seconds whether to keep watching.`,
          replacement_text: 'What if one bold idea from Qatar could change the future of science?',
        },
        {
          type: 'pacing_fix',
          start: 4,
          end: 12,
          issue: 'The middle section may feel slower than the opening and closing beats.',
          action: 'Tighten pauses, trim repeated lines, and keep only the strongest spoken moments in this section.',
          reason: 'A faster rhythm helps maintain retention once the core idea has been introduced.',
          replacement_text: '',
        },
        {
          type: 'cta_overlay',
          start: 20,
          end: 24.6,
          issue: 'The ending may not give viewers a strong next step.',
          action: 'Add a closing text overlay with a direct call to watch, comment, or follow.',
          reason: 'A clear ending cue improves engagement and makes the clip feel complete.',
          replacement_text: 'Watch the full innovation story and tell us which idea stands out most.',
        },
      ],
      recommended_caption: `Big ideas start with one breakthrough moment. Here is a sharper ${targetPlatform} version built to keep attention and spark conversation around Stars of Science.`,
      recommended_hashtags: ['#StarsOfScience', '#Science', '#Innovation', '#Qatar', '#MENA'],
      recommended_cta: goal || 'Watch, comment, and share your favorite breakthrough.',
    },
  };
}

// ---- BOOT ----
init();
