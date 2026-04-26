/**
 * ──────────────────────────────────────────────
 *  Curator — HTML Page Generator
 * ──────────────────────────────────────────────
 * Generates a self-contained HTML page with inline
 * CSS and JavaScript for the curator UI.
 *
 * The page connects to the curator server via SSE
 * for real-time search-result streaming and
 * provides an interactive interface for reviewing,
 * selecting, summarising, and approving results.
 *
 * @module curator/page
 */

import type { ICuratorBootstrap } from "../types/curator.js";

// ── Options ────────────────────────────────────

export interface IPageOptions {
    queries: readonly string[];
    sessionToken: string;
    bootstrap: ICuratorBootstrap;
    summaryModels: ReadonlyArray<{ value: string; label: string }>;
    defaultSummaryModel: string;
}

// ── Safe JSON inlining ─────────────────────────

function safeInlineJSON(value: unknown): string {
    return JSON.stringify(value)
        .replace(/<\/script/g, "<\\/script")
        .replace(/<!--/g, "<\\!--");
}

// ── HTML generation ────────────────────────────

export function generateCuratorPage(options: IPageOptions): string {
    const { queries, sessionToken, bootstrap, summaryModels, defaultSummaryModel } = options;

    const providerButtonsHtml = buildProviderButtons(bootstrap);

    const inlineData = safeInlineJSON({
        queries,
        sessionToken,
        bootstrap,
        summaryModels,
        defaultSummaryModel,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Search Curator — Pi Web Access</title>
<style>
${CSS}
</style>
</head>
<body>
<div id="app">
  <header>
    <h1>🔍 Search Curator</h1>
    <div id="timer-container">
      <span id="timer-label">Auto-submit in</span>
      <span id="timer">${bootstrap.timeoutSeconds}s</span>
      <button id="extend-btn" title="Add 30 seconds">+30s</button>
    </div>
  </header>

  <div id="provider-bar">
    <span class="bar-label">Provider:</span>
    <div id="provider-buttons">
      ${providerButtonsHtml}
    </div>
  </div>

  <div id="queries-section">
    <h2>Search Queries</h2>
    <div id="query-list"></div>
    <div class="add-query-row">
      <input type="text" id="new-query-input" placeholder="Add a new search query..." />
      <button id="add-query-btn">Search</button>
    </div>
  </div>

  <div id="results-section">
    <h2>Results</h2>
    <div id="progress-bar-container" style="display:none">
      <div id="progress-bar"></div>
      <span id="progress-text"></span>
    </div>
    <div id="results-list"></div>
  </div>

  <div id="summary-section" style="display:none">
    <h2>Summary</h2>
    <div id="summary-toolbar">
      <select id="summary-model-select"></select>
      <button id="regenerate-btn">↻ Regenerate</button>
    </div>
    <textarea id="summary-editor" placeholder="Summary will appear here..."></textarea>
    <div id="summary-meta"></div>
    <div id="feedback-row" style="display:none">
      <input type="text" id="feedback-input" placeholder="Feedback for summary generation..." />
      <button id="feedback-btn">Apply</button>
    </div>
    <div class="action-buttons">
      <button id="approve-btn" class="primary">✅ Approve & Send</button>
      <button id="send-raw-btn">📋 Send selected results without summary</button>
      <button id="cancel-btn" class="danger">✕ Cancel</button>
    </div>
  </div>
</div>

<script>
${buildScript(inlineData)}
</script>
</body>
</html>`;
}

// ── Provider buttons ───────────────────────────

function buildProviderButtons(bootstrap: ICuratorBootstrap): string {
    const providers = [
        { value: "exa", label: "Exa", available: bootstrap.availableProviders.exa },
        {
            value: "perplexity",
            label: "Perplexity",
            available: bootstrap.availableProviders.perplexity,
        },
        {
            value: "gemini",
            label: "Gemini",
            available: bootstrap.availableProviders.gemini,
        },
    ];

    return providers
        .map((p) => {
            const isDefault = p.value === bootstrap.defaultProvider;
            const state = isDefault ? ' data-state="active"' : "";
            const disabled = !p.available ? " disabled" : "";
            const classes = `provider-btn${isDefault ? " active" : ""}${!p.available ? " unavailable" : ""}`;
            return `<button class="${classes}" data-provider="${p.value}"${state}${disabled}>${p.label}</button>`;
        })
        .join("\n      ");
}

// ── CSS ────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: #0d1117; color: #c9d1d9; line-height: 1.6;
  max-width: 960px; margin: 0 auto; padding: 20px;
}
header {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 16px; border-bottom: 1px solid #30363d; margin-bottom: 20px;
}
h1 { font-size: 1.5em; color: #58a6ff; }
h2 { font-size: 1.1em; color: #8b949e; margin-bottom: 12px; }
#timer-container { display: flex; align-items: center; gap: 8px; }
#timer { font-size: 1.4em; font-weight: 700; color: #f0883e; font-variant-numeric: tabular-nums; min-width: 3em; text-align: center; }
#timer-label { font-size: 0.85em; color: #8b949e; }
#extend-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
#extend-btn:hover { background: #30363d; }
#provider-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
.bar-label { font-size: 0.9em; color: #8b949e; }
.provider-btn { padding: 6px 14px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; border-radius: 6px; cursor: pointer; font-size: 0.85em; }
.provider-btn.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.provider-btn.unavailable { opacity: 0.4; cursor: not-allowed; }
.provider-btn:hover:not(.active):not(.unavailable) { background: #30363d; }
#queries-section, #results-section, #summary-section { margin-bottom: 24px; }
.query-item { padding: 8px 12px; margin-bottom: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; display: flex; align-items: center; gap: 8px; }
.query-item .status { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.query-item .status.pending { background: #8b949e; }
.query-item .status.running { background: #f0883e; animation: pulse 1s infinite; }
.query-item .status.done { background: #3fb950; }
.query-item .status.error { background: #f85149; }
.query-item .q-text { flex: 1; font-size: 0.9em; }
.query-item .q-provider { font-size: 0.8em; color: #8b949e; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.add-query-row { display: flex; gap: 8px; margin-top: 8px; }
#new-query-input { flex: 1; padding: 8px 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9em; }
#new-query-input:focus { outline: none; border-color: #58a6ff; }
#add-query-btn, #approve-btn, #send-raw-btn, #cancel-btn, #regenerate-btn, #feedback-btn { padding: 8px 16px; border: 1px solid #30363d; border-radius: 6px; cursor: pointer; font-size: 0.9em; }
#add-query-btn { background: #238636; color: #fff; border-color: #238636; }
#add-query-btn:hover { background: #2ea043; }
#add-query-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#progress-bar-container { background: #21262d; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; }
#progress-bar { height: 6px; background: #1f6feb; border-radius: 3px; transition: width 0.3s; flex-shrink: 0; min-width: 10%; }
#progress-text { font-size: 0.85em; color: #8b949e; white-space: nowrap; }
.result-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px;
}
.result-card .answer { margin-bottom: 12px; font-size: 0.95em; line-height: 1.7; }
.result-card .answer p { margin-bottom: 8px; }
.result-card .sources { font-size: 0.85em; }
.result-card .sources a { color: #58a6ff; text-decoration: none; }
.result-card .sources a:hover { text-decoration: underline; }
.result-card .source-item { padding: 2px 0; }
#summary-section { border-top: 1px solid #30363d; padding-top: 20px; }
#summary-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
#summary-model-select { padding: 6px 10px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85em; }
#summary-editor { width: 100%; min-height: 200px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-family: inherit; font-size: 0.9em; line-height: 1.6; resize: vertical; }
#summary-editor:focus { outline: none; border-color: #58a6ff; }
#summary-meta { font-size: 0.8em; color: #8b949e; margin-top: 8px; }
#feedback-row { display: flex; gap: 8px; margin-top: 8px; }
#feedback-input { flex: 1; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.85em; }
.action-buttons { display: flex; gap: 8px; margin-top: 16px; }
#approve-btn { background: #238636; color: #fff; border-color: #238636; }
#approve-btn:hover { background: #2ea043; }
#approve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#send-raw-btn { background: #21262d; color: #c9d1d9; }
#send-raw-btn:hover { background: #30363d; }
#cancel-btn { background: #21262d; color: #f85149; border-color: #f85149; margin-left: auto; }
#cancel-btn:hover { background: #301a1a; }
#regenerate-btn { background: #21262d; color: #c9d1d9; }
#regenerate-btn:hover { background: #30363d; }
#regenerate-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// ── JavaScript ─────────────────────────────────

function buildScript(inlineData: string): string {
    return `
const DATA = ${inlineData};
let currentProvider = DATA.bootstrap.defaultProvider;
let results = {};
let resultOrder = [];
let selectedQueries = new Set();
let summaryMeta = null;
let approvedSummary = null;
let countdownTimer = null;
let timeRemaining = DATA.bootstrap.timeoutSeconds;
let queryIndexCounter = DATA.queries.length;
let searchDone = false;
let summarising = false;

// ── DOM refs ──────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const queryList = $('#query-list');
const resultsList = $('#results-list');
const summarySection = $('#summary-section');
const summaryEditor = $('#summary-editor');
const summaryMetaEl = $('#summary-meta');
const timerEl = $('#timer');
const progressBar = $('#progress-bar');
const progressText = $('#progress-text');
const progressContainer = $('#progress-bar-container');
const summaryModelSelect = $('#summary-model-select');
const approveBtn = $('#approve-btn');
const sendRawBtn = $('#send-raw-btn');
const cancelBtn = $('#cancel-btn');
const regenerateBtn = $('#regenerate-btn');
const feedbackRow = $('#feedback-row');
const feedbackInput = $('#feedback-input');
const feedbackBtn = $('#feedback-btn');

// ── Initialise ────────────────────────────
function init() {
  // Populate summary model select
  DATA.summaryModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    if (m.value === DATA.defaultSummaryModel) opt.selected = true;
    summaryModelSelect.appendChild(opt);
  });

  // Render initial queries
  DATA.queries.forEach((q, i) => addQueryItem(i, q, 'pending'));

  // Provider buttons
  $$('.provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      $$('.provider-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentProvider = btn.dataset.provider;
    });
  });

  // Event listeners
  $('#add-query-btn').addEventListener('click', addNewQuery);
  $('#new-query-input').addEventListener('keydown', e => { if (e.key === 'Enter') addNewQuery(); });
  approveBtn.addEventListener('click', approveSummary);
  sendRawBtn.addEventListener('click', sendRawResults);
  cancelBtn.addEventListener('click', cancelSession);
  regenerateBtn.addEventListener('click', regenerateSummary);
  feedbackBtn.addEventListener('click', () => regenerateSummary(feedbackInput.value));
  $('#extend-btn').addEventListener('click', extendTimer);

  // Start countdown
  startCountdown();

  // Connect SSE
  connectSSE();
}

