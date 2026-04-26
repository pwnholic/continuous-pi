/**
 * ──────────────────────────────────────────────
 *  YouTube Extractor
 * ──────────────────────────────────────────────
 * Detects YouTube URLs and extracts video content
 * using a three-tier fallback chain:
 *
 *   1. Gemini Web (cookie auth, best quality)
 *   2. Gemini API (needs API key)
 *   3. Perplexity (text-only summary)
 *
 * Also supports frame extraction at specific
 * timestamps using yt-dlp + ffmpeg.
 *
 * @module extractors/youtube
 */

import { execFileSync } from "node:child_process";

import type { IExtractedContent, IVideoFrame, FrameResult } from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";

import { isGeminiWebAvailable, queryWithCookies } from "../providers/gemini/web.js";
import { queryGeminiApiWithVideo, getApiKey } from "../providers/gemini/api.js";
import { searchWithPerplexity, isPerplexityAvailable } from "../providers/perplexity.js";

import { activityMonitor } from "../activity.js";
import { formatSeconds, readExecError, trimErrorText, mapFfmpegError } from "../utils.js";

// ── Constants ──────────────────────────────────

const YOUTUBE_REGEX =
    /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

// ── Helpers ────────────────────────────────────

function shouldRethrow(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.startsWith("Failed to parse ");
}

function extractHeadingTitle(text: string): string | null {
    const match = text.match(/^#\s+(.+)/m);
    return match?.[1]?.trim() ?? null;
}

// ── URL detection ──────────────────────────────

export interface YouTubeURLResult {
    isYouTube: boolean;
    videoId: string | null;
}

/**
 * Check whether a URL is a YouTube video URL.
 * Returns the video ID if matched, or null otherwise.
 */
export function isYouTubeURL(url: string): YouTubeURLResult {
    // Exclude playlist URLs
    try {
        const parsed = new URL(url);
        if (parsed.pathname === "/playlist") {
            return { isYouTube: false, videoId: null };
        }
    } catch {
        // Ignore parse errors
    }

    const match = url.match(YOUTUBE_REGEX);
    if (!match) {
        return { isYouTube: false, videoId: null };
    }
    return { isYouTube: true, videoId: match[1] };
}

/**
 * Check whether YouTube extraction is enabled in config.
 */
export function isYouTubeEnabled(configLoader: IConfigLoader): boolean {
    return configLoader.youtube.enabled;
}

// ── Thumbnail fetching ─────────────────────────

/**
 * Fetch the YouTube video thumbnail as a base64-encoded image.
 */
async function fetchYouTubeThumbnail(
    videoId: string,
): Promise<{ data: string; mimeType: string } | null> {
    try {
        const res = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            return null;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0) {
            return null;
        }
        return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
    } catch {
        return null;
    }
}

// ── Frame extraction ───────────────────────────

type StreamInfo = { streamUrl: string; duration: number | null };
type StreamResult = StreamInfo | { error: string };

