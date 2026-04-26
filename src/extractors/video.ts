/**
 * ──────────────────────────────────────────────
 *  Local Video Extractor
 * ──────────────────────────────────────────────
 * Detects local video files and extracts content
 * using Gemini's video understanding capabilities.
 *
 * Uploads the video to the Gemini Files API (or
 * sends via Gemini Web) and returns a full
 * analysis including transcripts, visual
 * descriptions, and a thumbnail frame.
 *
 * Fallback chain: Gemini API (Files API) → Gemini Web
 *
 * @module extractors/video
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, extname, basename, join } from "node:path";

import type {
    IExtractedContent,
    IExtractOptions,
    FrameResult,
    IVideoFileInfo,
} from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";

import { isGeminiWebAvailable, queryWithCookies } from "../providers/gemini/web.js";
import {
    queryGeminiApiWithVideo,
    getApiKey,
    uploadToFilesApi,
    pollFileState,
    deleteGeminiFile,
} from "../providers/gemini/api.js";

import { activityMonitor } from "../activity.js";
import { readExecError, trimErrorText, mapFfmpegError } from "../utils.js";

// ── Constants ──────────────────────────────────

const DEFAULT_VIDEO_PROMPT = `Extract the complete content of this video. Include:
1. Video title (infer from content if not explicit), duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

const VIDEO_EXTENSIONS: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".wmv": "video/x-ms-wmv",
    ".flv": "video/x-flv",
    ".3gp": "video/3gpp",
    ".3gpp": "video/3gpp",
};

// ── Helpers ────────────────────────────────────

function shouldRethrow(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.startsWith("Failed to parse ");
}

function extractHeadingTitle(text: string): string | null {
    const match = text.match(/^#\s+(.+)/m);
    return match?.[1]?.trim() ?? null;
}

// ── File detection ─────────────────────────────

/**
 * Check whether the input string points to a supported local video file.
 *
 * Returns {@link IVideoFileInfo} when the file exists and is within
 * the configured size limit, or `null` otherwise.
 *
 * @param input         - A file path (`/`, `./`, `../`, or `file://` prefix).
 * @param configLoader  - Config loader (provides max size, enabled flag).
 */
export function isVideoFile(input: string): IVideoFileInfo | null {
    const isFilePath =
        input.startsWith("/") ||
        input.startsWith("./") ||
        input.startsWith("../") ||
        input.startsWith("file://");

    if (!isFilePath) {
        return null;
    }

    let filePath = input;
    if (input.startsWith("file://")) {
        try {
            filePath = decodeURIComponent(new URL(input).pathname);
        } catch {
            return null;
        }
    }

    const ext = extname(filePath).toLowerCase();
    const mimeType = VIDEO_EXTENSIONS[ext];
    if (!mimeType) {
        return null;
    }

    const absolutePath = resolveFilePath(filePath);
    if (!absolutePath) {
        return null;
    }

    let stats: ReturnType<typeof statSync>;
    try {
        stats = statSync(absolutePath);
    } catch {
        return null;
    }
    if (!stats.isFile()) {
        return null;
    }

    return {
        absolutePath,
        mimeType,
        sizeBytes: stats.size,
    };
}

/**
 * Resolve a file path, handling Unicode normalisation for
 * non-ASCII characters.
 */
function resolveFilePath(filePath: string): string | null {
    const absolutePath = resolve(filePath);
    if (existsSync(absolutePath)) {
        return absolutePath;
    }

    const dir = dirname(absolutePath);
    const base = basename(absolutePath);
    if (!existsSync(dir)) {
        return null;
    }

    try {
        const normalizedBase = normalizeSpaces(base);
        const match = readdirSync(dir).find((f) => normalizeSpaces(f) === normalizedBase);
        return match ? join(dir, match) : null;
    } catch {
        return null;
    }
}

function normalizeSpaces(s: string): string {
    return s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ");
}

// ── Duration ───────────────────────────────────

function mapFfprobeError(err: unknown): string {
    const { code, stderr, message } = readExecError(err);
    if (code === "ENOENT") {
        return "ffprobe is not installed. Install ffmpeg which includes ffprobe";
    }
    const snippet = trimErrorText(stderr || message);
    return snippet ? `ffprobe failed: ${snippet}` : "ffprobe failed";
}

/**
 * Get the duration of a local video file using ffprobe.
 *
 * @param filePath - Absolute path to the video file.
 * @returns Duration in seconds, or an error descriptor.
 */
export async function getLocalVideoDuration(filePath: string): Promise<number | { error: string }> {
    try {
        const output = execFileSync(
            "ffprobe",
            ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
            {
                timeout: 10000,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            },
        ).trim();
        const duration = Number.parseFloat(output);
        if (!Number.isFinite(duration)) {
            return { error: "ffprobe failed: invalid duration output" };
        }
        return duration;
    } catch (err) {
        return { error: mapFfprobeError(err) };
    }
}

