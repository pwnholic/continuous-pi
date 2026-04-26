/**
 * ──────────────────────────────────────────────
 *  UI — Content Fetch Results Rendering
 * ──────────────────────────────────────────────
 * Formats and renders content-fetch results for
 * display in the Pi TUI.
 *
 * Handles single URL, multi-URL, and video-based
 * fetch results with appropriate display formats.
 *
 * @module ui/fetch-results
 */

import type { IExtractedContent } from "../types/content.js";

// ── Theme API (same shape as search-results) ──

export interface FetchThemeAPI {
    bold: (s: string) => string;
    fg: (color: string, s: string) => string;
    dim: (s: string) => string;
    success: (s: string) => string;
    error: (s: string) => string;
    muted: (s: string) => string;
    accent: (s: string) => string;
    warning: (s: string) => string;
}

// ── Single-result formatting ──────────────────

export interface IFormattedFetchResult {
    readonly title: string;
    readonly content: string;
    readonly error: string | null;
    readonly charCount: number;
    readonly hasThumbnail: boolean;
    readonly frameCount: number;
    readonly duration: number | undefined;
}

/**
 * Format a single extracted content result for display.
 */
export function formatFetchResult(
    result: IExtractedContent,
    maxContentPreview = 2000,
): IFormattedFetchResult {
    const content =
        result.content.length > maxContentPreview
            ? `${result.content.slice(
                  0,
                  maxContentPreview,
              )}\n\n[... truncated, full ${result.content.length} chars stored in get_search_content ...]`
            : result.content;

    return {
        title: result.title || result.url,
        content,
        error: result.error,
        charCount: result.content.length,
        hasThumbnail: !!result.thumbnail,
        frameCount: result.frames?.length ?? 0,
        duration: result.duration,
    };
}

// ── Single URL markdown output ─────────────────

export interface IFetchDisplayResult {
    readonly markdown: string;
    readonly summary: string;
    readonly charCount: number;
    readonly hasImage: boolean;
}

/**
 * Build a full markdown document from a fetch result
 * suitable for returning as tool content.
 */
export function buildFetchMarkdown(result: IExtractedContent): IFetchDisplayResult {
    if (result.error) {
        return {
            markdown: `Error fetching URL: ${result.error}`,
            summary: `Error: ${result.error}`,
            charCount: 0,
            hasImage: false,
        };
    }

    const header = `# ${result.title}\n\n> Source: ${result.url}\n\n`;
    const content = result.content;
    const hasImage = !!result.thumbnail;

    const markdown = header + content;

    return {
        markdown,
        summary: `${result.title} — ${content.length.toLocaleString()} chars`,
        charCount: content.length,
        hasImage,
    };
}

/**
 * Build markdown for multiple fetch results.
 */
export function buildMultiFetchMarkdown(
    results: readonly IExtractedContent[],
    urls: readonly string[],
): IFetchDisplayResult {
    const parts: string[] = [];
    let totalChars = 0;
    let successful = 0;
    let hasImage = false;

    for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const url = urls[i] ?? result.url;

        if (result.error) {
            parts.push(`## ${i + 1}. ${url}`);
            parts.push("");
            parts.push(`**Error:** ${result.error}`);
            parts.push("");
        } else {
            successful++;
            totalChars += result.content.length;
            if (result.thumbnail) {
                hasImage = true;
            }

            parts.push(`## ${i + 1}. ${result.title || url}`);
            parts.push("");
            parts.push(result.content.slice(0, 3000));
            if (result.content.length > 3000) {
                parts.push("");
                parts.push(
                    `*[Truncated — full content (${result.content.length} chars) available via get_search_content]*`,
                );
            }
            parts.push("");
        }

        if (i < results.length - 1) {
            parts.push("---");
            parts.push("");
        }
    }

    return {
        markdown: parts.join("\n"),
        summary: `${successful}/${results.length} successful, ${totalChars.toLocaleString()} total chars`,
        charCount: totalChars,
        hasImage,
    };
}

// ── TUI rendering ─────────────────────────────

/**
 * Compact one-line representation of a fetch_content tool call.
 */
export function renderFetchCall(
    url: string | undefined,
    urls: readonly string[] | undefined,
    theme: FetchThemeAPI,
): string {
    const display = url ?? urls?.[0] ?? "(no URL)";
    const truncated = display.length > 60 ? `${display.slice(0, 57)}...` : display;
    return theme.fg("toolTitle", theme.bold("fetch_content ")) + theme.fg("accent", truncated);
}

/**
 * Expansive rendering of a fetch result for the TUI detail panel.
 */
export function renderFetchResult(
    details: {
        urls?: readonly string[];
        urlCount?: number;
        successful?: number;
        totalChars?: number;
        title?: string;
        hasImage?: boolean;
        error?: string;
    },
    expanded: boolean,
    theme: FetchThemeAPI,
): string {
    if (details.error) {
        return theme.fg("error", `Error: ${details.error}`);
    }

    const summary = theme.fg(
        "success",
        `fetched ${details.successful ?? 0}/${details.urlCount ?? 0}` +
            ` · ${(details.totalChars ?? 0).toLocaleString()} chars${
                details.hasImage ? " · 🖼 thumbnail" : ""
            }`,
    );

    if (!expanded) {
        return summary;
    }

    const lines: string[] = [summary, ""];

    if (details.title) {
        lines.push(theme.fg("accent", `Title: ${details.title}`));
        lines.push("");
    }

    if (details.urls && details.urls.length > 0) {
        lines.push(theme.fg("accent", "URLs:"));
        for (const url of details.urls) {
            lines.push(`  ${theme.fg("dim", url)}`);
        }
        lines.push("");
    }

    lines.push(
        theme.fg(
            "muted",
            `${details.successful ?? 0} successful · ${(details.totalChars ?? 0).toLocaleString()} chars`,
        ),
    );

    return lines.join("\n");
}

// ── Video-specific formatting ─────────────────

export interface IVideoDisplayInfo {
    readonly duration: string;
    readonly frameCount: number;
    readonly hasThumbnail: boolean;
    readonly transcriptPreview: string;
}

/**
 * Format video-specific metadata for display.
 */
export function formatVideoInfo(result: IExtractedContent): IVideoDisplayInfo {
    const duration = result.duration ? formatDuration(result.duration) : "unknown";
    const frameCount = result.frames?.length ?? 0;
    const hasThumbnail = !!result.thumbnail;

    // First 500 chars as transcript preview
    const transcriptPreview = result.content
        .replace(/#[^\n]*\n/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

    return { duration, frameCount, hasThumbnail, transcriptPreview };
}

/**
 * Format a duration in seconds to a human-readable string.
 */
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// ─── Status line helpers ──────────────────────

/**
 * Build a compact status line for a fetch result
 * (used in curator progress / activity monitor).
 */
export function buildFetchStatusLine(
    result: IExtractedContent,
    index: number,
    total: number,
): string {
    if (result.error) {
        return `[${index + 1}/${total}] ✗ ${result.url} — ${result.error}`;
    }

    const charInfo =
        result.content.length > 0 ? `${result.content.length.toLocaleString()} chars` : "empty";
    const mediaInfo = result.thumbnail
        ? " 🖼"
        : result.frames && result.frames.length > 0
          ? ` 🎬${result.frames.length}f`
          : "";

    return `[${index + 1}/${total}] ✓ ${result.title || result.url} (${charInfo}${mediaInfo})`;
}
