/**
 * ──────────────────────────────────────────────
 *  Gemini Web Provider
 * ──────────────────────────────────────────────
 * Authenticates to gemini.google.com using cookies
 * extracted from a supported Chromium-based browser
 * and sends prompts via the internal StreamGenerate
 * API.
 *
 * This provider requires the user to be signed into
 * gemini.google.com in Chrome, Arc, Helium, or
 * Chromium on macOS / Linux.
 *
 * @module providers/gemini/web
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { IConfigLoader } from "../../config/index.js";
import { getGoogleCookies, type CookieMap } from "./cookies.js";

// ── Constants ──────────────────────────────────

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const GOOGLE_LIST_ACCOUNTS_URL =
    "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&laf=b64bin&json=standard";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

/**
 * Known model → header-value mapping for the
 * `x-goog-ext-525001261-jspb` header.
 */
const MODEL_HEADERS: Record<string, string> = {
    "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
    "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120_000;

// ── Public option type ─────────────────────────

export interface GeminiWebOptions {
    /** A YouTube URL to include in the prompt context. */
    youtubeUrl?: string;
    /** Gemini model identifier. */
    model?: string;
    /** Local file paths to upload as context. */
    files?: string[];
    /** External abort signal. */
    signal?: AbortSignal;
    /** Request timeout in milliseconds (default: 120_000). */
    timeoutMs?: number;
}

// ── Internal types ─────────────────────────────

interface GeminiWebResult {
    text: string;
    errorCode?: number;
    errorMessage?: string;
}

// ── Public helpers ─────────────────────────────

/**
 * Build a cookie header string from a CookieMap.
 */
function buildCookieHeader(cookieMap: CookieMap): string {
    return Object.entries(cookieMap)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

/**
 * Check whether Gemini Web is available by trying to extract
 * Google cookies from a supported Chromium-based browser.
 *
 * @param configLoader - Config loader (provides chromeProfile).
 * @returns The extracted cookie map, or `null` if unavailable.
 */
export async function isGeminiWebAvailable(configLoader: IConfigLoader): Promise<CookieMap | null> {
    const result = await getGoogleCookies({
        profile: configLoader.chromeProfile,
        requiredCookies: REQUIRED_COOKIES,
    });
    if (!result) {
        return null;
    }
    return result.cookies;
}

/**
 * Get the email address of the currently authenticated Google
 * account in the browser.
 *
 * @param cookies - Cookie map from `getGoogleCookies`.
 * @returns The email string, or `null` if it could not be determined.
 */
export async function getActiveGoogleEmail(cookies: CookieMap): Promise<string | null> {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader) {
        return null;
    }

    // Try Gemini HTML first
    try {
        const html = await fetchWithRedirects(
            GEMINI_APP_URL,
            cookieHeader,
            10,
            AbortSignal.timeout(10_000),
        );
        const email = extractEmailFromGeminiHtml(html);
        if (email) {
            return email;
        }
    } catch {
        // fall through
    }

    // Try ListAccounts API
    try {
        const response = await fetchWithRedirects(
            GOOGLE_LIST_ACCOUNTS_URL,
            cookieHeader,
            10,
            AbortSignal.timeout(10_000),
        );
        return extractEmailFromListAccounts(response);
    } catch {
        return null;
    }
}

// ── Public API: query ──────────────────────────

/**
 * Send a prompt to Gemini Web using cookie-based authentication
 * and return the response text.
 *
 * Automatically falls back to `gemini-2.5-flash` if the requested
 * model is unavailable.
 *
 * @param prompt    - The prompt text.
 * @param cookieMap - Cookie map obtained from `getGoogleCookies`.
 * @param options   - Optional parameters (model, files, signal, timeout).
 * @returns The generated text response.
 * @throws {Error} If authentication fails or the API returns an error.
 */
export async function queryWithCookies(
    prompt: string,
    cookieMap: CookieMap,
    options: GeminiWebOptions = {},
): Promise<string> {
    const model = options.model && MODEL_HEADERS[options.model] ? options.model : DEFAULT_MODEL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let fullPrompt = prompt;
    if (options.youtubeUrl) {
        fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
    }

    const result = await runGeminiWebOnce(
        fullPrompt,
        cookieMap,
        model,
        options.files,
        timeoutMs,
        options.signal,
    );

    // If model is unavailable and we have a fallback model, retry
    if (isModelUnavailable(result.errorCode) && model !== DEFAULT_MODEL) {
        const fallback = await runGeminiWebOnce(
            fullPrompt,
            cookieMap,
            DEFAULT_MODEL,
            options.files,
            timeoutMs,
            options.signal,
        );
        if (fallback.errorMessage) {
            throw new Error(fallback.errorMessage);
        }
        if (!fallback.text) {
            throw new Error("Gemini Web returned empty response (fallback model)");
        }
        return fallback.text;
    }

    if (result.errorMessage) {
        throw new Error(result.errorMessage);
    }
    if (!result.text) {
        throw new Error("Gemini Web returned empty response");
    }
    return result.text;
}

// ── Internal: single attempt ───────────────────

async function runGeminiWebOnce(
    prompt: string,
    cookieMap: CookieMap,
    model: string,
    files: string[] | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<GeminiWebResult> {
    const effectiveSignal = withTimeout(signal, timeoutMs);
    const cookieHeader = buildCookieHeader(cookieMap);

    // Fetch access token
    let accessToken: string;
    try {
        accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);
    } catch (err) {
        return {
            text: "",
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }

    // Upload files if provided
    const uploaded: Array<{ id: string; name: string }> = [];
    if (files) {
        for (const filePath of files) {
            try {
                uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
            } catch (err) {
                return {
                    text: "",
                    errorMessage: `File upload failed: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }
    }

    // Build and send request
    const fReq = buildFReqPayload(prompt, uploaded);
    const params = new URLSearchParams();
    params.set("at", accessToken);
    params.set("f.req", fReq);

    let response: Response;
    try {
        response = await fetch(GEMINI_STREAM_GENERATE_URL, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded;charset=utf-8",
                host: "gemini.google.com",
                origin: "https://gemini.google.com",
                referer: "https://gemini.google.com/",
                "x-same-domain": "1",
                "user-agent": USER_AGENT,
                cookie: cookieHeader,
                [MODEL_HEADER_NAME(model)]: MODEL_HEADERS[model]!,
            } as Record<string, string>,
            body: params.toString(),
            signal: effectiveSignal,
        });
    } catch (err) {
        return {
            text: "",
            errorMessage: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    let rawText: string;
    try {
        rawText = await response.text();
    } catch (err) {
        return {
            text: "",
            errorMessage: `Failed to read response: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    if (!response.ok) {
        return {
            text: "",
            errorMessage: `Gemini Web request failed: ${response.status}`,
        };
    }

    try {
        return parseStreamGenerateResponse(rawText);
    } catch (err) {
        let errorCode: number | undefined;
        try {
            const json = JSON.parse(trimJsonEnvelope(rawText));
            errorCode = extractErrorCode(json);
        } catch {
            // ignore
        }
        return {
            text: "",
            errorCode,
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }
}

// ── Model header helper ────────────────────────

function MODEL_HEADER_NAME(_model: string): string {
    return "x-goog-ext-525001261-jspb";
}

// ── Access token ───────────────────────────────

async function fetchAccessToken(cookieHeader: string, signal: AbortSignal): Promise<string> {
    const html = await fetchWithRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);

    for (const key of ["SNlM0e", "thykhd"]) {
        const match = html.match(new RegExp(`"${key}":"(.*?)"`));
        if (match?.[1]) {
            return match[1];
        }
    }

    throw new Error(
        "Unable to authenticate with Gemini Web. " +
            "Make sure you're signed into gemini.google.com " +
            "in a supported Chromium-based browser.",
    );
}

// ── HTTP helpers ───────────────────────────────

async function fetchWithRedirects(
    url: string,
    cookieHeader: string,
    maxRedirects: number,
    signal: AbortSignal,
): Promise<string> {
    let current = url;
    for (let i = 0; i <= maxRedirects; i++) {
        const res = await fetch(current, {
            headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
            redirect: "manual",
            signal,
        });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (location) {
                current = new URL(location, current).toString();
                continue;
            }
        }
        return await res.text();
    }
    throw new Error(`Too many redirects (>${maxRedirects})`);
}

// ── Email extraction ───────────────────────────

function extractEmailFromGeminiHtml(html: string): string | null {
    const patterns = [
        /"email"\s*:\s*"([^"]+)"/,
        /"displayEmail"\s*:\s*"([^"]+)"/,
        /"identifier"\s*:\s*"([^"]+)"/,
        /"defaultEmail"\s*:\s*"([^"]+)"/,
        /"gaiaIdentifier"\s*:\s*"([^"]+)"/,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        const email = normalizeEmail(match?.[1]);
        if (email) {
            return email;
        }
    }

    return findFirstEmail(html);
}

