/**
 * ──────────────────────────────────────────────
 *  Activity Monitor
 * ──────────────────────────────────────────────
 * Tracks API and fetch operations for observability
 * in the UI and debugging.
 *
 * @module activity
 */

import { ACTIVITY_DEFAULTS } from "./types/activity.js";
import type { IActivityEntry, IRateLimitInfo, ActivityListener } from "./types/activity.js";

// ── Default rate-limit window ─────────────────

const DEFAULT_RATE_LIMIT_INFO: IRateLimitInfo = {
    used: 0,
    max: 10,
    oldestTimestamp: null,
    windowMs: 60_000,
};

// ── Auto-increment ID counter ─────────────────

let nextId = 1;

/**
 * Monitors API and fetch operations.
 *
 * Stores a rolling list of entries (max 10) and exposes
 * listener hooks so the UI can react to changes.
 *
 * ```ts
 * const id = activityMonitor.logStart({ type: "api", query: "…" });
 * // … later …
 * activityMonitor.logComplete(id, 200);
 * ```
 */
export class ActivityMonitor {
    /** Internal circular-buffer of recent entries. */
    #entries: IActivityEntry[] = [];

    /** Maximum number of entries to retain. */
    readonly #maxEntries: number;

    /** Registered change listeners. */
    readonly #listeners = new Set<ActivityListener>();

    /** Current rate-limit info. */
    #rateLimitInfo: IRateLimitInfo = { ...DEFAULT_RATE_LIMIT_INFO };

    constructor(maxEntries: number = ACTIVITY_DEFAULTS.maxEntries) {
        this.#maxEntries = maxEntries;
    }

    // ── Logging ───────────────────────────────────

    /**
     * Record the start of an operation.
     *
     * @param partial - Entry fields excluding the auto-generated `id`, `startTime`, and `status`.
     * @returns The generated entry ID.
     */
    logStart(partial: Omit<IActivityEntry, "id" | "startTime" | "status">): string {
        const id = `act-${nextId++}`;
        const entry: IActivityEntry = {
            ...partial,
            id,
            startTime: Date.now(),
            status: null,
        };
        this.#entries.push(entry);
        if (this.#entries.length > this.#maxEntries) {
            this.#entries.shift();
        }
        this.#notify();
        return id;
    }

    /**
     * Mark an operation as completed successfully.
     *
     * @param id - The entry ID returned by {@link logStart}.
     * @param status - HTTP status code (or equivalent).
     */
    logComplete(id: string, status: number): void {
        const entry = this.#entries.find((e) => e.id === id);
        if (entry) {
            (entry as { endTime?: number }).endTime = Date.now();
            (entry as { status: number | null }).status = status;
            this.#notify();
        }
    }

    /**
     * Mark an operation as failed.
     *
     * @param id - The entry ID returned by {@link logStart}.
     * @param error - Human-readable error description.
     */
    logError(id: string, error: string): void {
        const entry = this.#entries.find((e) => e.id === id);
        if (entry) {
            (entry as { endTime?: number }).endTime = Date.now();
            (entry as { error?: string }).error = error;
            this.#notify();
        }
    }

    /**
     * Clear all entries and reset rate-limit state.
     */
    clear(): void {
        this.#entries = [];
        this.#rateLimitInfo = { ...DEFAULT_RATE_LIMIT_INFO };
        this.#notify();
    }

    // ── Accessors ─────────────────────────────────

    /**
     * Returns a snapshot of the current entries (oldest first).
     */
    getEntries(): readonly IActivityEntry[] {
        return this.#entries;
    }

    /**
     * Returns the current rate-limit info snapshot.
     */
    getRateLimitInfo(): IRateLimitInfo {
        return this.#rateLimitInfo;
    }

    /**
     * Replace the current rate-limit info with new data.
     */
    updateRateLimit(info: IRateLimitInfo): void {
        this.#rateLimitInfo = info;
        this.#notify();
    }

    // ── Listeners ─────────────────────────────────

    /**
     * Register a callback that fires after every state change.
     *
     * @param callback - Function to invoke on updates.
     * @returns A function that unsubscribes the listener.
     */
    onUpdate(callback: ActivityListener): () => void {
        this.#listeners.add(callback);
        return () => {
            this.#listeners.delete(callback);
        };
    }

    // ── Internal helpers ──────────────────────────

    /** Notify all registered listeners (silently catches errors). */
    #notify(): void {
        for (const cb of this.#listeners) {
            try {
                cb();
            } catch {
                // Swallow listener errors so one bad listener
                // doesn't break the entire monitor.
            }
        }
    }
}

/** Singleton instance used across the application. */
export const activityMonitor = new ActivityMonitor();
