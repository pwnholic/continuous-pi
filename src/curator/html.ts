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

// ─── Color Tokens ────────────────────────────────────────────────────────────

const COLORS = {
    dark: {
        bg: "#212121",
        surface: "#2f2f2f",
        surfaceHover: "#3a3a3a",
        surfaceActive: "#383838",
        border: "#444",
        text: "#ececec",
        textSecondary: "#b4b4b4",
        textMuted: "#8e8e8e",
        accent: "#8ab4f8",
        accentBg: "#1a3a5c",
        success: "#81c995",
        successBg: "#1b3a28",
        error: "#f28b82",
        errorBg: "#3a1b1b",
        warning: "#fdd663",
        inputBg: "#2f2f2f",
        inputBorder: "#555",
        headerBg: "#171717",
        btnPrimary: "#8ab4f8",
        btnPrimaryText: "#171717",
        btnSecondary: "#444",
        btnSecondaryText: "#ececec",
        btnDanger: "#5a2020",
        btnDangerText: "#f28b82",
        spinner: "#8ab4f8",
    },
    light: {
        bg: "#f7f7f8",
        surface: "#ffffff",
        surfaceHover: "#f0f0f0",
        surfaceActive: "#e8e8e8",
        border: "#e5e5e5",
        text: "#1a1a1a",
        textSecondary: "#555",
        textMuted: "#999",
        accent: "#1a7f64",
        accentBg: "#e6f5f0",
        success: "#1a7f37",
        successBg: "#e6f5ee",
        error: "#cf222e",
        errorBg: "#ffebe9",
        warning: "#9a6700",
        inputBg: "#ffffff",
        inputBorder: "#d0d7de",
        headerBg: "#ffffff",
        btnPrimary: "#1a7f64",
        btnPrimaryText: "#ffffff",
        btnSecondary: "#e5e5e5",
        btnSecondaryText: "#1a1a1a",
        btnDanger: "#ffebe9",
        btnDangerText: "#cf222e",
        spinner: "#1a7f64",
    },
};

// ─── HTML Generator ──────────────────────────────────────────────────────────