// ── SSE connection ────────────────────────
function connectSSE() {
  const evtSource = new EventSource('/sse?token=' + encodeURIComponent(DATA.sessionToken));

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (e) { console.error('SSE parse error:', e); }
  };

  evtSource.onerror = () => {
    console.warn('SSE connection error, retrying...');
  };
}

function handleSSEEvent(data) {
  switch (data.type) {
    case 'init':
      data.queries.forEach((q, i) => {
        if (i < DATA.queries.length) updateQueryStatus(i, 'pending');
      });
      break;

    case 'progress':
      updateQueryStatus(data.current, 'running');
      updateProgress(data.current, data.total, data.query);
      break;

    case 'result':
      addResult(data.queryIndex, data.answer, data.results, data.provider);
      updateQueryStatus(data.queryIndex, 'done');
      break;

    case 'error':
      addErrorResult(data.queryIndex, data.error, data.provider);
      updateQueryStatus(data.queryIndex, 'error');
      break;

    case 'done':
      searchDone = true;
      showSummarySection();
      break;

    case 'summary_ready':
      summarising = false;
      regenerateBtn.disabled = false;
      summaryEditor.value = data.summary;
      summaryMeta = data.meta;
      renderSummaryMeta(data.meta);
      break;
  }
}

// ── Query management ──────────────────────
function addQueryItem(index, query, status) {
  const div = document.createElement('div');
  div.className = 'query-item';
  div.id = 'query-' + index;
  div.innerHTML = '<span class="status ' + status + '"></span>' +
    '<span class="q-text">' + escapeHtml(query) + '</span>' +
    '<span class="q-provider"></span>';
  queryList.appendChild(div);
}

