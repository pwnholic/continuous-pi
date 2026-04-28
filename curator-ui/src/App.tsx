import { useCallback, useEffect, useRef, useState } from "react";
import { useCurator } from "./hooks/useCurator";
import { SearchResultCard } from "./components/SearchResultCard";
import type { ServerOptions, SummaryModel } from "./types";

declare global {
    interface Window {
        __CURATOR_OPTIONS__?: ServerOptions;
    }
}

function SpinnerIcon({ className }: { className?: string }) {
    return (
        <svg className={className ?? "w-4 h-4 animate-spin"} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main App
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
    const options = window.__CURATOR_OPTIONS__;
    if (!options) {
        return <div className="p-8 text-center text-red-500">Error: Server options not found</div>;
    }

    const { queries, state, addQuery, toggleSelect, selectedIndices, submit, cancel, connected } = useCurator(
        options.sessionToken,
        window.location.origin,
        options.queries,
        options.defaultProvider,
    );

    // ── State ─────────────────────────────────────────────────────────────────

    const [newQuery, setNewQuery] = useState("");
    const [customProvider, setCustomProvider] = useState(options.defaultProvider);
    const [summary, setSummary] = useState("");
    const [selectedModel, setSelectedModel] = useState(options.defaultSummaryModel ?? "");
    const [feedback, setFeedback] = useState("");
    const [summarizing, setSummarizing] = useState(false);
    const [showSummaryEditor, setShowSummaryEditor] = useState(false);
    const summaryEditorRef = useRef<HTMLTextAreaElement>(null);

    const hasResults = queries.some((q) => !q.loading && !q.error);
    const allDone = queries.every((q) => !q.loading);
    const isComplete = state === "COMPLETED";

    // ── Heartbeat ──────────────────────────────────────────────────────────────

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                await fetch(window.location.origin + "/heartbeat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: options.sessionToken }),
                });
            } catch {
                // ignore
            }
        }, 10000);
        return () => clearInterval(interval);
    }, [options.sessionToken]);

    // ── Summarize ──────────────────────────────────────────────────────────────

    const handleSummarize = useCallback(async () => {
        if (selectedIndices.length === 0) return;
        setSummarizing(true);
        try {
            const res = await fetch(window.location.origin + "/summarize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: options.sessionToken,
                    selected: selectedIndices,
                    model: selectedModel || undefined,
                    feedback: feedback || undefined,
                }),
            });
            const data = (await res.json()) as { ok?: boolean; summary?: string; error?: string };
            if (data.ok && data.summary) {
                setSummary(data.summary);
                setShowSummaryEditor(true);
            } else {
                console.error("Summarize failed:", data.error);
            }
        } catch (err) {
            console.error("Summarize error:", err);
        } finally {
            setSummarizing(false);
        }
    }, [selectedIndices, selectedModel, feedback, options.sessionToken]);

    // ── Submit ─────────────────────────────────────────────────────────────────

    const handleSubmit = useCallback(async () => {
        const finalSummary = summary.trim() || undefined;
        await submit({
            selected: selectedIndices,
            summary: finalSummary,
            summaryMeta: finalSummary
                ? { model: selectedModel || null, durationMs: 0, tokenEstimate: Math.ceil(finalSummary.length / 4), fallbackUsed: false }
                : undefined,
            rawResults: !finalSummary,
        });
    }, [selectedIndices, summary, selectedModel, submit]);

    // ── Cancel ─────────────────────────────────────────────────────────────────

    const handleCancel = useCallback(async () => {
        if (window.confirm("Cancel curation session?")) {
            await cancel();
        }
    }, [cancel]);

    // ── Render ─────────────────────────────────────────────────────────────────

    if (isComplete) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center p-8">
                    <svg className="w-16 h-16 mx-auto text-green-500 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">Session Complete</h1>
                    <p className="text-gray-500">Results have been submitted. You can close this window.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-bold text-gray-800">Web Search Curator</h1>
                        <span
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                                connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                            }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
                            {connected ? "Connected" : "Disconnected"}
                        </span>
                        <span className="text-xs text-gray-400">
                            Phase: <span className="font-mono">{state.toLowerCase()}</span>
                        </span>
                    </div>
                    <button
                        onClick={handleCancel}
                        className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                </div>
            </header>

            <main className="max-w-5xl mx-auto p-4 space-y-6">
                {/* ── Search Results ──────────────────────────────────────────── */}
                <section>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                            Search Results ({queries.length})
                        </h2>
                        {state === "SEARCHING" && !allDone && (
                            <span className="text-sm text-gray-400 animate-pulse">Running searches...</span>
                        )}
                    </div>

                    <div className="space-y-2">
                        {queries.map((q) => (
                            <SearchResultCard
                                key={q.queryIndex}
                                query={q}
                                selected={selectedIndices.includes(q.queryIndex)}
                                onToggleSelect={() => toggleSelect(q.queryIndex)}
                            />
                        ))}
                        {queries.length === 0 && (
                            <p className="text-sm text-gray-400 text-center py-8">No search queries yet.</p>
                        )}
                    </div>
                </section>

                {/* ── Add Query ───────────────────────────────────────────────── */}
                <section className="bg-white border rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Add Search Query</h3>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newQuery}
                            onChange={(e) => setNewQuery(e.target.value)}
                            placeholder="Enter a search query..."
                            className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && newQuery.trim()) {
                                    addQuery(newQuery.trim(), customProvider);
                                    setNewQuery("");
                                }
                            }}
                        />
                        <select
                            value={customProvider}
                            onChange={(e) => setCustomProvider(e.target.value)}
                            className="px-3 py-2 border rounded-md text-sm bg-white"
                        >
                            {Object.entries(options.availableProviders)
                                .filter(([_, available]) => available)
                                .map(([name]) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                        </select>
                        <button
                            onClick={() => {
                                if (newQuery.trim()) {
                                    addQuery(newQuery.trim(), customProvider);
                                    setNewQuery("");
                                }
                            }}
                            disabled={!newQuery.trim()}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Search
                        </button>
                    </div>
                </section>

                {/* ── Summary Editor ──────────────────────────────────────────── */}
                {selectedIndices.length > 0 && (
                    <section className="bg-white border rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">
                            Summary ({selectedIndices.length} queries selected)
                        </h3>

                        <div className="space-y-3">
                            {!showSummaryEditor && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSummarize}
                                        disabled={summarizing}
                                        className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                                    >
                                        {summarizing ? (
                                            <span className="flex items-center gap-2">
                                                <SpinnerIcon className="w-4 h-4" />
                                                Generating...
                                            </span>
                                        ) : (
                                            "Generate Summary"
                                        )}
                                    </button>

                                    {options.summaryModels.length > 0 && (
                                        <select
                                            value={selectedModel}
                                            onChange={(e) => setSelectedModel(e.target.value)}
                                            className="px-3 py-2 border rounded-md text-sm bg-white"
                                        >
                                            <option value="">Default model</option>
                                            {options.summaryModels.map((m) => (
                                                <option key={m.value} value={m.value}>
                                                    {m.label}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}

                            {showSummaryEditor && (
                                <div className="space-y-2">
                                    <textarea
                                        ref={summaryEditorRef}
                                        value={summary}
                                        onChange={(e) => setSummary(e.target.value)}
                                        className="w-full h-40 px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                                    />
                                    <input
                                        type="text"
                                        value={feedback}
                                        onChange={(e) => setFeedback(e.target.value)}
                                        placeholder="Feedback for model (optional)..."
                                        className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            )}
                        </div>

                        {/* ── Submit / Regenerate ─────────────────────────────── */}
                        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                            <button
                                onClick={handleSubmit}
                                className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                            >
                                Submit Results
                            </button>
                            {showSummaryEditor && (
                                <>
                                    <button
                                        onClick={handleSummarize}
                                        disabled={summarizing}
                                        className="px-4 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50"
                                    >
                                        {summarizing ? "Regenerating..." : "Regenerate"}
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await submit({ selected: selectedIndices, rawResults: true });
                                        }}
                                        className="px-4 py-2 bg-gray-500 text-white rounded-md text-sm hover:bg-gray-600"
                                    >
                                        Skip Summary
                                    </button>
                                </>
                            )}
                        </div>
                    </section>
                )}

                {/* ── Status Bar ──────────────────────────────────────────────── */}
                <div className="text-xs text-gray-400 text-center pb-4">
                    {state === "SEARCHING"
                        ? `${queries.filter((q) => q.loading).length} remaining...`
                        : state === "RESULT_SELECTION"
                          ? "Select results and generate a summary, then submit."
                          : ""}
                </div>
            </main>
        </div>
    );
}
