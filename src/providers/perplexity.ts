/**
 * ──────────────────────────────────────────────
 *  Perplexity AI Search Provider
 * ──────────────────────────────────────────────
 * Fetches search results from Perplexity's chat
 * completions API (model: "sonar").
 *
 * @module providers/perplexity
 */

import type { ISearchResult, ISearchResponse, ISearchOptions } from "../types/search.js";
import type { IConfigLoader } from "../config/index.js";
import { activityMonitor } from "../activity.js";
import { toErrorMessage, isAbortError } from "../utils.js";

// ── Constants ──────────────────────────────────

/** Perplexity chat completions endpoint. */
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

/** Maximum requests allowed per rolling time window. */
const RATE_LIMIT_MAX = 10;

/** Rate-limit window duration in milliseconds (60 seconds). */
const RATE_LIMIT_WINDOW_MS = 60_000;

// ── In-memory rate-limit state ─────────────────

/**
 * Timestamps of completed API requests within the current rolling window.
 * Used by {@link checkRateLimit} to enforce the 10 req / 60 s limit.
 */
const requestTimestamps: number[] = [];

// ── Rate-limit helpers ─────────────────────────

/**
 * Pop any timestamps that have fallen outside the current rate-limit
 * window, then throw if the number of in-window requests already equals
 * or exceeds the maximum.
 *
 * @throws {Error} When the rate limit is exceeded.
 */
function checkRateLimit(): void {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;

    // Remove expired entries.
    let i = 0;
    while (i < requestTimestamps.length && requestTimestamps[i]! < cutoff) {
        i++;
    }
    if (i > 0) {
        requestTimestamps.splice(0, i);
    }

    // Check if we have capacity.
    if (requestTimestamps.length >= RATE_LIMIT_MAX) {
        const oldest = requestTimestamps[0]!;
        const retryAfterMs = Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000);
        throw new Error(
            `Perplexity rate limit exceeded. ` +
                `Maximum ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s. ` +
                `Retry in ${retryAfterMs}s.`,
        );
    }
}

/**
 * Update the activity monitor's rate-limit info to reflect the current
 * in-memory state.
 */
