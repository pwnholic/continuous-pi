// ──────────────────────────────────────────────
//  Storage Module
// ──────────────────────────────────────────────
// In-memory cache for search / fetch results with
// TTL-based expiry.  Supports restoring data from
// a session when the extension activates.
// ──────────────────────────────────────────────

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { IExtractedContent, ISearchResult } from "./types/index.js";

// ── Constants ──────────────────────────────────

/** Results older than this are considered stale. */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ── Public interfaces ──────────────────────────

/**
 * Data produced from running a single query through a
 * search provider.
 */
export interface IQueryResultData {
    /** The search query that was issued. */
    readonly query: string;
    /** The synthesised answer text. */
    readonly answer: string;
    /** Source citations returned with the answer. */
    readonly results: readonly ISearchResult[];
    /** Error message if the query failed, or `null`. */
    readonly error: string | null;
    /** The provider that fulfilled this query. */
    readonly provider?: string;
}

/**
 * A stored search or fetch result, keyed by a unique id.
 *
 * - `"search"` entries carry one or more `queries`.
 * - `"fetch"` entries carry extracted URL content.
 */
export interface IStoredSearchData {
    readonly id: string;
    readonly type: "search" | "fetch";
    /** Unix-epoch milliseconds when this data was stored. */
    readonly timestamp: number;
    /** Populated when `type === "search"`. */
    readonly queries?: readonly IQueryResultData[];
    /** Populated when `type === "fetch"`. */
    readonly urls?: readonly IExtractedContent[];
}

// ── Internal state ─────────────────────────────

const storedResults = new Map<string, IStoredSearchData>();

// ── Public API ─────────────────────────────────

/**
 * Generate a short, reasonably-unique identifier for a
 * stored result.
 *
 * @example
 * ```ts
 * generateId() // → "l3x8a1b2c3d4"
 * ```
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Store a search or fetch result under the given `id`.
 *
 * Overwrites any existing entry with the same id.
 */
export function storeResult(id: string, data: IStoredSearchData): void {
    storedResults.set(id, data);
}

/**
 * Retrieve a previously-stored result, or `null` when the
 * id is unknown.
 */
export function getResult(id: string): IStoredSearchData | null {
    return storedResults.get(id) ?? null;
}

/**
 * Returns every currently-stored result (copy of internal
 * map values).
 */
export function getAllResults(): IStoredSearchData[] {
    return Array.from(storedResults.values());
}

/**
 * Delete a single result by id.
 *
 * @returns `true` if the entry existed and was removed.
 */
export function deleteResult(id: string): boolean {
    return storedResults.delete(id);
}

/**
 * Remove all cached results from memory.
 */
export function clearResults(): void {
    storedResults.clear();
}

/**
 * Type guard that checks whether an arbitrary value conforms
 * to {@link IStoredSearchData}.
 */
function isValidStoredData(data: unknown): data is IStoredSearchData {
    if (!data || typeof data !== "object") {
        return false;
    }

    const d = data as Record<string, unknown>;

    if (typeof d["id"] !== "string" || (d["id"] as string).length === 0) {
        return false;
    }
    if (d["type"] !== "search" && d["type"] !== "fetch") {
        return false;
    }
    if (typeof d["timestamp"] !== "number") {
        return false;
    }
    if (d["type"] === "search" && !Array.isArray(d["queries"])) {
        return false;
    }
    if (d["type"] === "fetch" && !Array.isArray(d["urls"])) {
        return false;
    }

    return true;
}

/**
 * Restore previously-cached results from the session's
 * `"web-search-results"` entries.
 *
 * Entries older than {@link CACHE_TTL_MS} are silently
 * dropped.  Call this once on extension activation.
 */
export function restoreFromSession(ctx: ExtensionContext): void {
    storedResults.clear();

    const now = Date.now();

    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "custom" && entry.customType === "web-search-results") {
            const data = entry.data;

            if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) {
                storedResults.set(data.id, data);
            }
        }
    }
}
