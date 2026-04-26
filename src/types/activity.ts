/**
 * ──────────────────────────────────────────────
 *  Activity Types
 * ──────────────────────────────────────────────
 * Types used by the ActivityMonitor to track API /
 * fetch operations for observability.
 */

// ── Activity entry ─────────────────────────────

export interface IActivityEntry {
    readonly id: string;
    readonly type: "api" | "fetch";
    readonly startTime: number;
    readonly endTime?: number;

    /** For API calls — the search query. */
    readonly query?: string;

    /** For URL fetches — the target URL. */
    readonly url?: string;

    /**
     * HTTP status code. `null` means still pending or
     * a network error that doesn't produce a status.
     */
    readonly status: number | null;
    readonly error?: string;
}

// ── Rate-limit info ────────────────────────────

export interface IRateLimitInfo {
    readonly used: number;
    readonly max: number;
    readonly oldestTimestamp: number | null;
    readonly windowMs: number;
}

// ── Activity monitor events ────────────────────

/**
 * Callback signature for activity change listeners.
 */
export type ActivityListener = () => void;

// ── Defaults ───────────────────────────────────

export const ACTIVITY_DEFAULTS = {
    maxEntries: 10,
} as const;