export function renderCuratorHTML(options: CuratorHTMLOptions): string {
    const config = JSON.stringify(options);
    const colorsDark = JSON.stringify(COLORS.dark);
    const colorsLight = JSON.stringify(COLORS.light);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Web Search Curator</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root { ${cssVars(COLORS.dark)} }

  [data-theme="light"] { ${cssVars(COLORS.light)} }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
    background: var(--c-bg);
    color: var(--c-text);
    line-height: 1.6;
    min-height: 100vh;
    transition: background .2s, color .2s;
  }

  a { color: var(--c-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  button {
    font-family: inherit; font-size: 0.8125rem; cursor: pointer;
    border: none; border-radius: 8px; padding: 8px 16px; font-weight: 500;
    transition: opacity .15s, transform .1s;
  }
  button:active { transform: scale(.97); }
  button:disabled { opacity: .4; cursor: not-allowed; transform: none; }

  input, select, textarea {
    font-family: inherit; font-size: 0.875rem;
    background: var(--c-inputBg); color: var(--c-text);
    border: 1px solid var(--c-inputBorder); border-radius: 8px;
    padding: 8px 12px; outline: none; transition: border-color .15s;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--c-accent); }

  .btn-primary { background: var(--c-btnPrimary); color: var(--c-btnPrimaryText); }
  .btn-primary:hover:not(:disabled) { opacity: .85; }
  .btn-secondary { background: var(--c-btnSecondary); color: var(--c-btnSecondaryText); }
  .btn-secondary:hover:not(:disabled) { opacity: .85; }
  .btn-danger { background: var(--c-btnDanger); color: var(--c-btnDangerText); }

  .spinner {
    width: 18px; height: 18px; border: 2px solid var(--c-border);
    border-top-color: var(--c-spinner); border-radius: 50%;
    animation: spin .7s linear infinite; display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .header {
    position: sticky; top: 0; z-index: 50;
    background: var(--c-headerBg); border-bottom: 1px solid var(--c-border);
    backdrop-filter: blur(12px);
  }
  .header-inner {
    max-width: 768px; margin: 0 auto; padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo {
    width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
    background: linear-gradient(135deg, var(--c-accent), #c084fc);
    display: flex; align-items: center; justify-content: center;
  }
  .logo svg { width: 16px; height: 16px; }
  .header-title { font-size: 0.9375rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.6875rem; font-weight: 500; padding: 3px 8px; border-radius: 999px;
  }
  .badge-connected { background: var(--c-successBg); color: var(--c-success); }
  .badge-disconnected { background: var(--c-errorBg); color: var(--c-error); }
  .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

  .phase-badge {
    font-size: 0.6875rem; padding: 3px 8px; border-radius: 999px;
    background: var(--c-surface); color: var(--c-textMuted); font-family: monospace;
  }

  .theme-toggle {
    width: 32px; height: 32px; padding: 0; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: var(--c-surface); color: var(--c-textMuted); border: 1px solid var(--c-border);
  }
  .theme-toggle:hover { color: var(--c-text); }

  /* ── Main Container ─────────────────────────────────────────────────────── */
  .container { max-width: 768px; margin: 0 auto; padding: 16px; }

  /* ── Result Card ────────────────────────────────────────────────────────── */
  .card {
    background: var(--c-surface); border: 1px solid var(--c-border);
    border-radius: 12px; padding: 14px 16px; cursor: pointer;
    transition: border-color .15s, background .15s; animation: fadeIn .3s ease;
  }
  .card:hover { border-color: var(--c-textMuted); }
  .card.selected { border-color: var(--c-accent); background: var(--c-accentBg); }
  .card.error { border-color: var(--c-error); background: var(--c-errorBg); }

  .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .card-body { flex: 1; min-width: 0; }
  .card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .card-index { font-size: 0.6875rem; font-family: monospace; color: var(--c-textMuted); }
  .card-query { font-size: 0.875rem; font-weight: 500; }
  .card-provider {
    font-size: 0.625rem; padding: 2px 6px; border-radius: 4px;
    background: var(--c-surfaceHover); color: var(--c-textMuted); text-transform: uppercase; letter-spacing: .3px;
  }

  .card-answer { font-size: 0.8125rem; color: var(--c-textSecondary); margin-top: 8px; line-height: 1.55; }
  .card-answer.clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

  .card-sources { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; }
  .card-source {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.75rem; color: var(--c-textMuted); overflow: hidden;
  }
  .card-source svg { width: 12px; height: 12px; flex-shrink: 0; }
  .card-source span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .card-check {
    flex-shrink: 0; width: 20px; height: 20px; margin-top: 2px;
    border: 2px solid var(--c-border); border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    transition: all .15s;
  }
  .selected .card-check { border-color: var(--c-accent); background: var(--c-accent); }
  .selected .card-check svg { opacity: 1; }
  .card-check svg { width: 12px; height: 12px; opacity: 0; color: var(--c-btnPrimaryText); }

  .card-loading { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--c-textMuted); font-size: 0.8125rem; }
  .card-error-text { margin-top: 8px; font-size: 0.8125rem; color: var(--c-error); }
  .card-empty { margin-top: 8px; font-size: 0.8125rem; color: var(--c-textMuted); }

  /* ── Section ────────────────────────────────────────────────────────────── */
  .section-label {
    font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: .5px; color: var(--c-textMuted); margin-bottom: 8px;
  }

  /* ── Add Query Bar ──────────────────────────────────────────────────────── */
  .add-bar {
    background: var(--c-surface); border: 1px solid var(--c-border);
    border-radius: 16px; padding: 8px 12px; display: flex; align-items: center; gap: 8px;
  }
  .add-bar input { flex: 1; border: none; background: transparent; padding: 4px 0; font-size: 0.875rem; }
  .add-bar input:focus { border: none; outline: none; }
  .add-bar select {
    border: none; background: var(--c-surfaceHover); padding: 6px 10px;
    border-radius: 8px; font-size: 0.75rem; color: var(--c-textSecondary); cursor: pointer;
  }
  .add-bar button { flex-shrink: 0; padding: 6px 14px; font-size: 0.8125rem; }

  /* ── Summary Panel ──────────────────────────────────────────────────────── */
  .summary-panel {
    background: var(--c-surface); border: 1px solid var(--c-border);
    border-radius: 12px; padding: 16px; animation: fadeIn .3s ease;
  }
  .summary-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .summary-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .summary-editor textarea {
    width: 100%; min-height: 120px; resize: vertical; font-size: 0.8125rem;
    line-height: 1.6; border-radius: 10px; padding: 10px 14px;
  }
  .summary-footer { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--c-border); flex-wrap: wrap; }

  /* ── Status ─────────────────────────────────────────────────────────────── */
  .status { text-align: center; padding: 16px; font-size: 0.75rem; color: var(--c-textMuted); }

  /* ── Completed Screen ────────────────────────────────────────────────────── */
  .completed {
    display: flex; align-items: center; justify-content: center; min-height: 100vh;
    text-align: center; padding: 24px;
  }
  .completed h1 { font-size: 1.5rem; font-weight: 600; margin-top: 16px; }
  .completed p { color: var(--c-textSecondary); margin-top: 8px; }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .header-inner { padding: 10px 12px; }
    .header-title { font-size: 0.8125rem; }
    .container { padding: 12px; }
    .card { padding: 12px; }
    .add-bar { border-radius: 12px; padding: 6px 8px; flex-wrap: wrap; }
    .add-bar input { min-width: 0; flex: 1 1 100%; order: -1; margin-bottom: 4px; }
    .add-bar select { flex: 1; }
    .add-bar button { flex: 1; }
    .summary-footer { flex-direction: column; }
    .summary-footer button { width: 100%; }
    .phase-badge { display: none; }
  }
</style>
</head>
<body>
<div id="app">
  <header class="header">
    <div class="header-inner">
      <div class="header-left">
        <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
        <span class="header-title">Curator</span>
        <span id="conn-badge" class="badge badge-disconnected"><span class="badge-dot"></span><span id="conn-text">Connecting</span></span>
        <span id="phase-badge" class="phase-badge">searching</span>
      </div>
      <div class="header-right">
        <button id="theme-btn" class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">
          <svg id="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg id="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
        <button class="btn-danger" onclick="handleCancel()" style="font-size:0.75rem;padding:5px 10px">Cancel</button>
      </div>
    </div>
  </header>

  <div class="container">
    <div id="results-area"></div>
    <p id="no-results" style="text-align:center;padding:32px 0;color:var(--c-textMuted);font-size:0.875rem;display:none">No search queries yet.</p>

    <div style="margin-top:16px">
      <div class="section-label">Search</div>
      <div class="add-bar">
        <input id="new-query" type="text" placeholder="Ask anything..." onkeydown="if(event.key==='Enter')handleAddQuery()">
        <select id="provider-select">${providerOptions(options.availableProviders)}</select>
        <button class="btn-primary" onclick="handleAddQuery()">Search</button>
      </div>
    </div>

    <div id="summary-area" style="margin-top:16px;display:none">
      <div class="section-label">Summary &middot; <span id="sel-count">0</span> selected</div>
      <div class="summary-panel">
        <div class="summary-header">
          <div class="summary-actions">
            <button class="btn-primary" onclick="handleSummarize()" id="summarize-btn">Generate Summary</button>
            ${summaryModelSelect(options.summaryModels)}
          </div>
        </div>
        <div id="summary-editor" style="display:none">
          <textarea id="summary-text" placeholder="Summary will appear here..."></textarea>
          <input id="feedback-input" type="text" placeholder="Feedback for model (optional)..." style="width:100%;margin-top:8px">
        </div>
        <div class="summary-footer">
          <button class="btn-primary" onclick="handleSubmit()">Submit Results</button>
          <button id="regen-btn" class="btn-secondary" onclick="handleSummarize()" style="display:none">Regenerate</button>
          <button id="skip-btn" class="btn-secondary" onclick="handleSkipSummary()" style="display:none">Skip Summary</button>
        </div>
      </div>
    </div>

    <div id="status-bar" class="status"></div>
  </div>
</div>

<div id="completed-screen" class="completed" style="display:none">
  <div>
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--c-success)" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
    <h1>Session Complete</h1>
    <p>Results submitted. You can close this window.</p>
  </div>
