/**
 * ──────────────────────────────────────────────
 *  Extractor Registry
 * ──────────────────────────────────────────────
 * Routes URLs to the appropriate content extractor
 * and manages the fallback chain when extraction
 * fails.
 *
 * Each URL is classified by its scheme / path, then
 * dispatched to a specialised extractor.  When the
 * primary extractor fails, fallback extractors are
 * tried in priority order.
 *
 * @module extractors/registry
 */

import pLimit from "p-limit";

import type { IExtractedContent, IExtractOptions } from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";

import { extractGitHubContent } from "./github.js";
import { isVideoFile, extractVideoFileContent } from "./video.js";
import { isYouTubeURL, isYouTubeEnabled, extractYouTubeContent } from "./youtube.js";
import { extractViaHttp } from "./http.js";

// ── Constants ──────────────────────────────────

const CONCURRENT_LIMIT = 3;
const fetchLimit = pLimit(CONCURRENT_LIMIT);

// ── URL classification ─────────────────────────

/**
 * Detect what kind of content a URL (or local path) points to.
 *
 * Returns an object with:
 * - `kind`: the content type identifier
 * - `videoId`: set when `kind === "youtube"` or `kind === "local-video"`
 */
type URLKind =
    | { kind: "github" }
    | { kind: "youtube"; videoId: string | null }
    | { kind: "local-video" }
    | { kind: "pdf" }
    | { kind: "web" };

function classifyURL(url: string): URLKind {
    // Local file path?
    if (isVideoFile(url)) {
        return { kind: "local-video" };
    }

    // GitHub URL?
    if (url.includes("github.com")) {
        return { kind: "github" };
    }

    // YouTube URL?
    const ytInfo = isYouTubeURL(url);
    if (ytInfo.isYouTube) {
        return { kind: "youtube", videoId: ytInfo.videoId };
    }

    // PDF by extension or content-type check (best-effort before fetching)
    if (isPDF(url)) {
        return { kind: "pdf" };
    }

    // Default: treat as web page
    return { kind: "web" };
}

// ── Single URL extraction ──────────────────────

/**
 * Extract content from a single URL or file path.
 *
 * The extraction strategy depends on the URL type:
 *
 * - **GitHub**: Clone the repo (or use API fallback) and return
 *   README, file tree, or file contents.
 * - **YouTube**: Use Gemini (Web → API → Perplexity) for video
 *   understanding + optional frame extraction.
 * - **Local video**: Upload to Gemini Files API or Gemini Web
 *   for analysis + thumbnail frame.
 * - **PDF**: Extract text, save as markdown in ~/Downloads/.
 * - **Web**: Fetch HTML → Readability → RSC parser → Jina Reader
 *   → Gemini URL Context → Gemini Web fallback.
 *
 * @param url           - The URL or local file path.
 * @param configLoader  - Config loader for API keys and settings.
 * @param options       - Extraction options (prompt, timestamp, frames, etc.).
 * @param signal        - Optional abort signal.
 * @returns The extracted content, or an error result.
 */
export async function extractContent(
    url: string,
    configLoader: IConfigLoader,
    options: IExtractOptions = {},
    signal?: AbortSignal,
): Promise<IExtractedContent> {
    const kind = classifyURL(url);

    // ── GitHub ──────────────────────────────────────
    if (kind.kind === "github") {
        try {
            const result = await extractGitHubContent(url, configLoader, signal);
            if (result) {
                return result;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { url, title: "", content: "", error: message };
        }
        return {
            url,
            title: "",
            content: "",
            error: "GitHub extraction returned no content",
        };
    }

    // ── YouTube ─────────────────────────────────────
    if (kind.kind === "youtube" && isYouTubeEnabled(configLoader)) {
        try {
            const result = await extractYouTubeContent(
                url,
                configLoader,
                signal,
                options.prompt,
                options.model,
                options.timestamp,
                options.frames,
            );
            if (result) {
                return result;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { url, title: "", content: "", error: message };
        }
        return {
            url,
            title: "",
            content: "",
            error: "YouTube extraction returned no content",
        };
    }

    // ── Local video ─────────────────────────────────
    if (kind.kind === "local-video") {
        try {
            const result = await extractVideoFileContent(url, configLoader, signal, options);
            if (result) {
                return result;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { url, title: "", content: "", error: message };
        }
        return {
            url,
            title: "",
            content: "",
            error: "Video extraction returned no content",
        };
    }

    // ── Web / PDF ───────────────────────────────────
    try {
        const result = await extractViaHttp(url, configLoader, options, signal);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { url, title: "", content: "", error: message };
    }
}

// ── Multi-URL extraction ───────────────────────

/**
 * Extract content from multiple URLs concurrently.
 *
 * Respects the configured concurrency limit (3 simultaneous
 * requests by default).
 *
 * @param urls          - Array of URLs or file paths.
 * @param configLoader  - Config loader.
 * @param options       - Extraction options (applied to every URL).
 * @returns Array of extracted content in the same order as the input.
 */
export async function extractAll(
    urls: readonly string[],
    configLoader: IConfigLoader,
    options: IExtractOptions = {},
): Promise<readonly IExtractedContent[]> {
    if (urls.length === 0) {
        return [];
    }

    const tasks = urls.map((url) =>
        fetchLimit(() => extractContent(url, configLoader, options, options.signal)),
    );

    return Promise.all(tasks);
}