function mapYtDlpError(err: unknown): string {
    const { code, stderr, message } = readExecError(err);
    if (code === "ENOENT") {
        return "yt-dlp is not installed. Install with: brew install yt-dlp";
    }
    if (isAbortError(err)) {
        return "yt-dlp timed out fetching video info";
    }
    const lower = stderr.toLowerCase();
    if (lower.includes("private")) {
        return "Video is private or unavailable";
    }
    if (lower.includes("sign in")) {
        return "Video is age-restricted and requires authentication";
    }
    if (lower.includes("not available")) {
        return "Video is unavailable in your region or has been removed";
    }
    if (lower.includes("live")) {
        return "Cannot extract frames from a live stream";
    }
    const snippet = trimErrorText(stderr || message);
    return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

/**
 * Get YouTube stream URL and duration using yt-dlp.
 */
export async function getYouTubeStreamInfo(videoId: string): Promise<StreamResult> {
    try {
        const output = execFileSync(
            "yt-dlp",
            ["--print", "duration", "-g", `https://www.youtube.com/watch?v=${videoId}`],
            { timeout: 15000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        const lines = output.split(/\r?\n/);
        const rawDuration = lines[0]?.trim();
        const streamUrl = lines[1]?.trim();
        if (!streamUrl) {
            return { error: "yt-dlp failed: missing stream URL" };
        }
        const parsedDuration =
            rawDuration && rawDuration !== "NA" ? Number.parseFloat(rawDuration) : NaN;
        const duration = Number.isFinite(parsedDuration) ? parsedDuration : null;
        return { streamUrl, duration };
    } catch (err) {
        return { error: mapYtDlpError(err) };
    }
}

/**
 * Extract a single frame from a YouTube stream at the given second offset.
 */
async function extractFrameFromStream(streamUrl: string, seconds: number): Promise<FrameResult> {
    try {
        const buffer = execFileSync(
            "ffmpeg",
            [
                "-ss",
                String(seconds),
                "-i",
                streamUrl,
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "pipe:1",
            ],
            {
                maxBuffer: 5 * 1024 * 1024,
                timeout: 30000,
                stdio: ["pipe", "pipe", "pipe"],
            },
        );
        if (buffer.length === 0) {
            return { error: "ffmpeg failed: empty output" };
        }
        return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
    } catch (err) {
        return { error: mapFfmpegError(err) };
    }
}

/**
 * Extract a single frame from a YouTube video.
 */
export async function extractYouTubeFrame(
    videoId: string,
    seconds: number,
    streamInfo?: StreamInfo,
): Promise<FrameResult> {
    const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
    if ("error" in info) {
        return info;
    }
    return extractFrameFromStream(info.streamUrl, seconds);
}

/**
 * Extract multiple frames from a YouTube video at the given timestamps.
 */
export async function extractYouTubeFrames(
    videoId: string,
    timestamps: readonly number[],
    streamInfo?: StreamInfo,
): Promise<{
    frames: readonly IVideoFrame[];
    duration: number | null;
    error: string | null;
}> {
    const info = streamInfo ?? (await getYouTubeStreamInfo(videoId));
    if ("error" in info) {
        return { frames: [], duration: null, error: info.error };
    }

    const results = await Promise.all(
        timestamps.map(async (t) => {
            const frame = await extractFrameFromStream(info.streamUrl, t);
            if ("error" in frame) {
                return { error: frame.error } as const;
            }
            return { ...frame, timestamp: formatSeconds(t) } as IVideoFrame;
        }),
    );

    const frames = results.filter((f): f is IVideoFrame => "data" in f && "timestamp" in f);
    const errorResult = results.find((f): f is { error: string } => "error" in f);
    return {
        frames,
        duration: info.duration,
        error: frames.length === 0 && errorResult ? errorResult.error : null,
    };
}

// ── Extraction fallbacks ───────────────────────

async function tryGeminiWeb(
    url: string,
    prompt: string,
    model: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    try {
        const cookies = await isGeminiWebAvailable(configLoader);
        if (!cookies) {
            return null;
        }
        if (signal?.aborted) {
            return null;
        }

        const text = await queryWithCookies(prompt, cookies, {
            youtubeUrl: url,
            model,
            signal,
            timeoutMs: 120_000,
        });

        return {
            url,
            title: extractHeadingTitle(text) ?? "YouTube Video",
            content: text,
            error: null,
        };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }
        return null;
    }
}

async function tryGeminiApi(
    url: string,
    prompt: string,
    model: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    try {
        const apiKey = getApiKey(configLoader);
        if (!apiKey) {
            return null;
        }
        if (signal?.aborted) {
            return null;
        }

        const text = await queryGeminiApiWithVideo(prompt, url, apiKey, {
            model,
            signal,
            timeoutMs: 120_000,
        });

        return {
            url,
            title: extractHeadingTitle(text) ?? "YouTube Video",
            content: text,
            error: null,
        };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }
        return null;
    }
}

async function tryPerplexity(
    url: string,
    prompt: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    try {
        if (signal?.aborted) {
            return null;
        }
        if (!isPerplexityAvailable(configLoader)) {
            return null;
        }

        const perplexityQuery =
            prompt === YOUTUBE_PROMPT
                ? `Summarize this YouTube video in detail: ${url}`
                : `${prompt} YouTube video: ${url}`;

        const { answer } = await searchWithPerplexity(perplexityQuery, configLoader, { signal });
        if (!answer) {
            return null;
        }

        const content =
            `# Video Summary (via Perplexity)\n\n${answer}\n\n` +
            `*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in Chrome.*`;

        return {
            url,
            title: "Video Summary (via Perplexity)",
            content,
            error: null,
        };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }
        return null;
    }
}

// ── Public API ─────────────────────────────────

/**
 * Extract content from a YouTube video URL.
 *
 * Uses a three-tier fallback chain:
 *   1. Gemini Web (cookie auth)
 *   2. Gemini API (API key)
 *   3. Perplexity (text summary only)
 *
 * Also adds the video thumbnail when extraction succeeds.
 *
 * @param url           - The YouTube video URL.
 * @param configLoader  - Config loader (provides model, API key, chrome profile).
 * @param signal        - Optional abort signal.
 * @param prompt        - Custom prompt for video analysis (default: generic extraction).
 * @param modelOverride - Override the Gemini model.
 * @param timestamp     - Optional timestamp for frame extraction.
 * @param frameCount    - Optional number of frames to extract.
 * @returns Extracted content with thumbnail, or null if all paths fail.
 */
export async function extractYouTubeContent(
    url: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
    prompt?: string,
    modelOverride?: string,
    _timestamp?: string,
    _frameCount?: number,
): Promise<IExtractedContent | null> {
    const config = configLoader.youtube;
    const { videoId } = isYouTubeURL(url);
    const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
    const effectivePrompt = prompt ?? YOUTUBE_PROMPT;
    const effectiveModel = modelOverride ?? config.preferredModel;

    const activityId = activityMonitor.logStart({
        type: "fetch",
        url: `youtube.com/${videoId ?? "video"}`,
    });

    // Try extraction chain: Gemini Web → Gemini API → Perplexity
    const result =
        (await tryGeminiWeb(canonicalUrl, effectivePrompt, effectiveModel, configLoader, signal)) ??
        (await tryGeminiApi(canonicalUrl, effectivePrompt, effectiveModel, configLoader, signal)) ??
        (await tryPerplexity(url, effectivePrompt, configLoader, signal));

    if (result) {
        result.url = url;

        // Add thumbnail
        if (videoId && result.content.length > 0) {
            const thumb = await fetchYouTubeThumbnail(videoId);
            if (thumb) {
                result.thumbnail = thumb;
            }
        }

        activityMonitor.logComplete(activityId, 200);
        return result;
    }

    if (signal?.aborted) {
        activityMonitor.logComplete(activityId, 0);
        return null;
    }

    activityMonitor.logError(activityId, "all extraction paths failed");
    return null;
}
