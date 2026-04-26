/**
 * ──────────────────────────────────────────────
 *  HTTP Web Content Extractor
 * ──────────────────────────────────────────────
 * Fetches web pages via HTTP and extracts readable
 * content as Markdown.  Handles JS-heavy pages,
 * SPAs, anti-bot protections, and PDFs through a
 * multi-stage fallback chain.
 *
 * Fallback chain:
 *   1. Readability (fast, local, works for most sites)
 *   2. RSC flight-data parser (Next.js pages)
 *   3. Jina Reader (server-side JS rendering, no key needed)
 *   4. Gemini URL Context API (needs GEMINI_API_KEY)
 *   5. Gemini Web (needs cookie auth)
 *
 * @module extractors/http
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import type { IExtractedContent, IExtractOptions } from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";
import { activityMonitor } from "../activity.js";
import { toErrorMessage, isAbortError } from "../utils.js";
import { extractRSCContent } from "./rsc.js";
import { isPDF, extractPDFToMarkdown } from "./pdf.js";
import { extractWithUrlContext, extractWithGeminiWeb } from "../providers/gemini/url-context.js";

// ── Constants ──────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const JINA_TIMEOUT_MS = 60_000;
const JINA_READER_BASE = "https://r.jina.ai";

/** Minimum content length to consider extraction successful. */
const MIN_USEFUL_CONTENT = 500;

// ── Turndown singleton ─────────────────────────

const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
});

// ── Helpers ────────────────────────────────────

function extractHeadingTitle(text: string): string | null {
    const match = text.match(/^#\s+(.+)/m);
    return match?.[1]?.trim() ?? null;
}

function extractTextTitle(text: string): string | null {
    const match = text.match(/^(.+)$/m);
    return match?.[1]?.trim() ?? null;
}

function abortedResult(url: string): IExtractedContent {
    return { url, title: "", content: "", error: "Aborted" };
}

// ── Jina Reader extraction ─────────────────────

/**
 * Extract content via Jina Reader (server-side JS rendering).
 * No API key required.
 */
async function extractWithJinaReader(
    url: string,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    const jinaUrl = `${JINA_READER_BASE}/${encodeURI(url)}`;
    const activityId = activityMonitor.logStart({
        type: "fetch",
        url: `jina:${url}`,
    });

    try {
        const timeoutSignal = signal
            ? AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), signal])
            : AbortSignal.timeout(JINA_TIMEOUT_MS);

        const res = await fetch(jinaUrl, {
            headers: {
                Accept: "text/plain, text/markdown",
                "X-No-Cache": "true",
            },
            signal: timeoutSignal,
        });

        if (!res.ok) {
            activityMonitor.logComplete(activityId, res.status);
            return null;
        }

        const content = await res.text();
        if (!content || content.length < MIN_USEFUL_CONTENT) {
            activityMonitor.logComplete(activityId, res.status);
            return null;
        }

        // Jina returns markdown directly, try to extract a title from the first heading
        const contentStart = content.indexOf("# ");
        const markdownPart = contentStart >= 0 ? content.slice(contentStart) : content;

        const title = extractHeadingTitle(markdownPart) ?? url;

        activityMonitor.logComplete(activityId, res.status);
        return { url, title, content: markdownPart, error: null };
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        return null;
    }
}

// ── JS-rendered page detection ─────────────────

/**
 * Heuristic: count script tags vs. text content to decide
 * whether a page is likely rendered on the client side.
 */
function isLikelyJSRendered(bodyHtml: string, text: string): boolean {
    // Count <script> tags
    const scriptRegex = /<script[\s>]/gi;
    const scriptMatches = bodyHtml.match(scriptRegex);
    const scriptCount = scriptMatches?.length ?? 0;

    // If there are many scripts and little visible text, it's likely JS-rendered
    const textContent = text.replace(/\s+/g, "").length;
    if (scriptCount > 10 && textContent < 200) {
        return true;
    }

    // Check for common JS framework markers
    const bodyMatch = bodyHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (!bodyMatch) {
        return false;
    }

    const bodyContent = bodyMatch[1];
    const hasSPAMarkers =
        bodyContent.includes("__NEXT_DATA__") ||
        bodyContent.includes("__NUXT__") ||
        bodyContent.includes("root") ||
        bodyContent.includes("__APP") ||
        bodyContent.includes("data-reactroot");

    if (hasSPAMarkers && textContent < 500) {
        return true;
    }

    return false;
}

// ── HTTP fetch ─────────────────────────────────

