/**
 * ──────────────────────────────────────────────
 *  UI — Search Results Rendering
 * ──────────────────────────────────────────────
 * Formats and renders web search results for
 * display in the Pi TUI (terminal UI).
 *
 * Functions in this module produce plain-text /
 * formatted output strings that the entry-point
 * tool handlers return to the Pi runtime.
 *
 * @module ui/search-results
 */

import type { IQueryResultData } from "../storage.js";
import type { IAttributedSearchResponse } from "../types/search.js";

// ── Display constants ──────────────────────────

const MAX_SOURCES_SHOWN = 15;
const MAX_ANSWER_PREVIEW = 500;

// ── Colour / style helpers ─────────────────────

export interface ThemeAPI {
    bold: (s: string) => string;
    fg: (color: string, s: string) => string;
    dim: (s: string) => string;
    success: (s: string) => string;
    error: (s: string) => string;
    muted: (s: string) => string;
    accent: (s: string) => string;
    warning: (s: string) => string;
}

// ── Provider label helpers ─────────────────────

const PROVIDER_LABELS: Record<string, string> = {
    exa: "Exa",
    perplexity: "Perplexity",
    gemini: "Gemini",
};

function providerLabel(provider: string | undefined): string {
    return PROVIDER_LABELS[provider ?? ""] ?? provider ?? "unknown";
}

// ── Single query formatting ────────────────────

export interface IFormattedQueryResult {
    readonly header: string;
    readonly answer: string;
    readonly sources: string;
    readonly error: string | null;
    readonly provider: string;
}

/**
 * Format a single query result into structured components.
 */
export function formatQueryResult(result: IQueryResultData, index: number): IFormattedQueryResult {
    const provider = providerLabel(result.provider);
    const header = `Query ${index + 1}: ${result.query} (${provider})`;

    if (result.error) {
        return {
            header,
            answer: "",
            sources: "",
            error: result.error,
            provider: result.provider ?? "unknown",
        };
    }

    // Truncate long answers for preview
    const answer =
        result.answer.length > MAX_ANSWER_PREVIEW
            ? `${result.answer.slice(0, MAX_ANSWER_PREVIEW)}\n\n[... truncated ...]`
            : result.answer;

    // Format sources
    const visible = result.results.slice(0, MAX_SOURCES_SHOWN);
    const sources = visible.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n");

    if (result.results.length > MAX_SOURCES_SHOWN) {
        const remaining = result.results.length - MAX_SOURCES_SHOWN;
        return {
            header,
            answer,
            sources: `${sources}\n... and ${remaining} more sources`,
            error: null,
            provider: result.provider ?? "unknown",
        };
    }

    return {
        header,
        answer,
        sources,
        error: null,
        provider: result.provider ?? "unknown",
    };
}

// ── Full search response formatting ────────────

export interface ISearchDisplayResult {
    readonly markdown: string;
    readonly summary: string;
    readonly sourceCount: number;
}

/**
 * Build a complete markdown-formatted search result from
 * an attributed search response (single query).
 */
export function formatSearchResponse(
    response: IAttributedSearchResponse,
    query: string,
): ISearchDisplayResult {
    const provider = providerLabel(response.provider);
    const sourceCount = response.results.length;

    const sources = response.results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n");

    const markdown = [
        `# ${provider} Search Results`,
        "",
        `**Query:** ${query}`,
        "",
        response.answer,
        "",
        "---",
        "",
        `**Sources (${sourceCount}):**`,
        "",
        sources,
    ].join("\n");

    const summary = `${provider}: ${response.answer.replace(/\s+/g, " ").trim().slice(0, 120)}...`;

    return { markdown, summary, sourceCount };
}

// ── Multi-query aggregation ────────────────────

/**
 * Aggregate multiple query results into a single markdown document.
 */
export function formatMultiQueryResults(
    results: readonly IQueryResultData[],
): ISearchDisplayResult {
    const parts: string[] = [];
    let totalSources = 0;
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
        const qr = results[i]!;
        const formatted = formatQueryResult(qr, i);

        if (formatted.error) {
            failed += 1;
            parts.push(`## ${formatted.header}`);
            parts.push("");
            parts.push(`**Error:** ${formatted.error}`);
            parts.push("");
        } else {
            successful += 1;
            totalSources += qr.results.length;
            parts.push(`## ${formatted.header}`);
            parts.push("");
            parts.push(formatted.answer);
            parts.push("");
            parts.push("### Sources");
            parts.push(formatted.sources);
            parts.push("");
        }

        if (i < results.length - 1) {
            parts.push("---");
            parts.push("");
        }
    }

    const markdown = parts.join("\n");
    const summary = `${successful} successful, ${failed} failed, ${totalSources} total sources`;

    return { markdown, summary, sourceCount: totalSources };
}

