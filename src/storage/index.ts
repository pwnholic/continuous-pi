import type { ExtractedContent } from "../types.js";
import type { QueryResultData, StoredSearchData } from "../types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── In-Memory Store ──────────────────────────────────────────────────────────

const storedResults = new Map<string, StoredSearchData>();

// ─── Public API ───────────────────────────────────────────────────────────────

/** Generate a unique ID for stored results */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Store a search or fetch result */
export function storeResult(id: string, data: StoredSearchData): void {
    storedResults.set(id, data);
}

/** Get a stored result by ID */
export function getResult(id: string): StoredSearchData | null {
    return storedResults.get(id) ?? null;
}

/** Get all stored results */
export function getAllResults(): StoredSearchData[] {
    return Array.from(storedResults.values());
}

/** Delete a stored result */
export function deleteResult(id: string): boolean {
    return storedResults.delete(id);
}

/** Clear all stored results */
export function clearResults(): void {
    storedResults.clear();
}

// ─── Session Persistence ──────────────────────────────────────────────────────

interface SessionEntry {
    type: string;
    customType?: string;
    data?: unknown;
}

interface SessionManager {
    getBranch(): SessionEntry[];
}

interface ExtensionContext {
    sessionManager: SessionManager;
}

/** Validate stored data shape */
function isValidStoredData(data: unknown): data is StoredSearchData {
    if (!data || typeof data !== "object") return false;
    const d = data as Record<string, unknown>;
    if (typeof d.id !== "string" || !d.id) return false;
    if (d.type !== "search" && d.type !== "fetch") return false;
    if (typeof d.timestamp !== "number") return false;
    if (d.type === "search" && !Array.isArray(d.queries)) return false;
    if (d.type === "fetch" && !Array.isArray(d.urls)) return false;
    return true;
}

/** Get all stored results of a specific type */
export function getResultsByType(type: "fetch" | "search"): StoredSearchData[] {
    return Array.from(storedResults.values()).filter((r) => r.type === type);
}

/**
 * Restore stored results from session entries.
 * Call on session_start to recover state across restarts.
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

// Re-export types for convenience
export type { QueryResultData, StoredSearchData, ExtractedContent };
