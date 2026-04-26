/**
 * ──────────────────────────────────────────────
 *  Search Provider Registry
 * ──────────────────────────────────────────────
 * Orchestrates multi-provider search with automatic
 * fallback chain.  The `search()` entry point routes
 * a query through the configured (or auto-detected)
 * provider, falling back through the chain if a
 * provider is unavailable or returns an error.
 *
 * Fallback order (auto mode):
 *   1. Exa (direct API with key, MCP without)
 *   2. Perplexity (requires API key)
 *   3. Gemini API (requires API key)
 *   4. Gemini Web (requires cookie auth)
 *
 * @module providers/registry
 */

import type {
    ISearchOptions,
    ISearchResult,
    IFullSearchOptions,
    IAttributedSearchResponse,
    SearchProvider,
    ResolvedSearchProvider,
} from "../types/search.js";
import type { IProviderAvailability } from "../types/config.js";
import type { IConfigLoader } from "../config/index.js";

import { searchWithExa, hasExaApiKey, isExaAvailable } from "./exa.js";
import { searchWithPerplexity, isPerplexityAvailable } from "./perplexity.js";
import { searchWithGeminiApi, isGeminiApiAvailable } from "./gemini/api.js";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini/web.js";

// ── Constants ──────────────────────────────────

const GEMINI_WEB_SEARCH_PROMPT = `Search the web and answer the following question. Include source URLs for your claims.
Format your response as:
1. A direct answer to the question
2. Cited sources as markdown links

Question: `;

// ── Error helper ───────────────────────────────

function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
    return toErrorMessage(err).toLowerCase().includes("abort");
}

// ── Gemini Web search ──────────────────────────

/**
 * Search via Gemini Web (cookie auth).  Constructs a search-oriented
 * prompt and parses markdown links from the response as source
 * citations.
 */
async function searchWithGeminiWeb(
    query: string,
    configLoader: IConfigLoader,
    options: ISearchOptions,
): Promise<{ answer: string; results: ISearchResult[] } | null> {
    const cookies = await isGeminiWebAvailable(configLoader);
    if (!cookies) {
        return null;
    }

    // Build the search prompt with contextual filters
    let prompt = GEMINI_WEB_SEARCH_PROMPT + query;
    if (options.recencyFilter) {
        const labels: Record<string, string> = {
            day: "past 24 hours",
            week: "past week",
            month: "past month",
            year: "past year",
        };
        prompt += `\n\nOnly include results from the ${labels[options.recencyFilter] ?? options.recencyFilter}.`;
    }
    if (options.domainFilter?.length) {
        const includes = options.domainFilter.filter((d) => !d.startsWith("-"));
        const excludes = options.domainFilter
            .filter((d) => d.startsWith("-"))
            .map((d) => d.slice(1));
        if (includes.length) {
            prompt += `\n\nOnly cite sources from: ${includes.join(", ")}`;
        }
        if (excludes.length) {
            prompt += `\n\nDo not cite sources from: ${excludes.join(", ")}`;
        }
    }

    try {
        const text = await queryWithCookies(prompt, cookies, {
            model: "gemini-3-flash-preview",
            signal: options.signal,
            timeoutMs: 60_000,
        });

        // Extract markdown links as search results
        const results: ISearchResult[] = [];
        const seen = new Set<string>();
        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
        for (const match of text.matchAll(linkRegex)) {
            const url = match[2];
            if (!seen.has(url)) {
                seen.add(url);
                results.push({ title: match[1], url, snippet: "" });
            }
        }

        return { answer: text, results };
    } catch {
        return null;
    }
}

// ── Gemini fallback (API → Web) ────────────────

/**
 * Try Gemini search through both API and Web paths.
 * If `strictErrors` is true, throws on failure instead of returning null.
 */
async function searchWithGemini(
    query: string,
    configLoader: IConfigLoader,
    options: ISearchOptions,
    strictErrors: boolean,
): Promise<{ answer: string; results: ISearchResult[] } | null> {
    const errors: string[] = [];

    // Try Gemini API first
    try {
        const apiResult = await searchWithGeminiApi(query, configLoader, options);
        if (apiResult) {
            return {
                answer: apiResult.answer,
                results: apiResult.results.map((r) => ({
                    title: r.title,
                    url: r.url,
                    snippet: "",
                })),
            };
        }
    } catch (err) {
        if (isAbortError(err)) {
            throw err;
        }
        errors.push(`Gemini API: ${toErrorMessage(err)}`);
    }

    // Fall back to Gemini Web
    try {
        const webResult = await searchWithGeminiWeb(query, configLoader, options);
        if (webResult) {
            return webResult;
        }
    } catch (err) {
        if (isAbortError(err)) {
            throw err;
        }
        errors.push(`Gemini Web: ${toErrorMessage(err)}`);
    }

    if (strictErrors && errors.length > 0) {
        throw new Error(`Gemini search failed:\n  - ${errors.join("\n  - ")}`);
    }

    return null;
}

// ── Availability check ─────────────────────────

/**
 * Get the availability status of every registered provider.
 */
export async function getAvailability(configLoader: IConfigLoader): Promise<IProviderAvailability> {
    const [perplexity, exa, geminiWeb] = await Promise.all([
        Promise.resolve(isPerplexityAvailable(configLoader)),
        Promise.resolve(isExaAvailable(configLoader)),
        isGeminiWebAvailable(configLoader),
    ]);

    return {
        perplexity,
        exa,
        gemini: isGeminiApiAvailable(configLoader) || geminiWeb !== null,
    };
}