</div>

<script>
const CFG = ${config};
const C = ${colorsDark};
const CL = ${colorsLight};
const origin = location.origin;

// ─── State ───────────────────────────────────────────────────────────────
let queries = CFG.queries.map((q, i) => ({ queryIndex: i, query: q, answer: "", results: [], provider: CFG.defaultProvider, loading: true, error: null }));
let selected = new Set();
let phase = "SEARCHING";
let connected = false;
let summarizing = false;
let nextQI = CFG.queries.length;
let selectedModel = CFG.defaultSummaryModel || "";
let isDark = true;

// ─── Theme ───────────────────────────────────────────────────────────────
function applyTheme(dark) {
  isDark = dark;
  document.documentElement.setAttribute("data-theme", dark ? "" : "light");
  document.getElementById("icon-moon").style.display = dark ? "none" : "block";
  document.getElementById("icon-sun").style.display = dark ? "block" : "none";
}
function toggleTheme() { applyTheme(!isDark); }
window.toggleTheme = toggleTheme;
applyTheme(true);

// ─── Helpers ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function postJson(path, body) {
  const res = await fetch(origin + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: CFG.sessionToken, ...body }),
  });
  const data = await res.json();
  if (!data.ok && data.error) throw new Error(data.error);
  return data;
}

function globeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/></svg>';
}
function checkIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
}

