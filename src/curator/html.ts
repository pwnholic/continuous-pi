import type { SummaryMeta } from "../summary-review.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CuratorHTMLOptions {
    queries: string[];
    sessionToken: string;
    timeout: number;
    availableProviders: { perplexity: boolean; exa: boolean; gemini: boolean };
    defaultProvider: string;
    summaryModels: Array<{ value: string; label: string }>;
    defaultSummaryModel: string | null;
}

// ─── HTML Generator ──────────────────────────────────────────────────────────

export function renderCuratorHTML(options: CuratorHTMLOptions): string {
    const config = JSON.stringify(options);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Web Search Curator</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  @keyframes spin { to { transform: rotate(360deg) } }
  .animate-spin { animation: spin 1s linear infinite }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.5 } }
  .animate-pulse { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite }
  .line-clamp-3 { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden }
</style>
</head>
<body class="min-h-screen bg-gray-50">
<!-- Header -->
<header class="bg-white border-b border-gray-200 sticky top-0 z-10">
  <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-bold text-gray-800">Web Search Curator</h1>
      <span id="conn-badge" class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <span id="conn-dot" class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
        <span id="conn-label">Disconnected</span>
      </span>
      <span class="text-xs text-gray-400">Phase: <span id="phase" class="font-mono">searching</span></span>
    </div>
    <button onclick="handleCancel()" class="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
  </div>
</header>

<main class="max-w-5xl mx-auto p-4 space-y-6">
  <!-- Search Results -->
  <section>
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">
        Search Results (<span id="query-count">0</span>)
      </h2>
      <span id="running-label" class="text-sm text-gray-400 animate-pulse">Running searches...</span>
    </div>
    <div id="results-list" class="space-y-2"></div>
    <p id="no-queries" class="text-sm text-gray-400 text-center py-8 hidden">No search queries yet.</p>
  </section>

  <!-- Add Query -->
  <section class="bg-white border rounded-lg p-4">
    <h3 class="text-sm font-semibold text-gray-700 mb-3">Add Search Query</h3>
    <div class="flex gap-2">
      <input id="new-query" type="text" placeholder="Enter a search query..."
        class="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      <select id="provider-select" class="px-3 py-2 border rounded-md text-sm bg-white">${providerOptions(options.availableProviders)}</select>
      <button onclick="handleAddQuery()" id="add-btn"
        class="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled>Search</button>
    </div>
  </section>

  <!-- Summary Section -->
  <section id="summary-section" class="bg-white border rounded-lg p-4 hidden">
    <h3 class="text-sm font-semibold text-gray-700 mb-3">Summary (<span id="selected-count">0</span> queries selected)</h3>
    <div class="space-y-3">
      <div id="summary-actions" class="flex items-center gap-2">
        <button onclick="handleSummarize()" id="summarize-btn"
          class="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50">Generate Summary</button>
        ${summaryModelSelect(options.summaryModels)}
      </div>
      <div id="summary-editor" class="space-y-2 hidden">
        <textarea id="summary-text" class="w-full h-40 px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"></textarea>
        <input id="feedback-input" type="text" placeholder="Feedback for model (optional)..."
          class="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
    </div>
    <div class="flex gap-2 mt-4 pt-3 border-t border-gray-100">
      <button onclick="handleSubmit()" class="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700">Submit Results</button>
      <button id="regen-btn" onclick="handleSummarize()" class="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50 hidden">Regenerate</button>
      <button id="skip-btn" onclick="handleSkipSummary()" class="px-4 py-2 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600 hidden">Skip Summary</button>
    </div>
  </section>

  <!-- Status -->
  <div id="status-bar" class="text-xs text-gray-400 text-center pb-4"></div>
</main>

<!-- Completed Screen (hidden) -->
<div id="completed-screen" class="min-h-screen bg-gray-50 items-center justify-center hidden">
  <div class="text-center p-8">
    <svg class="w-16 h-16 mx-auto text-green-500 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
    <h1 class="text-2xl font-bold text-gray-800 mb-2">Session Complete</h1>
    <p class="text-gray-500">Results have been submitted. You can close this window.</p>
  </div>
</div>

<script>
// ─── Config ──────────────────────────────────────────────────────────────
const CFG = ${config};
const origin = location.origin;

// ─── State ───────────────────────────────────────────────────────────────
let queries = CFG.queries.map((q, i) => ({ queryIndex: i, query: q, answer: "", results: [], provider: CFG.defaultProvider, loading: true, error: null }));
let selected = new Set();
let phase = "SEARCHING";
let connected = false;
let summarizing = false;
let nextQI = CFG.queries.length;
let selectedModel = CFG.defaultSummaryModel || "";

// ─── DOM refs ────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const resultsList = $("results-list");
const queryCount = $("query-count");
const runningLabel = $("running-label");
const noQueries = $("no-queries");
const summarySection = $("summary-section");
const summaryEditor = $("summary-editor");
const summaryActions = $("summary-actions");
const summarizeBtn = $("summarize-btn");
const summaryText = $("summary-text");
const feedbackInput = $("feedback-input");
const selectedCount = $("selected-count");
const newQueryInput = $("new-query");
const providerSelect = $("provider-select");
const addBtn = $("add-btn");
const regenBtn = $("regen-btn");
const skipBtn = $("skip-btn");
const statusBar = $("status-bar");
const phaseEl = $("phase");

