/**
 * Format seconds to H:MM:SS or M:SS.
 */
export function formatSeconds(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Parse exec error into structured form.
 */
export function readExecError(err: unknown): { code?: string; stderr: string; message: string } {
    if (!err || typeof err !== "object") {
        return { stderr: "", message: String(err) };
    }
    const code = (err as { code?: string }).code;
    const message = (err as { message?: string }).message ?? "";
    const stderrRaw = (err as { stderr?: Buffer | string }).stderr;
    const stderr = Buffer.isBuffer(stderrRaw)
        ? stderrRaw.toString("utf-8")
        : typeof stderrRaw === "string"
          ? stderrRaw
          : "";
    return { code, stderr, message };
}

/**
 * Check if an error is a timeout.
 */
export function isTimeoutError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    if ((err as { killed?: boolean }).killed) return true;
    const name = (err as { name?: string }).name;
    const code = (err as { code?: string }).code;
    // Error.message is on the prototype, so use instanceof to access it
    const message = err instanceof Error ? err.message : ((err as { message?: string }).message ?? "");
    return name === "AbortError" || code === "ETIMEDOUT" || /time.*?out/i.test(message);
}

/**
 * Trim error text for display.
 */
export function trimErrorText(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Map ffmpeg error to user-friendly message.
 */
export function mapFfmpegError(err: unknown): string {
    const { code, stderr, message } = readExecError(err);
    if (code === "ENOENT") return "ffmpeg is not installed. Install with: brew install ffmpeg";
    if (isTimeoutError(err)) return "ffmpeg timed out extracting frame";
    if (stderr.includes("403")) return "Stream URL returned 403 — may have expired, try again";
    const snippet = trimErrorText(stderr || message);
    return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}

/**
 * Extract first H1/H2 heading from markdown text.
 */
export function extractHeadingTitle(text: string): string | null {
    const match = text.match(/^#{1,2}\s+(.+)/m);
    if (!match) return null;
    const cleaned = match[1]?.replace(/\*+/g, "").trim();
    return cleaned || null;
}

/**
 * Extract a readable title from a URL path.
 */
export function extractTitleFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const last = parsed.pathname.split("/").pop();
        return last && last.length > 0 ? last : parsed.hostname;
    } catch {
        return url;
    }
}

/** Check if a URL points to a PDF file */
export function isPDFUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname.toLowerCase();
        return pathname.endsWith(".pdf");
    } catch {
        return url.toLowerCase().endsWith(".pdf");
    }
}

/** Normalize an API key value: trim whitespace, return null if empty or non-string. */
export function normalizeApiKey(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

/** Extract error message from unknown error. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Check if an error is an abort/cancellation error. */
export function isAbortError(err: unknown): boolean {
    return errorMessage(err).toLowerCase().includes("abort");
}