function updateQueryStatus(index, status) {
  const el = document.getElementById('query-' + index);
  if (!el) return;
  const dot = el.querySelector('.status');
  dot.className = 'status ' + status;
}

function updateQueryProvider(index, provider) {
  const el = document.getElementById('query-' + index);
  if (!el) return;
  el.querySelector('.q-provider').textContent = provider;
}

async function addNewQuery() {
  const input = $('#new-query-input');
  const query = input.value.trim();
  if (!query) return;

  input.value = '';
  const index = queryIndexCounter++;
  addQueryItem(index, query, 'running');
  updateProgress(resultOrder.length, resultOrder.length, query);
  $('#add-query-btn').disabled = true;

  try {
    const res = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, provider: currentProvider }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    updateQueryProvider(index, data.provider);
  } catch (err) {
    addErrorResult(index, err.message, currentProvider);
    updateQueryStatus(index, 'error');
  } finally {
    $('#add-query-btn').disabled = false;
  }
}

// ── Results ───────────────────────────────
function addResult(index, answer, sources, provider) {
  results[index] = { answer, sources, provider, error: null };
  if (!resultOrder.includes(index)) resultOrder.push(index);
  const info = getSourceCount(sources);
  updateQueryProvider(index, provider);
  renderResults();
  updateProgress(resultOrder.length, resultOrder.length, '');
}