// ── Thumbnail frame ────────────────────────────

/**
 * Extract a single frame from a local video file using ffmpeg.
 *
 * @param filePath - Absolute path to the video file.
 * @param seconds  - Offset in seconds (default: 1).
 * @returns Base64-encoded JPEG frame, or an error.
 */
export async function extractVideoFrame(filePath: string, seconds = 1): Promise<FrameResult> {
    try {
        const buffer = execFileSync(
            "ffmpeg",
            [
                "-ss",
                String(seconds),
                "-i",
                filePath,
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
                timeout: 10000,
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

// ── Extraction fallbacks ───────────────────────

async function tryVideoGeminiWeb(
    info: IVideoFileInfo,
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
            files: [info.absolutePath],
            model,
            signal,
            timeoutMs: 180_000,
        });

        return {
            url: info.absolutePath,
            title: extractVideoTitle(text, info.absolutePath),
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

async function tryVideoGeminiApi(
    info: IVideoFileInfo,
    prompt: string,
    model: string,
    apiKey: string,
    signal?: AbortSignal,
): Promise<IExtractedContent | null> {
    if (signal?.aborted) {
        return null;
    }

    let fileName: string | null = null;
    try {
        const uploaded = await uploadToFilesApi(
            info.absolutePath,
            info.mimeType,
            info.sizeBytes,
            apiKey,
            signal,
        );
        fileName = uploaded.name;

        await pollFileState(fileName, apiKey, signal, 120_000);

        const text = await queryGeminiApiWithVideo(prompt, uploaded.uri, apiKey, {
            model,
            mimeType: info.mimeType,
            signal,
            timeoutMs: 120_000,
        });

        return {
            url: info.absolutePath,
            title: extractVideoTitle(text, info.absolutePath),
            content: text,
            error: null,
        };
    } catch (err) {
        if (shouldRethrow(err)) {
            throw err;
        }
        return null;
    } finally {
        if (fileName) {
            deleteGeminiFile(fileName, apiKey);
        }
    }
}

function extractVideoTitle(text: string, filePath: string): string {
    return extractHeadingTitle(text) ?? basename(filePath, extname(filePath));
}

// ── Public API ─────────────────────────────────

/**
 * Extract content from a local video file using Gemini.
 *
 * Uploads the video to the Gemini Files API (or sends via Gemini Web
 * for smaller videos) and returns the analysis as markdown.
 *
 * A thumbnail frame is extracted via ffmpeg when available.
 *
 * @param inputPath     - The local file path.
 * @param configLoader  - Config loader (provides model prefs, keys, size limits).
 * @param signal        - Optional abort signal.
 * @param options       - Extraction options (prompt, model override).
 * @returns Extracted content with thumbnail, or `null` if all paths fail.
 */
export async function extractVideoFileContent(
    inputPath: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
    options?: IExtractOptions,
): Promise<IExtractedContent | null> {
    // Validate the file
    const info = isVideoFile(inputPath);
    if (!info) {
        return null;
    }

    const config = configLoader.video;
    if (!config.enabled) {
        return null;
    }

    // Check size limit
    const maxBytes = config.maxSizeMB * 1024 * 1024;
    if (info.sizeBytes > maxBytes) {
        return {
            url: inputPath,
            title: basename(info.absolutePath),
            content: "",
            error: `Video file exceeds the configured size limit of ${config.maxSizeMB} MB (file is ${(info.sizeBytes / (1024 * 1024)).toFixed(1)} MB).`,
        };
    }

    const effectivePrompt = options?.prompt ?? DEFAULT_VIDEO_PROMPT;
    const effectiveModel = options?.model ?? config.preferredModel;
    const displayName = basename(info.absolutePath);

    const activityId = activityMonitor.logStart({
        type: "fetch",
        url: `video:${displayName}`,
    });

    // Try Gemini API first (better quality), then Gemini Web
    const apiKey = getApiKey(configLoader);
    let result: IExtractedContent | null = null;

    if (apiKey) {
        result = await tryVideoGeminiApi(info, effectivePrompt, effectiveModel, apiKey, signal);
    }

    if (!result) {
        result = await tryVideoGeminiWeb(
            info,
            effectivePrompt,
            effectiveModel,
            configLoader,
            signal,
        );
    }

    if (result) {
        // Add thumbnail frame
        const thumbnail = await extractVideoFrame(info.absolutePath, 1);
        if (!("error" in thumbnail)) {
            result.thumbnail = thumbnail;
        }

        activityMonitor.logComplete(activityId, 200);
        return result;
    }

    if (signal?.aborted) {
        activityMonitor.logComplete(activityId, 0);
        return null;
    }

    activityMonitor.logError(activityId, "all video extraction paths failed");
    return null;
}
