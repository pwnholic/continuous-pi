/**
 * ──────────────────────────────────────────────
 *  Utils
 * ──────────────────────────────────────────────
 * Shared utility functions ported from the
 * original codebase and consolidated.
 *
 * @module utils
 */

// ── Time formatting ───────────────────────────

/**
 * Format a number of seconds into a human-readable duration string.
 *
 * - Durations ≥ 1 hour → `"H:MM:SS"`
 * - Durations < 1 hour → `"M:SS"`
 *
 * @param s - Total seconds (fractional seconds are floored).
 * @returns The formatted time string.
 */
export function formatSeconds(s: number): string {
    const total = Math.floor(Math.max(0, s));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// ── Error helpers ──────────────────────────────

/**
 * Safely extract `code`, `stderr` and `message` from an exec/spawn error.
 *
 * The returned `stderr` field is always a string — `Buffer` values are
 * decoded as UTF-8.
 *
 * @param err - Any value that may be an exec error object.
 * @returns A normalised error descriptor.
 */
export function readExecError(err: unknown): {
    code?: string;
    stderr: string;
    message: string;
} {
    if (!err || typeof err !== "object") {
        return { stderr: "", message: String(err) };
    }

    const obj = err as Record<string, unknown>;
    const code = typeof obj["code"] === "string" ? obj["code"] : undefined;
    const message = typeof obj["message"] === "string" ? obj["message"] : String(err);
    const stderrRaw = obj["stderr"];

    let stderr = "";
    if (typeof stderrRaw === "string") {
        stderr = stderrRaw;
    } else if (stderrRaw instanceof Buffer) {
        stderr = stderrRaw.toString("utf-8");
    }

    return { code, stderr, message };
}

/**
 * Check whether an unknown value represents a timeout error.
 *
 * Matches `killed` processes, `AbortError` names, `ETIMEDOUT` codes, and
 * messages containing "timed out".
 *
 * @param err - The value to inspect.
 * @returns `true` if the error appears to be a timeout.
 */
export function isTimeoutError(err: unknown): boolean {
    if (!err || typeof err !== "object") {
        return false;
    }

    const obj = err as Record<string, unknown>;
    if (obj["killed"] === true) {
        return true;
    }

    const name = typeof obj["name"] === "string" ? obj["name"] : "";
    const code = typeof obj["code"] === "string" ? obj["code"] : "";
    const message = typeof obj["message"] === "string" ? obj["message"] : "";

    return (
        name === "AbortError" || code === "ETIMEDOUT" || message.toLowerCase().includes("timed out")
    );
}

/**
 * Trim whitespace, collapse internal whitespace runs and cap length.
 *
 * @param text - The raw error text.
 * @returns A cleaned snippet of at most 200 characters.
 */
export function trimErrorText(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Map an ffmpeg-related error to a user-facing message.
 *
 * Handles ENOENT (not installed), timeouts, 403 responses, and generic
 * failures.
 *
 * @param err - The raw error value.
 * @returns A human-readable explanation.
 */
export function mapFfmpegError(err: unknown): string {
    const { code, stderr, message } = readExecError(err);

    if (code === "ENOENT") {
        return "ffmpeg is not installed. Install with: brew install ffmpeg";
    }
    if (isTimeoutError(err)) {
        return "ffmpeg timed out extracting frame";
    }
    if (stderr.includes("403")) {
        return "Stream URL returned 403 — may have expired, try again";
    }

    const snippet = trimErrorText(stderr || message);
    return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}

/**
 * Convert an unknown error value into a stable error message string.
 *
 * This is the consolidated replacement for the several identical
 * `errorMessage()` helpers that existed in the original codebase.
 *
 * @param err - Any error-like value.
 * @returns A string representation of the error.
 */
export function toErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}

/**
 * Check whether an unknown value represents an abort error.
 *
 * This is the consolidated replacement for the several identical
 * `isAbortError()` helpers in the original codebase.
 *
 * @param err - The value to inspect.
 * @returns `true` if the error message contains "abort".
 */
export function isAbortError(err: unknown): boolean {
    return toErrorMessage(err).toLowerCase().includes("abort");
}

// ── Path normalisation ─────────────────────────

/**
 * Convert a path string to use POSIX forward-slash separators.
 *
 * On Windows this replaces backslashes with forward slashes; on Unix
 * the string is returned unchanged.
 *
 * @param p - A file-system path.
 * @returns The same path with only `/` separators.
 */