function addErrorResult(index, error, provider) {
  results[index] = { answer: '', sources: [], provider, error };
  if (!resultOrder.includes(index)) resultOrder.push(index);
  renderResults();
}

function getSourceCount(sources) {
  return Array.isArray(sources) ? sources.length : 0;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderResults() {
  resultsList.innerHTML = '';
  for (const idx of resultOrder) {
    const r = results[idx];
    if (!r) continue;

    const card = document.createElement('div');
    card.className = 'result-card';
    card.id = 'result-' + idx;
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.3s';

    if (r.error) {
      card.innerHTML = '<div class="answer" style="color:#f85149"><strong>Query ' + (idx + 1) + ' failed:</strong> ' + escapeHtml(r.error) + '</div>';
    } else {
      const sourcesHtml = Array.isArray(r.sources) && r.sources.length > 0
        ? '<div class="sources"><strong>Sources:</strong><br>' +
          r.sources.map((s, i) =>
            '<div class="source-item">' + (i + 1) + '. <a href="' + escapeHtml(s.url) + '" target="_blank">' + escapeHtml(s.title || s.url) + '</a></div>'
          ).join('') +
          '</div>'
        : '';

      card.innerHTML = '<div class="answer">' + markedParse(r.answer) + '</div>' + sourcesHtml;
    }

    resultsList.appendChild(card);
    requestAnimationFrame(() => { card.style.opacity = '1'; });
  }
}

function markedParse(text) {
  // Simple markdown-to-HTML conversion
  return escapeHtml(text)
    .replace(/\\n/g, '<br>')
    .replace(/### (.+)/g, '<h3>$1</h3>')
    .replace(/## (.+)/g, '<h2>$1</h2>')
    .replace(/# (.+)/g, '<h1>$1</h1>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\\[(.+?)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\\n\\n/g, '</p><p>')
    .replace(/^(.+)$/gm, function(m) { return m.trim() ? m : ''; });
}

// ── Progress ──────────────────────────────
function updateProgress(current, total, query) {
  progressContainer.style.display = 'flex';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = Math.min(pct, 100) + '%';
  progressText.textContent = query
    ? 'Searching: ' + escapeHtml(query)
    : current + '/' + total + ' searches complete';
}

// ── Summary ───────────────────────────────
function showSummarySection() {
  progressContainer.style.display = 'none';
  summarySection.style.display = 'block';
  approveBtn.disabled = false;
  // Request summary generation
  regenerateSummary();
}

async function regenerateSummary(feedback) {
  if (summarising) return;
  summarising = true;
  regenerateBtn.disabled = true;
  summaryEditor.value = 'Generating summary...';

  try {
    const body = {};
    const model = summaryModelSelect.value;
    if (model) body.model = model;
    if (feedback) body.feedback = feedback;

    const res = await fetch('/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Summarisation failed');
    }

    const data = await res.json();
    summaryEditor.value = data.summary;
    summaryMeta = data.meta;
    renderSummaryMeta(data.meta);
  } catch (err) {
    summaryEditor.value = 'Error generating summary: ' + err.message;
  } finally {
    summarising = false;
    regenerateBtn.disabled = false;
  }
}

function renderSummaryMeta(meta) {
  if (!meta) { summaryMetaEl.textContent = ''; return; }
  const parts = [];
  if (meta.model) parts.push('Model: ' + meta.model);
  if (meta.durationMs != null) parts.push('Duration: ' + (meta.durationMs / 1000).toFixed(1) + 's');
  if (meta.tokenEstimate) parts.push('Tokens: ~' + meta.tokenEstimate);
  if (meta.fallbackUsed) parts.push('(fallback)');
  if (meta.edited) parts.push('(edited)');
  summaryMetaEl.textContent = parts.join(' · ');
}

// ── Actions ───────────────────────────────
async function approveSummary() {
  const summary = summaryEditor.value.trim();
  if (!summary) return;

  approveBtn.disabled = true;
  const meta = summaryMeta || { model: null, durationMs: 0, tokenEstimate: 0, fallbackUsed: true, fallbackReason: 'approved', edited: false };

  try {
    await fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, meta, selectedQueryIndices: [...selectedQueries] }),
    });
  } catch (err) {
    console.error('Submit error:', err);
  }
}

