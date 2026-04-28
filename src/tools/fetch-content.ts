import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import TurndownService from "turndown";
import { activityMonitor } from "../activity/monitor.js";
import { extractVertical, extractWithWebclaw } from "../extractors/webclaw.js";
import type { ExtractOptions, ExtractedContent, VideoFrame } from "../types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CONCURRENT_LIMIT = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_USEFUL_CONTENT = 500;

// ─── Turndown ─────────────────────────────────────────────────────────────────

const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

const fetchLimit = pLimit(CONCURRENT_LIMIT);

// ─── Error Helpers ────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
    return errorMessage(err).toLowerCase().includes("abort");
}

function abortedResult(url: string): ExtractedContent {
    return { url, title: "", content: "", error: "Aborted" };
}

// ─── Jina Reader Fallback ─────────────────────────────────────────────────────

const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30000;

async function extractWithJinaReader(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
    const jinaUrl = JINA_READER_BASE + url;
    const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });

    try {
        const res = await fetch(jinaUrl, {
            headers: { Accept: "text/markdown", "X-No-Cache": "true" },
            signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...(signal ? [signal] : [])]),
        });

        if (!res.ok) {
            activityMonitor.logComplete(activityId, res.status);
            return null;
        }

        const content = await res.text();
        activityMonitor.logComplete(activityId, res.status);

        const contentStart = content.indexOf("Markdown Content:");
        if (contentStart < 0) return null;

        const markdownPart = content.slice(contentStart + 17).trim();
        if (
            markdownPart.length < 100 ||
            markdownPart.startsWith("Loading...") ||
            markdownPart.startsWith("Please enable JavaScript")
        ) {
            return null;
        }

        const title = extractHeadingTitle(markdownPart) ?? extractTitleFromUrl(url);
        return { url, title, content: markdownPart, error: null };
    } catch (err) {
        const message = errorMessage(err);
        if (message.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, message);
        }
        return null;
    }
}

// ─── HTTP Extraction (Readability Fallback) ───────────────────────────────────

function isLikelyJSRendered(html: string): boolean {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return false;

    const bodyHtml = bodyMatch[1]!;
    const textContent = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

    const scriptCount = (html.match(/<script/gi) || []).length;
    return textContent.length < 500 && scriptCount > 3;
}

async function extractViaHttp(
    url: string,
    signal?: AbortSignal,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ExtractedContent> {
    const activityId = activityMonitor.logStart({ type: "fetch", url });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
            },
        });

        if (!response.ok) {
            activityMonitor.logComplete(activityId, response.status);
            return { url, title: "", content: "", error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const contentType = response.headers.get("content-type") || "";
        const isHTML = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

        const text = await response.text();
        activityMonitor.logComplete(activityId, response.status);

        if (!isHTML) {
            const title = extractHeadingTitle(text) ?? extractTitleFromUrl(url);
            return { url, title, content: text, error: null };
        }

        const { document } = parseHTML(text);
        const reader = new Readability(document);
        const article = reader.parse();

        if (!article) {
            const jsRendered = isLikelyJSRendered(text);
            return {
                url,
                title: "",
                content: "",
                error: jsRendered
                    ? "Page appears to be JavaScript-rendered (content loads dynamically)"
                    : "Could not extract readable content from HTML structure",
            };
        }

        const markdown = turndown.turndown(article.content);

        if (markdown.length < MIN_USEFUL_CONTENT) {
            return {
                url,
                title: article.title || "",
                content: markdown,
                error: isLikelyJSRendered(text)
                    ? "Page appears to be JavaScript-rendered (content loads dynamically)"
                    : "Extracted content appears incomplete",
            };
        }

        return { url, title: article.title || "", content: markdown, error: null };
    } catch (err) {
        const message = errorMessage(err);
        if (message.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, message);
        }
        return { url, title: "", content: "", error: message };
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
    }
}

// ─── GitHub Vertical Extractor ────────────────────────────────────────────────

const GITHUB_URL_RE = /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i;

async function extractGitHubVertical(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
    if (!GITHUB_URL_RE.test(url)) return null;

    // Determine which vertical extractor to use
    const path = new URL(url).pathname;
    const segments = path.split("/").filter(Boolean);

    // github.com/owner/repo → github_repo
    if (segments.length === 2) {
        const result = await extractVertical("github_repo", url, signal);
        if (result) {
            return {
                url,
                title: (result.title as string) ?? `${segments[0]}/${segments[1]}`,
                content: JSON.stringify(result, null, 2),
                error: null,
            };
        }
        return null;
    }

    // github.com/owner/repo/pull/N → github_pr
    if (segments[2] === "pull") {
        const result = await extractVertical("github_pr", url, signal);
        if (result) {
            return {
                url,
                title: (result.title as string) ?? path,
                content: JSON.stringify(result, null, 2),
                error: null,
            };
        }
    }

    // github.com/owner/repo/issues/N → github_issue
    if (segments[2] === "issues") {
        const result = await extractVertical("github_issue", url, signal);
        if (result) {
            return {
                url,
                title: (result.title as string) ?? path,
                content: JSON.stringify(result, null, 2),
                error: null,
            };
        }
    }

    // github.com/owner/repo/releases/tag/X → github_release
    if (segments[2] === "releases") {
        const result = await extractVertical("github_release", url, signal);
        if (result) {
            return {
                url,
                title: (result.title as string) ?? path,
                content: JSON.stringify(result, null, 2),
                error: null,
            };
        }
    }

    return null;
}