// ─── Helpers ─────────────────────────────────────────────────────────────
async function postJson(path, body) {
  const res = await fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: CFG.sessionToken, ...body }),
  });
  const data = await res.json();
  if (!data.ok && data.error) throw new Error(data.error);
  return data;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ─── Render ──────────────────────────────────────────────────────────────
function render() {
  queryCount.textContent = queries.length;

  // Running label
  const loading = queries.filter(q => q.loading).length;
  runningLabel.classList.toggle("hidden", loading === 0 || phase !== "SEARCHING");
  runningLabel.textContent = loading > 0 ? loading + " remaining..." : "";

  // No queries message
  noQueries.classList.toggle("hidden", queries.length > 0);

  // Phase
  phaseEl.textContent = phase.toLowerCase();

  // Summary section
  const hasSelection = selected.size > 0;
  summarySection.classList.toggle("hidden", !hasSelection);
  selectedCount.textContent = selected.size;

  // Status bar
  if (phase === "SEARCHING") {
    statusBar.textContent = queries.filter(q => q.loading).length + " remaining...";
  } else if (phase === "RESULT_SELECTION") {
    statusBar.textContent = "Select results and generate a summary, then submit.";
  } else {
    statusBar.textContent = "";
  }

  // Query cards
  let html = "";
  for (const q of queries) {
    const isSelected = selected.has(q.queryIndex);
    const isError = !!q.error;
    let cardClass = "border rounded-lg p-4 cursor-pointer transition-colors ";
    if (isError) cardClass += "border-red-300 bg-red-50";
    else if (isSelected) cardClass += "border-blue-500 bg-blue-50";
    else cardClass += "border-gray-200 hover:border-gray-300";

    html += '<div class="' + cardClass + '" onclick="toggleSelect(' + q.queryIndex + ')">';
    html += '<div class="flex items-start justify-between gap-2"><div class="flex-1 min-w-0">';
    html += '<div class="flex items-center gap-2">';
    html += '<span class="text-xs font-mono text-gray-400">#' + q.queryIndex + '</span>';
    html += '<h3 class="font-medium text-sm truncate">' + escapeHtml(q.query) + '</h3>';
    if (q.provider) html += '<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">' + escapeHtml(q.provider) + '</span>';
    html += '</div>';

    if (q.loading) {
      html += '<div class="flex items-center gap-2 mt-2 text-gray-400 text-sm"><svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Searching...</div>';
    } else if (q.error) {
      html += '<p class="mt-2 text-sm text-red-600">' + escapeHtml(q.error) + '</p>';
    } else if (q.results.length > 0) {
      if (q.answer) html += '<p class="text-sm text-gray-700 mb-2 line-clamp-3">' + escapeHtml(q.answer) + '</p>';
      html += '<div class="space-y-1">';
      for (const r of q.results.slice(0, 5)) {
        html += '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 truncate" onclick="event.stopPropagation()">';
        html += '<svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>';
        html += '<span class="truncate">' + escapeHtml(r.title) + '</span>';
        if (r.domain) html += '<span class="shrink-0 text-gray-300">(' + escapeHtml(r.domain) + ')</span>';
        html += '</a>';
      }
      if (q.results.length > 5) html += '<p class="text-xs text-gray-300">+' + (q.results.length - 5) + ' more</p>';
      html += '</div>';
    } else {
      html += '<p class="mt-2 text-sm text-gray-400">No results found</p>';
    }

    html += '</div><div class="shrink-0 mt-0.5">';
    if (isSelected) {
      html += '<svg class="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
    } else {
      html += '<div class="w-5 h-5 rounded-full border-2 border-gray-300"></div>';
    }
    html += '</div></div></div>';
  }
  resultsList.innerHTML = html;
}