function extractEmailFromListAccounts(text: string): string | null {
    const trimmed = text.replace(/^\)\]\}'\s*/, "");
    try {
        return findEmailInValue(JSON.parse(trimmed)) ?? findFirstEmail(trimmed);
    } catch {
        return findFirstEmail(trimmed);
    }
}

function findEmailInValue(value: unknown): string | null {
    if (typeof value === "string") {
        return normalizeEmail(value);
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const email = findEmailInValue(item);
            if (email) {
                return email;
            }
        }
        return null;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value as Record<string, unknown>)) {
            const email = findEmailInValue(item);
            if (email) {
                return email;
            }
        }
    }
    return null;
}

function findFirstEmail(text: string): string | null {
    const normalized = decodeEmailEscapes(text);
    const match = normalized.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match?.[0] ?? null;
}

function normalizeEmail(value: string | undefined): string | null {
    if (!value) {
        return null;
    }
    const normalized = decodeEmailEscapes(value.trim());
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ? normalized : null;
}

function decodeEmailEscapes(value: string): string {
    return value
        .replace(/\\u0040/gi, "@")
        .replace(/\\x40/gi, "@")
        .replace(/&#64;/gi, "@")
        .replace(/&commat;/gi, "@")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
}

// ── File upload ────────────────────────────────

async function uploadFile(
    filePath: string,
    cookieHeader: string,
    signal: AbortSignal,
): Promise<{ id: string; name: string }> {
    const data = readFileSync(filePath);
    const fileName = basename(filePath);
    const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([Buffer.from(header, "utf-8"), data, Buffer.from(footer, "utf-8")]);

    const res = await fetch(GEMINI_UPLOAD_URL, {
        method: "POST",
        headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "push-id": GEMINI_UPLOAD_PUSH_ID,
            "user-agent": USER_AGENT,
            cookie: cookieHeader,
        },
        body,
        signal,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`File upload failed: ${res.status} (${text.slice(0, 200)})`);
    }

    return { id: await res.text(), name: fileName };
}