// ── Summary rendering (for curator) ────────────

/**
 * Format a summary for display in the curator or tool output.
 */
export function formatSummary(
    summaryText: string,
    meta?: { model?: string | null; durationMs?: number; tokenEstimate?: number },
): string {
    const parts: string[] = [];

    parts.push(summaryText);
    parts.push("");

    if (meta) {
        const metaParts: string[] = [];
        if (meta.model) {
            metaParts.push(`Model: ${meta.model}`);
        }
        if (meta.durationMs != null) {
            metaParts.push(`Duration: ${(meta.durationMs / 1000).toFixed(1)}s`);
        }
        if (meta.tokenEstimate) {
            metaParts.push(`Tokens: ~${meta.tokenEstimate}`);
        }
        if (metaParts.length > 0) {
            parts.push(`*${metaParts.join(" · ")}*`);
        }
    }

    return parts.join("\n");
}

// ── Tool-call rendering (for TUI) ──────────────

/**
 * Compact one-line representation of a search tool call,
 * used in the TUI's conversation history.
 */
export function renderSearchCall(
    query: string | undefined,
    queries: readonly string[] | undefined,
    theme: ThemeAPI,
): string {
    const display = query ?? queries?.[0] ?? "(no query)";
    const truncated = display.length > 70 ? `${display.slice(0, 67)}...` : display;
    return theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("accent", truncated);
}

/**
 * Expansive rendering of a search result for the TUI detail panel.
 */
export function renderSearchResult(
    details: {
        queries?: readonly string[];
        queryCount?: number;
        responseId?: string;
        provider?: string;
        resultCount?: number;
        error?: string;
    },
    expanded: boolean,
    theme: ThemeAPI,
): string {
    if (details.error) {
        return theme.fg("error", `Error: ${details.error}`);
    }

    const summary = `${theme.fg("success", `${details.provider ?? "search"} · ${details.resultCount ?? 0} results`)}`;
    if (!expanded) {
        return summary;
    }

    const lines: string[] = [summary, ""];

    if (details.queries && details.queries.length > 0) {
        lines.push(theme.fg("accent", "Queries:"));
        for (const q of details.queries) {
            lines.push(`  ${theme.fg("dim", q)}`);
        }
        lines.push("");
    }

    lines.push(theme.fg("muted", `Response ID: ${details.responseId ?? "—"}`));
    lines.push(theme.fg("muted", `Provider: ${details.provider ?? "—"}`));
    lines.push(theme.fg("muted", `Results: ${details.resultCount ?? 0}`));

    return lines.join("\n");
}

// ── Detection / duplicate helpers ──────────────

/**
 * Check whether multiple queries are structurally similar
 * (same wording, same intent) to warn about redundant searches.
 */
export function findDuplicateQueries(queries: readonly string[]): string[][] {
    const normalized = queries.map((q, i) => ({
        index: i,
        original: q,
        normalised: q.toLowerCase().replace(/\s+/g, " ").trim(),
    }));

    const groups: string[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < normalized.length; i++) {
        if (assigned.has(i)) {
            continue;
        }
        const group = [normalized[i]!.original];
        assigned.add(i);

        for (let j = i + 1; j < normalized.length; j++) {
            if (assigned.has(j)) {
                continue;
            }

            // Check if queries are very similar (>80% character overlap)
            const a = normalized[i]!.normalised;
            const b = normalized[j]!.normalised;
            const shorter = Math.min(a.length, b.length);
            if (shorter === 0) {
                continue;
            }

            let matches = 0;
            for (let k = 0; k < shorter; k++) {
                if (a[k] === b[k]) {
                    matches++;
                }
            }

            if (matches / shorter > 0.8) {
                group.push(normalized[j]!.original);
                assigned.add(j);
            }
        }

        if (group.length > 1) {
            groups.push(group);
        }
    }

    return groups;
}

/**
 * Format a warning about duplicate or overly similar queries.
 */
export function formatDuplicateWarning(groups: string[][], theme: ThemeAPI): string {
    if (groups.length === 0) {
        return "";
    }

    const lines = [theme.fg("warning", "⚠ Similar queries detected:")];
    for (const group of groups) {
        lines.push(theme.fg("dim", `  - ${group.join(" / ")}`));
    }
    lines.push(
        theme.fg("muted", "  Tip: Vary phrasing and scope across queries for broader coverage."),
    );

    return lines.join("\n");
}
