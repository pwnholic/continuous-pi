import { loadConfig } from "../config.js";
import { search } from "../providers/gemini-search.js";
import { type ProviderAvailability, resolveProvider } from "../providers/registry.js";
import { type StoredSearchData, generateId, storeResult } from "../storage/index.js";
import type { ExtractedContent, QueryResultData, ResolvedSearchProvider, SearchResult } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebSearchParams {
    query?: string;
    queries?: string[];
    numResults?: number;
    includeContent?: boolean;
    recencyFilter?: "day" | "week" | "month" | "year";
    domainFilter?: string[];
    provider?: string;
    workflow?: string;
}

export interface SearchReturnOptions {
    queryList: string[];
    results: QueryResultData[];
    urls: string[];
    includeContent: boolean;
    inlineContent?: ExtractedContent[];
    curated?: boolean;
    curatedFrom?: number;
    workflow?: string;
    approvedSummary?: string;
    summaryMeta?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function normalizeQueryList(queryList: unknown[]): string[] {
    const normalized: string[] = [];
    for (const query of queryList) {
        if (typeof query !== "string") continue;
        const trimmed = query.trim();
        if (trimmed.length > 0) normalized.push(trimmed);
    }
    return normalized;
}

function normalizeProviderInput(value: unknown): ResolvedSearchProvider | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "exa" || normalized === "perplexity" || normalized === "gemini") {
        return normalized;
    }
    return undefined;
}

function formatSearchSummary(results: SearchResult[], answer: string): string {
    let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "";
    output += results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n");
    return output;
}

function hasFullInlineCoverage(urls: string[], inlineContent: ExtractedContent[] | undefined): boolean {
    if (!inlineContent || inlineContent.length === 0) return false;
    const coveredUrls = new Set(inlineContent.map((c) => c.url));
    return urls.every((url) => coveredUrls.has(url));
}

function buildSearchReturn(opts: SearchReturnOptions & { storeResults?: boolean }): {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
} {
    const sc = opts.results.filter((r) => !r.error).length;
    const tr = opts.results.reduce((sum, r) => sum + r.results.length, 0);

    const hasApprovedSummary = typeof opts.approvedSummary === "string" && opts.approvedSummary.trim().length > 0;
    let output = "";

    if (hasApprovedSummary) {
        output = opts.approvedSummary?.trim() ?? "";
    } else {
        if (opts.curated) {
            output += "[These results were manually curated by the user in the browser.]\n\n";
        }
        for (const { query, answer, results, error } of opts.results) {
            if (opts.queryList.length > 1) {
                output += `## Query: "${query}"\n\n`;
            }
            if (error) {
                output += `Error: ${error}\n\n`;
            } else if (results.length === 0) {
                output += "No results found.\n\n";
            } else {
                output += `${formatSearchSummary(results, answer)}\n\n`;
            }
        }
    }

    const hasInlineReady = hasFullInlineCoverage(opts.urls, opts.inlineContent);
    const fetchId = generateId();

    if (hasInlineReady && opts.inlineContent) {
        const data: StoredSearchData = {
            id: fetchId,
            type: "fetch",
            timestamp: Date.now(),
            urls: opts.inlineContent,
        };
        storeResult(fetchId, data);
        if (!hasApprovedSummary) {
            output += `---\nFull content for ${opts.inlineContent.length} sources available [${fetchId}].`;
        }
    }

    // Store search results
    const searchId = generateId();
    const searchData: StoredSearchData = {
        id: searchId,
        type: "search",
        timestamp: Date.now(),
        queries: opts.results,
    };
    storeResult(searchId, searchData);

    return {
        content: [{ type: "text", text: output.trim() }],
        details: {
            queries: opts.queryList,
            queryCount: opts.queryList.length,
            successfulQueries: sc,
            totalResults: tr,
            includeContent: opts.includeContent,
            fetchId: hasInlineReady ? fetchId : undefined,
            searchId,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Search Tool
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute one or more web searches.
 * Returns synthesized answers with source citations.
 */
export async function executeWebSearch(
    params: WebSearchParams,
    signal?: AbortSignal,
    onUpdate?: (update: { content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }) => void,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
    // Normalize query list
    const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
    const queryList = normalizeQueryList(rawQueryList);

    if (queryList.length === 0) {
        return {
            content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries' parameter." }],
            details: { error: "No query provided" },
        };
    }

    // Execute searches
    const searchResults: QueryResultData[] = [];
    const allUrls: string[] = [];
    const allInlineContent: ExtractedContent[] = [];
    const resolvedProvider = normalizeProviderInput(params.provider ?? loadConfig().provider);

    for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i]!;

        onUpdate?.({
            content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: "${query}"...` }],
            details: { phase: "search", progress: i / queryList.length, currentQuery: query },
        });

        try {
            const { answer, results, inlineContent, provider } = await search(query, {
                provider: resolvedProvider,
                numResults: params.numResults,
                recencyFilter: params.recencyFilter,
                domainFilter: params.domainFilter,
                includeContent: params.includeContent,
                signal,
            });

            searchResults.push({ query, answer, results, error: null, provider });
            for (const r of results) {
                if (!allUrls.includes(r.url)) allUrls.push(r.url);
            }
            if (inlineContent) allInlineContent.push(...inlineContent);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            searchResults.push({
                query,
                answer: "",
                results: [],
                error: message,
                provider: typeof resolvedProvider === "string" ? resolvedProvider : undefined,
            });
        }
    }

    return buildSearchReturn({
        queryList,
        results: searchResults,
        urls: allUrls,
        includeContent: params.includeContent ?? false,
        inlineContent: allInlineContent.length > 0 ? allInlineContent : undefined,
    });
}
