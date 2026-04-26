/**
 * ───────────────────────────────────────────────
 *  Gemini URL Context & Web Extraction
 * ───────────────────────────────────────────────
 * Fallback content extractors that use Gemini's
 * URL Context API and Gemini Web (cookie auth) to
 * extract readable content from web pages when
 * Readability or Jina Reader fail.
 *
 * Both extractors are tried as a last resort in
 * the HTTP extraction fallback chain.
 *
 * @module providers/gemini/url-context
 */

import type { IExtractedContent } from "../../types/content.js";
import type { IConfigLoader } from "../../config/index.js";
import { getApiKey, API_BASE, DEFAULT_MODEL } from "./api.js";
import { isGeminiWebAvailable, queryWithCookies } from "./web.js";
import { activityMonitor } from "../../activity.js";
import { toErrorMessage, isAbortError } from "../../utils.js";

// ── Constants ──────────────────────────────────

const EXTRACTION_PROMPT = `Extract the complete readable content from this URL as clean markdown.
Include the page title, all text content, code blocks, and tables.
Do not summarize — extract the full content.

URL: `;

const MIN_CONTENT_LENGTH = 50;

// ── Helpers ────────────────────────────────────

/**
 * Determine whether an error should be re-thrown rather than
 * silently swallowed — only configuration parse errors qualify.
 */
function shouldRethrow(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.startsWith("Failed to parse ");
}

/**
 * Extract a heading from markdown text, or fall back to a
 * URL-derived title.
 */
function extractTitleFromContent(text: string, url: string): string {
    const match = text.match(/^#\s+(.+)/m);
    if (match?.[1]) {
        return match[1].trim();
    }

    try {
        const pathSegment = new URL(url).pathname.split("/").pop();
        return pathSegment || url;
    } catch {
        return url;
    }
}

// ── Response types ─────────────────────────────

interface UrlContextResponse {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        url_context_metadata?: {
            url_metadata?: Array<{
                retrieved_url?: string;
                url_retrieval_status?: string;
            }>;
        };
    }>;
}

// ── Public API: URL Context extraction ─────────

/**
 * Extract content from a URL using the Gemini URL Context API.
 *
 * This requires a Gemini API key.  Returns `null` when the key is
 * missing, the page could not be retrieved, or the returned content
 * is too short to be useful.
 *
 * @param url           - The URL to extract.
 * @param configLoader  - Config loader (provides API key).
 * @param signal        - Optional abort signal.
 * @returns Extracted content, or `null` if extraction failed.
 */
export async function extractWithUrlContext(
    url: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    const apiKey = getApiKey(configLoader);
    if (!apiKey) {
        return null;
    }

    const activityId = activityMonitor.logStart({
        type: "api",
        query: `url_context: ${url}`,
    });

    try {
        const model = DEFAULT_MODEL;
        const timeoutSignal = signal
            ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
            : AbortSignal.timeout(60_000);

        const body = {
            contents: [{ parts: [{ text: EXTRACTION_PROMPT + url }] }],
            tools: [{ url_context: {} }],
        };

        const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: timeoutSignal,
        });

        if (!res.ok) {
            activityMonitor.logComplete(activityId, res.status);
            return null;
        }

        const data = (await res.json()) as UrlContextResponse;
        activityMonitor.logComplete(activityId, res.status);

        // Check retrieval status
        const metadata = data.candidates?.[0]?.url_context_metadata;
        if (metadata?.url_metadata?.length) {
            const status = metadata.url_metadata[0]?.url_retrieval_status;
            if (
                status === "URL_RETRIEVAL_STATUS_UNSAFE" ||
                status === "URL_RETRIEVAL_STATUS_ERROR"
            ) {
                return null;
            }
        }

        const content =
            data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text)
                .filter(Boolean)
                .join("\n") ?? "";

        if (!content || content.length < MIN_CONTENT_LENGTH) {
            return null;
        }

        const title = extractTitleFromContent(content, url);
        return { url, title, content, error: null };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }

        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        return null;
    }
}

// ── Public API: Gemini Web extraction ──────────

/**
 * Extract content from a URL using Gemini Web (cookie-based auth).
 *
 * This requires the user to be signed into gemini.google.com in a
 * supported Chromium-based browser.  Returns `null` when cookies
 * are unavailable or the returned content is too short.
 *
 * @param url           - The URL to extract.
 * @param configLoader  - Config loader (provides chromeProfile).
 * @param signal        - Optional abort signal.
 * @returns Extracted content, or `null` if extraction failed.
 */
export async function extractWithGeminiWeb(
    url: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    const cookies = await isGeminiWebAvailable(configLoader);
    if (!cookies) {
        return null;
    }

    const activityId = activityMonitor.logStart({
        type: "api",
        query: `gemini_web: ${url}`,
    });

    try {
        const text = await queryWithCookies(EXTRACTION_PROMPT + url, cookies, {
            model: "gemini-3-flash-preview",
            signal,
            timeoutMs: 60_000,
        });

        activityMonitor.logComplete(activityId, 200);

        if (!text || text.length < MIN_CONTENT_LENGTH) {
            return null;
        }

        const title = extractTitleFromContent(text, url);
        return { url, title, content: text, error: null };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }

        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        return null;
    }
}