function updateRateLimitInfo(): void {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;

    // Re-count to stay consistent.
    const active = requestTimestamps.filter((t) => t >= cutoff);
    const oldestTimestamp = active.length > 0 ? active[0]! : null;

    activityMonitor.updateRateLimit({
        used: active.length,
        max: RATE_LIMIT_MAX,
        oldestTimestamp,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
}

// ── Domain-filter validation ───────────────────

/**
 * Domain pattern used to validate entries in the `domainFilter` option.
 * Supports an optional leading `"-"` for exclusion prefixes.
 */
const DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/;

/**
 * Filter an array of domain strings, keeping only those that match a
 * valid domain pattern.  Entries prefixed with `"-"` have the prefix
 * stripped before validation, then the full entry (with prefix) is
 * kept if the remainder passes.
 *
 * @param domains - Raw domain filter entries from `ISearchOptions`.
 * @returns A new array containing only valid domain strings.
 */
function validateDomainFilter(domains: string[]): string[] {
    return domains.filter((d) => {
        const trimmed = d.trim();
        if (trimmed === "") {
            return false;
        }

        // Strip optional exclusion prefix before checking the pattern.
        const body = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
        return DOMAIN_PATTERN.test(body);
    });
}

// ── API-key helper ─────────────────────────────

/**
 * Retrieve the Perplexity API key from the config loader.
 *
 * @param configLoader - The application config loader.
 * @returns The non-null API key string.
 * @throws {Error} If no API key is configured.
 */
function getApiKey(configLoader: IConfigLoader): string {
    const key = configLoader.perplexityApiKey;
    if (!key) {
        throw new Error(
            "Perplexity API key is not configured. " +
                "Set `perplexityApiKey` in ~/.pi/web-search.json or " +
                "the PERPLEXITY_API_KEY environment variable.",
        );
    }
    return key;
}

// ── Public API ─────────────────────────────────

/**
 * Check whether the Perplexity provider is usable based on the
 * current configuration.
 *
 * @param configLoader - The application config loader.
 * @returns `true` if a Perplexity API key is present.
 */
export function isPerplexityAvailable(configLoader: IConfigLoader): boolean {
    return configLoader.perplexityApiKey !== null;
}

/**
 * Search using the Perplexity AI chat completions API.
 *
 * Queries are sent to the "sonar" model.  Citations from the API
 * response are converted into {@link ISearchResult} items.
 *
 * @param query         - The search query string.
 * @param configLoader  - The application config loader (provides the API key).
 * @param options       - Optional search parameters.
 * @returns A promise that resolves to the search response.
 * @throws {Error} If the API key is missing, the rate limit is exceeded,
 *                 or the upstream API returns a non-OK status.
 */
export async function searchWithPerplexity(
    query: string,
    configLoader: IConfigLoader,
    options: ISearchOptions = {},
): Promise<ISearchResponse> {
    const apiKey = getApiKey(configLoader);

    // ── Rate-limit guard ───────────────────────────
    checkRateLimit();

    // ── Activity logging ───────────────────────────
    const activityId = activityMonitor.logStart({ type: "api", query });

    try {
        // ── Build request body ────────────────────────
        const body: Record<string, unknown> = {
            model: "sonar",
            messages: [{ role: "user", content: query }],
            max_tokens: 1024,
        };

        // Recency filter ("search_recency_filter").
        if (options.recencyFilter) {
            body["search_recency_filter"] = options.recencyFilter;
        }

        // Domain filter with validation ("search_domain_filter").
        if (options.domainFilter && options.domainFilter.length > 0) {
            const validDomains = validateDomainFilter(options.domainFilter as string[]);
            if (validDomains.length > 0) {
                body["search_domain_filter"] = validDomains;
            }
        }

        // ── HTTP request ──────────────────────────────
        const controller = new AbortController();
        const signal = options.signal
            ? combineSignals(options.signal, controller.signal)
            : controller.signal;

        const response = await fetch(PERPLEXITY_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal,
        });

        // ── Record timestamp (before checking status so rate limit is accurate) ─
        requestTimestamps.push(Date.now());
        updateRateLimitInfo();

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(
                `Perplexity API returned status ${response.status}: ${errorBody || response.statusText}`,
            );
        }

        // ── Parse response body ───────────────────────
        const data = (await response.json()) as {
            choices: Array<{ message: { content: string } }>;
            citations?: Array<string | { url: string; title?: string }>;
        };

        const answer = data.choices?.[0]?.message?.content ?? "";

        // ── Parse citations into ISearchResult[] ──────
        const results: ISearchResult[] = [];

        if (data.citations && Array.isArray(data.citations)) {
            for (const citation of data.citations) {
                if (typeof citation === "string") {
                    results.push({
                        title: citation,
                        url: citation,
                        snippet: "",
                    });
                } else if (citation && typeof citation === "object" && "url" in citation) {
                    results.push({
                        title: citation.title ?? citation.url,
                        url: citation.url,
                        snippet: "",
                    });
                }
            }
        }

        // ── Log success ───────────────────────────────
        activityMonitor.logComplete(activityId, response.status);

        return { answer, results };
    } catch (err) {
        // ── Log error (but don't log abort errors as failures) ──
        if (!isAbortError(err)) {
            activityMonitor.logError(activityId, toErrorMessage(err));
        } else {
            // Update rate limit even on abort so the monitor stays consistent.
            updateRateLimitInfo();
        }

        // Re-throw so the caller can handle the error.
        throw err;
    }
}

// ── Signal-combination helper ───────────────────

/**
 * Combine two {@link AbortSignal}s into a single signal that aborts
 * when either source signal aborts.
 *
 * @param a - First signal (e.g. user-provided).
 * @param b - Second signal (e.g. internally created).
 * @returns A composite abort signal.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const onAbort = () => controller.abort();

    a.addEventListener("abort", onAbort, { once: true });
    b.addEventListener("abort", onAbort, { once: true });

    // If either signal is already aborted, abort immediately.
    if (a.aborted || b.aborted) {
        controller.abort();
    }

    return controller.signal;
}
