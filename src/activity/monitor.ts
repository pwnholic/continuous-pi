import type { ActivityEntry, RateLimitInfo } from "../types.js";

// ─── Activity Monitor ─────────────────────────────────────────────────────────

export class ActivityMonitor {
    private entries: ActivityEntry[] = [];
    private readonly maxEntries = 10;
    private listeners = new Set<() => void>();
    private rateLimitInfo: RateLimitInfo = {
        used: 0,
        max: 10,
        oldestTimestamp: null,
        windowMs: 60000,
    };
    private nextId = 1;

    /** Log the start of an activity */
    logStart(partial: Omit<ActivityEntry, "id" | "startTime" | "status">): string {
        const id = `act-${this.nextId++}`;
        const entry: ActivityEntry = {
            ...partial,
            id,
            startTime: Date.now(),
            status: null,
        };
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
        this.notify();
        return id;
    }

    /** Mark an activity as complete */
    logComplete(id: string, status: number): void {
        const entry = this.entries.find((e) => e.id === id);
        if (entry) {
            entry.endTime = Date.now();
            entry.status = status;
            this.notify();
        }
    }

    /** Mark an activity as errored */
    logError(id: string, error: string): void {
        const entry = this.entries.find((e) => e.id === id);
        if (entry) {
            entry.endTime = Date.now();
            entry.error = error;
            this.notify();
        }
    }

    /** Get all activity entries */
    getEntries(): readonly ActivityEntry[] {
        return this.entries;
    }

    /** Get current rate limit info */
    getRateLimitInfo(): RateLimitInfo {
        return this.rateLimitInfo;
    }

    /** Update rate limit info */
    updateRateLimit(info: RateLimitInfo): void {
        this.rateLimitInfo = info;
        this.notify();
    }

    /** Subscribe to activity updates. Returns unsubscribe function. */
    onUpdate(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /** Clear all activity */
    clear(): void {
        this.entries = [];
        this.rateLimitInfo = {
            used: 0,
            max: 10,
            oldestTimestamp: null,
            windowMs: 60000,
        };
        this.notify();
    }

    private notify(): void {
        for (const cb of this.listeners) {
            try {
                cb();
            } catch {
                // Swallow listener errors
            }
        }
    }
}

/** Singleton activity monitor instance */
export const activityMonitor = new ActivityMonitor();
