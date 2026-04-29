import { getApiBaseUrl, loadConfig } from "../config.js";
import { normalizeApiKey } from "../utils.js";

export const API_BASE = getApiBaseUrl("gemini");
export const DEFAULT_MODEL = "gemini-3-flash-preview";

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/** Get the Gemini API key from config or env */
export function getApiKey(): string | null {
    return normalizeApiKey(process.env.GEMINI_API_KEY) ?? normalizeApiKey(loadConfig().geminiApiKey);
}

/** Check if Gemini API key is available */
export function isGeminiApiAvailable(): boolean {
    return getApiKey() !== null;
}

export interface GeminiApiOptions {
    model?: string;
    mimeType?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

interface GenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

/**
 * Query Gemini API with a video file.
 * Uses the generateContent endpoint with fileData.
 */
export async function queryGeminiApiWithVideo(
    prompt: string,
    videoUri: string,
    options: GeminiApiOptions = {},
): Promise<string> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const model = options.model ?? DEFAULT_MODEL;
    const timeoutMs = options.timeoutMs ?? 120000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

    const fileData: Record<string, string> = { fileUri: videoUri };
    if (options.mimeType) fileData.mimeType = options.mimeType;

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

    if (!text) throw new Error("Gemini API returned empty response");
    return text;
}