async function sendRawResults() {
  const meta = { model: null, durationMs: 0, tokenEstimate: 0, fallbackUsed: true, fallbackReason: 'send-raw', edited: false };

  try {
    await fetch('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: '', meta, selectedQueryIndices: [...selectedQueries] }),
    });
  } catch (err) {
    console.error('Submit error:', err);
  }
}

async function cancelSession() {
  try {
    await fetch('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user-cancelled' }),
    });
  } catch (err) {
    console.error('Cancel error:', err);
  }
}

// ── Countdown timer ───────────────────────
function startCountdown() {
  timeRemaining = DATA.bootstrap.timeoutSeconds;
  updateTimerDisplay();
  countdownTimer = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay();
    if (timeRemaining <= 0) {
      clearInterval(countdownTimer);
      autoSubmit();
    }
  }, 1000);
}

function updateTimerDisplay() {
  timerEl.textContent = timeRemaining + 's';
  if (timeRemaining <= 10) timerEl.style.color = '#f85149';
  else if (timeRemaining <= 30) timerEl.style.color = '#f0883e';
  else timerEl.style.color = '#c9d1d9';
}

function extendTimer() {
  timeRemaining += 30;
  updateTimerDisplay();
  if (timeRemaining > 10) timerEl.style.color = '#f0883e';
}

function autoSubmit() {
  if (summaryEditor.value.trim()) {
    approveSummary();
  } else {
    sendRawResults();
  }
}

// ── Heartbeat ─────────────────────────────
setInterval(() => {
  fetch('/heartbeat', { method: 'POST' }).catch(() => {});
}, 10_000);

// ── Start ─────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
`;
}