// ── Resolve provider ───────────────────────────

/**
 * Resolve a `SearchProvider` string to a concrete provider name
 * (never `"auto"`).  In auto mode, picks the first available
 * provider in the fallback order.
 */
export async function resolveProvider(
    provider: SearchProvider,
    configLoader: IConfigLoader,
): Promise<ResolvedSearchProvider> {
    if (provider !== "auto") {
        return provider as ResolvedSearchProvider;
    }

    // Try providers in order
    if (isExaAvailable(configLoader)) {
        return "exa";
    }
    if (isPerplexityAvailable(configLoader)) {
        return "perplexity";
    }
    if (isGeminiApiAvailable(configLoader)) {
        return "gemini";
    }
    const cookies = await isGeminiWebAvailable(configLoader);
    if (cookies) {
        return "gemini";
    }

    // Default to exa (MCP fallback should always work)
    return "exa";
}

// ── Search ─────────────────────────────────────

/**
 * Execute a search query through the best available provider.
 *
 * When `provider` is `"auto"` (the default), the function tries
 * providers in the fallback order:
 *   1. Exa (API with key, MCP without)
 *   2. Perplexity (requires API key)
 *   3. Gemini API (requires API key)
 *   4. Gemini Web (requires cookie auth)
 *
 * If a specific provider is requested, only that provider is tried.
 *
 * @param query         - The search query.
 * @param configLoader  - Config loader for API keys and settings.
 * @param options       - Optional parameters (provider, recency, domain filters, etc.).
 * @returns An attributed search response with provider tag.
 * @throws {Error} If no provider can fulfil the request.
 */
export async function search(
    query: string,
    configLoader: IConfigLoader,
    options: IFullSearchOptions = {},
): Promise<IAttributedSearchResponse> {
    const requestedProvider = options.provider ?? configLoader.defaultProvider;

    // ── Specific provider requested ────────────────
    if (requestedProvider === "perplexity") {
        const result = await searchWithPerplexity(query, configLoader, options);
        return { ...result, provider: "perplexity" };
    }

    if (requestedProvider === "gemini") {
        const result = await searchWithGemini(query, configLoader, options, true);
        if (result) {
            return {
                answer: result.answer,
                results: result.results,
                provider: "gemini",
            };
        }
        throw new Error(
            "Gemini search unavailable. Either:\n" +
                "  1. Set GEMINI_API_KEY in ~/.pi/web-search.json\n" +
                "  2. Sign into gemini.google.com in a supported Chromium-based browser",
        );
    }

    if (requestedProvider === "exa") {
        const hasKey = hasExaApiKey(configLoader);
        try {
            const result = await searchWithExa(query, configLoader, options);
            if (result && "exhausted" in result) {
                throw new Error(
                    "Exa monthly free tier exhausted (1,000 requests). Resets next month.\n" +
                        "  Use provider: 'perplexity' or 'gemini', or upgrade at exa.ai/pricing",
                );
            }
            if (result && "answer" in result) {
                return { ...result, provider: "exa" };
            }
            if (hasKey) {
                throw new Error("Exa search returned no results.");
            }
        } catch (err) {
            if (isAbortError(err)) {
                throw err;
            }
            if (hasKey) {
                throw err;
            }
            // No API key: allow provider fallback below
        }
    }

    // ── Auto / fallback mode ──────────────────────
    const fallbackErrors: string[] = [];

    // Try Exa (unless already tried above)
    if (requestedProvider !== "exa" && isExaAvailable(configLoader)) {
        try {
            const result = await searchWithExa(query, configLoader, options);
            if (result && "answer" in result) {
                return { ...result, provider: "exa" };
            }
        } catch (err) {
            if (isAbortError(err)) {
                throw err;
            }
            fallbackErrors.push(`Exa: ${toErrorMessage(err)}`);
        }
    }

    // Try Perplexity
    if (isPerplexityAvailable(configLoader)) {
        try {
            const result = await searchWithPerplexity(query, configLoader, options);
            return { ...result, provider: "perplexity" };
        } catch (err) {
            if (isAbortError(err)) {
                throw err;
            }
            fallbackErrors.push(`Perplexity: ${toErrorMessage(err)}`);
        }
    }

    // Try Gemini (API → Web)
    try {
        const geminiResult = await searchWithGemini(query, configLoader, options, false);
        if (geminiResult) {
            return {
                answer: geminiResult.answer,
                results: geminiResult.results,
                provider: "gemini",
            };
        }
    } catch (err) {
        if (isAbortError(err)) {
            throw err;
        }
        fallbackErrors.push(`Gemini: ${toErrorMessage(err)}`);
    }

    // ── All providers exhausted ───────────────────
    if (fallbackErrors.length > 0) {
        throw new Error(`Auto provider search failed:\n  - ${fallbackErrors.join("\n  - ")}`);
    }

    throw new Error(
        "No search provider available. Either:\n" +
            "  1. Set perplexityApiKey in ~/.pi/web-search.json\n" +
            "  2. Set EXA_API_KEY (or exaApiKey) in ~/.pi/web-search.json\n" +
            "  3. Set GEMINI_API_KEY in ~/.pi/web-search.json\n" +
            "  4. Sign into gemini.google.com in a supported Chromium-based browser",
    );
}