// ─── YouTube / Video Detection ────────────────────────────────────────────────

const YOUTUBE_RE =
    /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** Check if URL is a YouTube video */
export function isYouTubeURL(url: string): { isYouTube: boolean; videoId: string | null } {
    try {
        const parsed = new URL(url);
        if (parsed.pathname === "/playlist") return { isYouTube: false, videoId: null };
    } catch {
        // ignore
    }
    const match = url.match(YOUTUBE_RE);
    if (!match) return { isYouTube: false, videoId: null };
    return { isYouTube: true, videoId: match[1] ?? null };
}

/** Check if path is a local video file */
export function isVideoFilePath(input: string): boolean {
    const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mpeg", ".mpg", ".wmv", ".flv", ".3gp"];
    const isFilePath =
        input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("file://");
    if (!isFilePath) return false;
    const ext = videoExts.find((e) => input.toLowerCase().endsWith(e));
    return !!ext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Extract Function
// ═══════════════════════════════════════════════════════════════════════════════

export interface FetchExtractOptions {
    timeoutMs?: number;
    forceClone?: boolean;
    prompt?: string;
    timestamp?: string;
    frames?: number;
    model?: string;
}

/**
 * Extract content from a URL.
 * Priority:
 *   1. webclaw (primary)
 *   2. GitHub vertical extractor (if GitHub URL)
 *   3. Readability (fallback)
 *   4. Jina Reader (last resort)
 */
export async function extractContent(
    url: string,
    signal?: AbortSignal,
    options?: FetchExtractOptions,
): Promise<ExtractedContent> {
    if (signal?.aborted) return abortedResult(url);

    // YouTube and video files are handled separately
    const ytInfo = isYouTubeURL(url);
    if (ytInfo.isYouTube) {
        // For now, use webclaw's youtube_video vertical extractor
        const wcResult = await extractWithWebclaw(url, {
            format: "llm",
            signal,
            timeout: options?.timeoutMs ? Math.ceil(options.timeoutMs / 1000) : 30,
        });
        if (wcResult && !wcResult.error) return wcResult;

        // Try vertical extractor
        const vertResult = await extractVertical("youtube_video", url, signal);
        if (vertResult) {
            return {
                url,
                title: (vertResult.title as string) ?? "YouTube Video",
                content: `# ${vertResult.title ?? "YouTube Video"}\n\n${JSON.stringify(vertResult, null, 2)}`,
                error: null,
            };
        }

        return { url, title: "", content: "", error: "YouTube extraction unavailable. Try Gemini API or Gemini Web." };
    }

    if (isVideoFilePath(url)) {
        // For local video, just pass through to webclaw
        const wcResult = await extractWithWebclaw(url, {
            format: "llm",
            signal,
            timeout: options?.timeoutMs ? Math.ceil(options.timeoutMs / 1000) : 60,
        });
        if (wcResult && !wcResult.error) return wcResult;
        return { url, title: "", content: "", error: "Video analysis requires Gemini access." };
    }

    // Try GitHub vertical extractor first
    if (GITHUB_URL_RE.test(url)) {
        const ghResult = await extractGitHubVertical(url, signal);
        if (ghResult) return ghResult;
    }

    // Try webclaw (primary extraction engine)
    const wcResult = await extractWithWebclaw(url, {
        format: "llm",
        signal,
        timeout: options?.timeoutMs ? Math.ceil(options.timeoutMs / 1000) : 30,
    });

    if (wcResult && !wcResult.error) {
        return wcResult;
    }

    if (signal?.aborted) return abortedResult(url);

    // Fallback to HTTP extraction (Readability + Turndown)
    const httpResult = await extractViaHttp(url, signal, options?.timeoutMs);

    if (signal?.aborted) return abortedResult(url);
    if (!httpResult.error) return httpResult;

    // Fallback to Jina Reader
    const jinaResult = await extractWithJinaReader(url, signal);
    if (jinaResult) return jinaResult;

    // Return the best error message we have
    return {
        ...httpResult,
        error: `${httpResult.error}\n\nAlternatives:\n  • Install webclaw for better extraction: brew install webclaw\n  • Use web_search to find content about this topic`,
    };
}

/**
 * Fetch content from multiple URLs in parallel (concurrency-limited).
 */
export async function fetchAllContent(
    urls: string[],
    signal?: AbortSignal,
    options?: FetchExtractOptions,
): Promise<ExtractedContent[]> {
    return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractHeadingTitle(text: string): string | null {
    const match = text.match(/^#{1,2}\s+(.+)/m);
    if (!match) return null;
    const cleaned = match[1]?.replace(/\*+/g, "").trim();
    return cleaned || null;
}

function extractTitleFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.pathname.split("/").pop() ?? parsed.hostname;
    } catch {
        return url;
    }
}
