/**
 * ──────────────────────────────────────────────
 *  Gemini REST API Provider
 * ──────────────────────────────────────────────
 * Provides access to Google's Gemini models via the
 * official REST API (generateContent endpoint).
 *
 * Also supports the Files API for video upload and
 * processing.
 *
 * @module providers/gemini/api
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { IConfigLoader } from "../../config/index.js";
import { activityMonitor } from "../../activity.js";
import { toErrorMessage, isAbortError } from "../../utils.js";

// ── Constants ──────────────────────────────────

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";
export const DEFAULT_MODEL = "gemini-3-flash-preview";

// ── Response types ─────────────────────────────

interface GroundingChunk {
    web?: { uri?: string; title?: string };
}

interface GenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
        groundingMetadata?: {
            webSearchQueries?: string[];
            groundingChunks?: GroundingChunk[];
            groundingSupports?: Array<{
                segment?: { startIndex?: number; endIndex?: number; text?: string };
                groundingChunkIndices?: number[];
            }>;
        };
    }>;
}

interface FileUploadResult {
    file: { name: string; uri: string; state?: string };
}

// ── API key helpers ────────────────────────────

export function getApiKey(configLoader: IConfigLoader): string | null {
    return configLoader.geminiApiKey;
}

export function isGeminiApiAvailable(configLoader: IConfigLoader): boolean {
    return getApiKey(configLoader) !== null;
}

// ── Signal helper ──────────────────────────────

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ── Search / query types ───────────────────────

export interface GeminiApiOptions {
    model?: string;
    mimeType?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

// ── Gemini API search (with Google Search grounding) ──

export async function searchWithGeminiApi(
    query: string,
    configLoader: IConfigLoader,
    options: GeminiApiOptions = {},
): Promise<{
    answer: string;
    results: Array<{ title: string; url: string }>;
} | null> {
    const apiKey = getApiKey(configLoader);
    if (!apiKey) {
        return null;
    }

    const model = options.model ?? configLoader.searchModel ?? DEFAULT_MODEL;
    const signal = withTimeout(options.signal, 60_000);
    const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const activityId = activityMonitor.logStart({ type: "api", query });

    try {
        const body = {
            contents: [{ parts: [{ text: query }] }],
            tools: [{ google_search: {} }],
        };

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error ${response.status}: ${errorText.slice(0, 300)}`);
        }

        const data = (await response.json()) as GenerateContentResponse;
        activityMonitor.logComplete(activityId, response.status);

        const answer =
            data.candidates?.[0]?.content?.parts
                ?.map((p) => p.text)
                .filter(Boolean)
                .join("\n") ?? "";

        const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
        const results: Array<{ title: string; url: string }> = [];

        if (chunks) {
            for (const chunk of chunks) {
                if (!chunk.web) {
                    continue;
                }
                let url = chunk.web.uri || "";
                if (url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
                    const resolved = await resolveRedirect(url, signal);
                    if (resolved) {
                        url = resolved;
                    }
                }
                if (url) {
                    results.push({ title: chunk.web.title || "", url });
                }
            }
        }

        if (!answer && results.length === 0) {
            return null;
        }
        return { answer, results };
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        throw err;
    }
}

async function resolveRedirect(proxyUrl: string, signal: AbortSignal): Promise<string | null> {
    try {
        const res = await fetch(proxyUrl, {
            method: "HEAD",
            redirect: "manual",
            signal: AbortSignal.any([AbortSignal.timeout(5000), signal]),
        });
        return res.headers.get("location") || null;
    } catch {
        return null;
    }
}

// ── Video file API ─────────────────────────────

export async function queryGeminiApiWithVideo(
    prompt: string,
    videoUri: string,
    apiKey: string,
    options: GeminiApiOptions = {},
): Promise<string> {
    const model = options.model ?? DEFAULT_MODEL;
    const signal = withTimeout(options.signal, options.timeoutMs ?? 120_000);
    const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const fileData: Record<string, string> = { fileUri: videoUri };
    if (options.mimeType) {
        fileData.mimeType = options.mimeType;
    }

    const body = {
        contents: [
            {
                parts: [{ fileData }, { text: prompt }],
            },
        ],
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errorText.slice(0, 300)}`);
    }

    const data = (await res.json()) as GenerateContentResponse;
    const text = data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .filter(Boolean)
        .join("\n");

    if (!text) {
        throw new Error("Gemini API returned empty response");
    }
    return text;
}

export async function uploadToFilesApi(
    absolutePath: string,
    mimeType: string,
    sizeBytes: number,
    apiKey: string,
    signal?: AbortSignal,
): Promise<{ name: string; uri: string }> {
    const displayName = basename(absolutePath);

    const initRes = await fetch(`${UPLOAD_BASE}/files`, {
        method: "POST",
        headers: {
            "x-goog-api-key": apiKey,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(sizeBytes),
            "X-Goog-Upload-Header-Content-Type": mimeType,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: displayName } }),
        signal,
    });

    if (!initRes.ok) {
        const text = await initRes.text();
        throw new Error(`File upload init failed: ${initRes.status} (${text.slice(0, 200)})`);
    }

    const uploadUrl = initRes.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
        throw new Error("No upload URL in response headers");
    }

    const fileData = readFileSync(absolutePath);
    const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Length": String(sizeBytes),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
        },
        body: fileData,
        signal,
    });

    if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new Error(`File upload failed: ${uploadRes.status} (${text.slice(0, 200)})`);
    }

    const result = (await uploadRes.json()) as FileUploadResult;
    return result.file;
}

export async function pollFileState(
    fileName: string,
    apiKey: string,
    signal?: AbortSignal,
    timeoutMs = 120_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (signal?.aborted) {
            throw new Error("Aborted");
        }

        const res = await fetch(`${API_BASE}/${fileName}?key=${apiKey}`, {
            signal,
        });
        if (!res.ok) {
            throw new Error(`File state check failed: ${res.status}`);
        }

        const data = (await res.json()) as { state: string };
        if (data.state === "ACTIVE") {
            return;
        }
        if (data.state === "FAILED") {
            throw new Error("File processing failed");
        }

        await new Promise((r) => setTimeout(r, 5_000));
    }

    throw new Error("File processing timed out");
}

export function deleteGeminiFile(fileName: string, apiKey: string): void {
    fetch(`${API_BASE}/${fileName}?key=${apiKey}`, { method: "DELETE" }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to delete Gemini file ${fileName}: ${msg}`);
    });
}