function setConnection(c) {
  connected = c;
  const badge = $("conn-badge");
  const dot = $("conn-dot");
  const label = $("conn-label");
  if (c) {
    badge.className = "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700";
    dot.className = "w-1.5 h-1.5 rounded-full bg-green-500";
    label.textContent = "Connected";
  } else {
    badge.className = "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700";
    dot.className = "w-1.5 h-1.5 rounded-full bg-red-500";
    label.textContent = "Disconnected";
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────
function toggleSelect(qi) {
  if (phase === "COMPLETED") return;
  if (selected.has(qi)) selected.delete(qi); else selected.add(qi);
  render();
}
window.toggleSelect = toggleSelect;

async function handleAddQuery() {
  const q = newQueryInput.value.trim();
  if (!q) return;
  const provider = providerSelect.value;
  const qi = nextQI++;
  queries.push({ queryIndex: qi, query: q, answer: "", results: [], provider, loading: true, error: null });
  newQueryInput.value = "";
  addBtn.disabled = true;
  render();
  try {
    const data = await postJson("/search", { query: q, provider });
    const entry = queries.find(x => x.queryIndex === qi);
    if (!entry) return;
    if (data.error) { entry.error = data.error; }
    else { entry.answer = data.answer || ""; entry.results = data.results || []; entry.provider = data.provider || provider; }
    entry.loading = false;
  } catch (err) {
    const entry = queries.find(x => x.queryIndex === qi);
    if (entry) { entry.error = err.message; entry.loading = false; }
  }
  render();
}
window.handleAddQuery = handleAddQuery;

async function handleSummarize() {
  if (selected.size === 0) return;
  summarizeBtn.disabled = true;
  summarizeBtn.textContent = "Generating...";
  regenBtn.disabled = true;
  regenBtn.textContent = "Regenerating...";
  summarizing = true;
  try {
    const data = await postJson("/summarize", {
      selected: Array.from(selected),
      model: selectedModel || undefined,
      feedback: feedbackInput.value.trim() || undefined,
    });
    if (data.ok && data.summary) {
      summaryText.value = data.summary;
      summaryActions.classList.add("hidden");
      summaryEditor.classList.remove("hidden");
      regenBtn.classList.remove("hidden");
      skipBtn.classList.remove("hidden");
    } else {
      console.error("Summarize failed:", data.error);
    }
  } catch (err) {
    console.error("Summarize error:", err);
  } finally {
    summarizeBtn.disabled = false;
    summarizeBtn.textContent = "Generate Summary";
    regenBtn.disabled = false;
    regenBtn.textContent = "Regenerate";
    summarizing = false;
  }
}
window.handleSummarize = handleSummarize;

async function handleSubmit() {
  const summary = summaryText.value.trim();
  const summaryMeta = summary ? {
    model: selectedModel || null, durationMs: 0,
    tokenEstimate: Math.ceil(summary.length / 4), fallbackUsed: false
  } : undefined;
  await postJson("/submit", {
    selected: Array.from(selected),
    summary: summary || undefined,
    summaryMeta,
    rawResults: !summary,
  });
  showCompleted();
}
window.handleSubmit = handleSubmit;

async function handleSkipSummary() {
  await postJson("/submit", { selected: Array.from(selected), rawResults: true });
  showCompleted();
}
window.handleSkipSummary = handleSkipSummary;

async function handleCancel() {
  if (!confirm("Cancel curation session?")) return;
  await postJson("/cancel", { reason: "user" });
  showCompleted();
}
window.handleCancel = handleCancel;

function showCompleted() {
  phase = "COMPLETED";
  document.body.innerHTML = '';
  const screen = $("completed-screen");
  screen.classList.remove("hidden");
  screen.classList.add("flex");
  document.body.appendChild(screen);
  render();
}

// ─── SSE ─────────────────────────────────────────────────────────────────
const es = new EventSource(origin + "/events?session=" + CFG.sessionToken);
es.onopen = () => setConnection(true);
es.onerror = () => { setConnection(false); es.close(); };

es.addEventListener("result", (event) => {
  const data = JSON.parse(event.data);
  const existing = queries.find(q => q.queryIndex === data.queryIndex);
  if (existing) {
    existing.answer = data.answer; existing.results = data.results;
    existing.provider = data.provider; existing.loading = false;
  } else {
    queries.push({ queryIndex: data.queryIndex, query: data.query, answer: data.answer, results: data.results, provider: data.provider, loading: false, error: null });
  }
  render();
});

es.addEventListener("search-error", (event) => {
  const data = JSON.parse(event.data);
  const existing = queries.find(q => q.queryIndex === data.queryIndex);
  if (existing) { existing.error = data.error; existing.loading = false; }
  else { queries.push({ queryIndex: data.queryIndex, query: data.query, answer: "", results: [], provider: data.provider || CFG.defaultProvider, loading: false, error: data.error }); }
  render();
});

es.addEventListener("done", () => { phase = "RESULT_SELECTION"; render(); });

// ─── Heartbeat ───────────────────────────────────────────────────────────
setInterval(() => {
  fetch(origin + "/heartbeat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: CFG.sessionToken }),
  }).catch(() => {});
}, 10000);

// ─── Input binding ───────────────────────────────────────────────────────
newQueryInput.addEventListener("input", () => { addBtn.disabled = !newQueryInput.value.trim(); });
newQueryInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && newQueryInput.value.trim()) handleAddQuery(); });

// ─── Init ────────────────────────────────────────────────────────────────
render();
<\/script>
</body>
</html>`;
}

function providerOptions(providers: { perplexity: boolean; exa: boolean; gemini: boolean }): string {
    const entries = Object.entries(providers).filter(([, v]) => v) as [string, boolean][];
    return entries.map(([name]) => `<option value="${name}">${name}</option>`).join("\n        ");
}

function summaryModelSelect(models: Array<{ value: string; label: string }>): string {
    if (models.length === 0) return "";
    const modelOptions = models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("\n        ");
    const options = `<option value="">Default model</option>\n${modelOptions}`;
    return `<select id="model-select" class="px-3 py-2 border rounded-md text-sm bg-white" onchange="selectedModel=this.value">${options}</select>`;
}

export type { CuratorHTMLOptions };
