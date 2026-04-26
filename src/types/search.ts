/**
 * ──────────────────────────────────────────────
 *  Search Types
 * ──────────────────────────────────────────────
 * Centralised type definitions for all search-related operations.
 */

import type { IExtractedContent } from "./content.js";

// ── Source list item ───────────────────────────

export interface ISearchResult {
    readonly title: string;
    readonly url: string;
    /** Short snippet / excerpt describing the result. */
    readonly snippet: string;
}

// ── Provider response ──────────────────────────

export interface ISearchResponse {
    /** The synthesised answer text returned by the provider. */
    readonly answer: string;
    /** Ordered list of source citations. */
    readonly results: readonly ISearchResult[];
    /**
     * Full page content fetched in the background when `includeContent`
     * was requested.  Guaranteed to be present only if the calling search
     * function was invoked with `includeContent: true`.
     */
    readonly inlineContent?: readonly IExtractedContent[];
}

// ── Search provider identifiers ────────────────

export type SearchProvider = "auto" | "exa" | "perplexity" | "gemini";
export type ResolvedSearchProvider = Exclude<SearchProvider, "auto">;

/**
 * A search response that has been tagged with the actual provider that
 * fulfilled the request (never `"auto"`).
 */
export interface IAttributedSearchResponse extends ISearchResponse {
    readonly provider: ResolvedSearchProvider;
}

// ── Per-call options ───────────────────────────

export interface ISearchOptions {
    /** Number of results to request (default: 5, max: 20). */
    readonly numResults?: number;
    /** Restrict results to a recency window. */
    readonly recencyFilter?: "day" | "week" | "month" | "year";
    /** Filter by domain (prefix with `"-"` to exclude). */
    readonly domainFilter?: readonly string[];
    /** An external abort signal. */
    readonly signal?: AbortSignal;
}

/**
 * Extended options that the top-level search orchestrator accepts.  These
 * add fields that are consumed before delegating to a specific provider.
 */
export interface IFullSearchOptions extends ISearchOptions {
    /** Provider override (default: `"auto"` → fallback chain). */
    readonly provider?: SearchProvider;
    /** When `true`, fetch full page content from every source URL. */
    readonly includeContent?: boolean;
}

// ── Curator / workflow ─────────────────────────

export type SearchWorkflow = "none" | "summary-review";

/** Tracks how far along a multi-query search session is. */
export type SearchPhase =
    | "init"
    | "searching"
    | "fetching"
    | "summarizing"
    | "done"
    | "cancelled"
    | "error";