// ─── Render ──────────────────────────────────────────────────────────────
function render() {
  // Connection
  const badge = $("conn-badge");
  badge.className = "badge " + (connected ? "badge-connected" : "badge-disconnected");
  $("conn-text").textContent = connected ? "Live" : "Offline";

  // Phase
  $("phase-badge").textContent = phase.toLowerCase();

  // Results
  const area = $("results-area");
  let html = "";
  for (const q of queries) {
    const sel = selected.has(q.queryIndex);
    const err = !!q.error;
    let cls = "card";
    if (err) cls += " error";
    else if (sel) cls += " selected";

    html += '<div class="' + cls + '" onclick="toggleSelect(' + q.queryIndex + ')">';
    html += '<div class="card-header"><div class="card-body">';

    // Meta row
    html += '<div class="card-meta">';
    html += '<span class="card-index">#' + q.queryIndex + '</span>';
    html += '<span class="card-query">' + esc(q.query) + '</span>';
    if (q.provider) html += '<span class="card-provider">' + esc(q.provider) + '</span>';
    html += '</div>';

    // Content
    if (q.loading) {
      html += '<div class="card-loading"><span class="spinner"></span>Searching...</div>';
    } else if (q.error) {
      html += '<div class="card-error-text">' + esc(q.error) + '</div>';
    } else if (q.results.length > 0) {
      if (q.answer) html += '<div class="card-answer clamp">' + esc(q.answer) + '</div>';
      html += '<div class="card-sources">';
      for (const r of q.results.slice(0, 5)) {
        html += '<a class="card-source" href="' + esc(r.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + globeIcon() + '<span>' + esc(r.title) + '</span></a>';
      }
      if (q.results.length > 5) html += '<span class="card-source" style="color:var(--c-textMuted)">+' + (q.results.length - 5) + ' more</span>';
      html += '</div>';
    } else {
      html += '<div class="card-empty">No results found</div>';
    }

    html += '</div><div class="card-check">' + checkIcon() + '</div></div></div>';
  }
  area.innerHTML = html;

  $("no-results").style.display = queries.length === 0 ? "block" : "none";

  // Summary section
  const sa = $("summary-area");
  if (selected.size > 0) {
    sa.style.display = "block";
    $("sel-count").textContent = selected.size;
  } else {
    sa.style.display = "none";
  }

  // Status bar
  const loading = queries.filter(q => q.loading).length;
  const sb = $("status-bar");
  if (phase === "SEARCHING" && loading > 0) sb.textContent = loading + " search" + (loading > 1 ? "es" : "") + " in progress...";
  else if (phase === "RESULT_SELECTION") sb.textContent = "Select results and generate a summary to submit.";
  else sb.textContent = "";
}

// ─── Actions ─────────────────────────────────────────────────────────────
function toggleSelect(qi) {
  if (phase === "COMPLETED") return;
  if (selected.has(qi)) selected.delete(qi); else selected.add(qi);
  render();
}
window.toggleSelect = toggleSelect;

async function handleAddQuery() {
  const inp = $("new-query");
  const q = inp.value.trim();
  if (!q) return;
  const provider = $("provider-select").value;
  const qi = nextQI++;
  queries.push({ queryIndex: qi, query: q, answer: "", results: [], provider, loading: true, error: null });
  inp.value = "";
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
  const btn = $("summarize-btn");
  const regen = $("regen-btn");
  btn.disabled = true; btn.textContent = "Generating...";
  regen.disabled = true;
  summarizing = true;
  try {
    const data = await postJson("/summarize", {
      selected: Array.from(selected), model: selectedModel || undefined,
      feedback: $("feedback-input").value.trim() || undefined,
    });
    if (data.ok && data.summary) {
      $("summary-text").value = data.summary;
      $("summary-editor").style.display = "block";
      $("summary-actions").style.display = "none";
      regen.style.display = "inline-block";
      $("skip-btn").style.display = "inline-block";
    }
  } catch (err) { console.error("Summarize error:", err); }
  finally { btn.disabled = false; btn.textContent = "Generate Summary"; regen.disabled = false; summarizing = false; }
}
window.handleSummarize = handleSummarize;

async function handleSubmit() {
  const s = $("summary-text").value.trim();
  const meta = s ? { model: selectedModel || null, durationMs: 0, tokenEstimate: Math.ceil(s.length / 4), fallbackUsed: false } : undefined;
  await postJson("/submit", { selected: Array.from(selected), summary: s || undefined, summaryMeta: meta, rawResults: !s });
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
  $("app").style.display = "none";
  $("completed-screen").style.display = "flex";
}

// ─── SSE ─────────────────────────────────────────────────────────────────
const es = new EventSource(origin + "/events?session=" + CFG.sessionToken);
es.onopen = () => { connected = true; render(); };
es.onerror = () => { connected = false; es.close(); render(); };
es.addEventListener("result", (e) => {
  const d = JSON.parse(e.data);
  const ex = queries.find(q => q.queryIndex === d.queryIndex);
  if (ex) { ex.answer = d.answer; ex.results = d.results; ex.provider = d.provider; ex.loading = false; }
  else queries.push({ queryIndex: d.queryIndex, query: d.query, answer: d.answer, results: d.results, provider: d.provider, loading: false, error: null });
  render();
});
es.addEventListener("search-error", (e) => {
  const d = JSON.parse(e.data);
  const ex = queries.find(q => q.queryIndex === d.queryIndex);
  if (ex) { ex.error = d.error; ex.loading = false; }
  else queries.push({ queryIndex: d.queryIndex, query: d.query, answer: "", results: [], provider: d.provider || CFG.defaultProvider, loading: false, error: d.error });
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

render();
<\/script>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cssVars(colors: Record<string, string>): string {
    return Object.entries(colors)
        .map(([key, val]) => `--c-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${val};`)
        .join(" ");
}

function providerOptions(providers: { perplexity: boolean; exa: boolean; gemini: boolean }): string {
    const entries = Object.entries(providers).filter(([, v]) => v) as [string, boolean][];
    return entries.map(([name]) => `<option value="${name}">${name}</option>`).join("\n        ");
}

function summaryModelSelect(models: Array<{ value: string; label: string }>): string {
    if (models.length === 0) return "";
    const modelOptions = models.map((m) => `<option value="${m.value}">${m.label}</option>`).join("\n        ");
    const options = `<option value="">Default model</option>\n${modelOptions}`;
    return `<select id="model-select" onchange="selectedModel=this.value" style="font-size:0.75rem;padding:5px 8px;border-radius:6px;background:var(--c-surfaceHover);color:var(--c-textSecondary);border:none;cursor:pointer">${options}</select>`;
}

export type { CuratorHTMLOptions };