// ── Request payload building ───────────────────

function buildFReqPayload(prompt: string, uploaded: Array<{ id: string; name: string }>): string {
    const promptPayload =
        uploaded.length > 0 ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])] : [prompt];
    const innerList = [promptPayload, null, null];
    return JSON.stringify([null, JSON.stringify(innerList)]);
}

// ── Signal helper ──────────────────────────────

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ── Response parsing ───────────────────────────

function trimJsonEnvelope(text: string): string {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Gemini Web response did not contain a JSON payload.");
    }
    return text.slice(start, end + 1);
}

function extractErrorCode(responseJson: unknown): number | undefined {
    const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
    return typeof code === "number" && code >= 0 ? code : undefined;
}

function isModelUnavailable(errorCode: number | undefined): boolean {
    return errorCode === 1052;
}

function getNestedValue(value: unknown, pathParts: number[]): unknown {
    let current: unknown = value;
    for (const part of pathParts) {
        if (current == null) {
            return undefined;
        }
        if (!Array.isArray(current)) {
            return undefined;
        }
        current = (current as unknown[])[part];
    }
    return current;
}

function parseStreamGenerateResponse(rawText: string): GeminiWebResult {
    const responseJson = JSON.parse(trimJsonEnvelope(rawText));
    const errorCode = extractErrorCode(responseJson);

    const parts = Array.isArray(responseJson) ? responseJson : [];
    let body: unknown = null;

    for (let i = 0; i < parts.length; i++) {
        const partBody = getNestedValue(parts[i], [2]);
        if (!partBody || typeof partBody !== "string") {
            continue;
        }
        try {
            const parsed = JSON.parse(partBody);
            const candidateList = getNestedValue(parsed, [4]);
            if (Array.isArray(candidateList) && candidateList.length > 0) {
                body = parsed;
                break;
            }
        } catch {
            // skip malformed parts
        }
    }

    const candidateList = getNestedValue(body, [4]);
    const firstCandidate = Array.isArray(candidateList)
        ? (candidateList as unknown[])[0]
        : undefined;
    const textRaw = getNestedValue(firstCandidate, [1, 0]) as string | undefined;

    let text = textRaw ?? "";
    if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
        const alt = getNestedValue(firstCandidate, [22, 0]) as string | undefined;
        if (alt) {
            text = alt;
        }
    }

    return { text, errorCode };
}