async function extractViaHttp(
    url: string,
    configLoader: IConfigLoader,
    options: IExtractOptions,
    signal?: AbortSignal,
): Promise<IExtractedContent> {
    const timeoutMs = DEFAULT_TIMEOUT_MS;
    const activityId = activityMonitor.logStart({ type: "fetch", url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const onAbort = () => {
        clearTimeout(timeoutId);
        controller.abort();
    };

    if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
        // ── Fetch the page ────────────────────────────
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Cache-Control": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            },
            redirect: "follow",
        });

        if (!response.ok) {
            activityMonitor.logComplete(activityId, response.status);
            return {
                url,
                title: "",
                content: "",
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }

        // ── Detect content type ───────────────────────
        const contentType = response.headers.get("content-type") ?? "";
        const contentLengthHeader = response.headers.get("content-length");
        const isPDFContent = isPDF(url, contentType);

        // Check response size (max 50MB)
        const maxResponseSize = 50 * 1024 * 1024;
        if (contentLengthHeader) {
            const contentLength = parseInt(contentLengthHeader, 10);
            if (contentLength > maxResponseSize && !isPDFContent) {
                activityMonitor.logComplete(activityId, 413);
                return {
                    url,
                    title: "",
                    content: "",
                    error: `Response too large: ${(contentLength / (1024 * 1024)).toFixed(1)} MB`,
                };
            }
        }

        // ── PDF handling ──────────────────────────────
        if (isPDFContent) {
            try {
                const buffer = await response.arrayBuffer();
                const result = await extractPDFToMarkdown(buffer, url);
                activityMonitor.logComplete(activityId, 200);
                return {
                    url,
                    title: result.title,
                    content: `PDF extracted to: \`${result.outputPath}\`\n\nTitle: ${result.title}\nPages: ${result.pages}\n\nUse \`read\` to view the markdown file.`,
                    error: null,
                };
            } catch (err) {
                const message = toErrorMessage(err);
                activityMonitor.logError(activityId, message);
                return {
                    url,
                    title: "",
                    content: "",
                    error: `PDF extraction failed: ${message}`,
                };
            }
        }

        // ── Text-based content (JSON, Markdown, etc.) ──
        const text = await response.text();
        const isHTML =
            contentType.includes("text/html") ||
            contentType.includes("application/xhtml") ||
            !contentType;

        if (!isHTML) {
            // Return non-HTML content directly
            const title = extractTextTitle(text) ?? url;
            activityMonitor.logComplete(activityId, 200);
            return { url, title, content: text, error: null };
        }

        // ── Readability extraction ─────────────────────
        const document = parseHTML(text).document;
        const reader = new Readability(document);
        const article = reader.parse();

        if (article && article.textContent && article.textContent.length >= MIN_USEFUL_CONTENT) {
            const markdown = turndown.turndown(article.content);
            const title = article.title || url;
            activityMonitor.logComplete(activityId, 200);
            return { url, title, content: markdown, error: null };
        }

        // ── RSC flight-data fallback ──────────────────
        const rscResult = extractRSCContent(text);
        if (rscResult && rscResult.content.length >= MIN_USEFUL_CONTENT) {
            activityMonitor.logComplete(activityId, 200);
            return {
                url,
                title: rscResult.title || url,
                content: rscResult.content,
                error: null,
            };
        }

        // ── Jina Reader fallback ───────────────────────
        if (isLikelyJSRendered(text, article?.textContent ?? "")) {
            const jinaResult = await extractWithJinaReader(url, signal);
            if (jinaResult && jinaResult.content.length >= MIN_USEFUL_CONTENT) {
                activityMonitor.logComplete(activityId, 200);
                return jinaResult;
            }
        }

        // ── Gemini URL Context fallback ────────────────
        const geminiContextResult = await extractWithUrlContext(url, configLoader, signal);
        if (geminiContextResult && geminiContextResult.content.length >= MIN_USEFUL_CONTENT) {
            activityMonitor.logComplete(activityId, 200);
            return geminiContextResult;
        }

        // ── Gemini Web fallback (last resort) ──────────
        const geminiWebResult = await extractWithGeminiWeb(url, configLoader, signal);
        if (geminiWebResult && geminiWebResult.content.length >= MIN_USEFUL_CONTENT) {
            activityMonitor.logComplete(activityId, 200);
            return geminiWebResult;
        }

        // ── All fallbacks exhausted ────────────────────
        activityMonitor.logComplete(activityId, 204);
        const guidance = article?.textContent
            ? `\n\nThe page appears to be empty or JavaScript-rendered. Try:\n` +
              `  - Use \`code_search\` for programming topics\n` +
              `  - For GitHub repos, \`fetch_content\` will clone them directly`
            : "";

        return {
            url,
            title: article?.title ?? url,
            content: "",
            error: `Could not extract content from this page.${guidance}`,
        };
    } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) {
            activityMonitor.logComplete(activityId, 0);
            return abortedResult(url);
        }

        const message = toErrorMessage(err);
        activityMonitor.logError(activityId, message);

        // ── Fallback on network error ──────────────────
        const jinaResult = await extractWithJinaReader(url, signal);
        if (jinaResult) {
            return jinaResult;
        }

        return {
            url,
            title: "",
            content: "",
            error: message,
        };
    } finally {
        clearTimeout(timeoutId);
        if (signal) {
            signal.removeEventListener("abort", onAbort);
        }
    }
}

// ── Content extraction entry point ─────────────

/**
 * Extract readable content from a web URL using the full fallback chain.
 *
 * Tries, in order:
 *   1. Readability (fast local extraction)
 *   2. RSC flight-data parser (Next.js pages)
 *   3. Jina Reader (server-side JS)
 *   4. Gemini URL Context API
 *   5. Gemini Web (cookie auth)
 *
 * Also handles PDFs by routing to the PDF extractor.
 *
 * @param url           - The URL to fetch and extract.
 * @param configLoader  - Config loader (provides API keys and settings).
 * @param options       - Extraction options (prompt, model, etc.).
 * @param signal        - Optional abort signal.
 * @returns Extracted content with title and markdown body.
 */
export async function fetchWebOrPDFContent(
    url: string,
    configLoader: IConfigLoader,
    options: IExtractOptions = {},
    signal?: AbortSignal,
): Promise<IExtractedContent> {
    return extractViaHttp(url, configLoader, options, signal);
}

export { extractViaHttp };
