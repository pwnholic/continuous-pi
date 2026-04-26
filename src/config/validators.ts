/**
 * ──────────────────────────────────────────────
 *  Config Validators
 * ──────────────────────────────────────────────
 * Type-safe normaliser / validator functions used by
 * the config loader to coerce raw JSON and environment
 * values into their expected types.
 *
 * Every function handles `null`, `undefined`, and type
 * mismatches gracefully, applying a sensible fallback.
 */

import type { SearchProvider, SearchWorkflow } from "../types/search.js";

const VALID_PROVIDERS = new Set<string>(["auto", "exa", "perplexity", "gemini"]);
const VALID_WORKFLOWS = new Set<string>(["none", "summary-review"]);

// ── API keys ───────────────────────────────────

/**
 * Normalise an API key value.
 *
 * Accepts only non-empty strings (after trimming).
 * Returns `null` for every other input, including
 * empty / whitespace-only strings.
 *
 * @param value - Raw value from config file or env.
 * @returns The trimmed key, or `null`.
 */
export function normalizeApiKey(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ── Provider ───────────────────────────────────

/**
 * Normalise a search-provider string.
 *
 * Valid values are `"auto"`, `"exa"`, `"perplexity"`,
 * and `"gemini"`.  Everything else (including non-string
 * inputs) falls back to `"auto"`.
 *
 * @param value - Raw provider value.
 * @returns A valid `SearchProvider`.
 */
export function normalizeSearchProvider(value: unknown): SearchProvider {
    if (typeof value !== "string") {
        return "auto";
    }
    const lower = value.trim().toLowerCase();
    return (VALID_PROVIDERS.has(lower) ? lower : "auto") as SearchProvider;
}

// ── Search model ───────────────────────────────

/**
 * Normalise a search-model string.
 *
 * Returns `undefined` for non-string or empty/whitespace
 * values.
 *
 * @param value - Raw model identifier.
 * @returns The trimmed model string, or `undefined`.
 */
export function normalizeSearchModel(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

// ── Boolean flags ──────────────────────────────

/**
 * Normalise a boolean config value.
 *
 * When `value` is not a boolean, returns `fallback`.
 *
 * @param value    - Raw boolean value.
 * @param fallback - Default when the value is not a boolean.
 * @returns The boolean value or `fallback`.
 */
export function normalizeEnabled(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

// ── Positive numbers ───────────────────────────

/**
 * Normalise a positive number config value.
 *
 * Accepts only finite numbers greater than zero.
 * Everything else returns `fallback`.
 *
 * @param value    - Raw numeric value.
 * @param fallback - Default when the value is invalid.
 * @returns A positive finite number, or `fallback`.
 */
export function normalizePositiveNumber(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return value > 0 ? value : fallback;
}

// ── Plain strings ──────────────────────────────

/**
 * Normalise a string config value.
 *
 * Returns `fallback` for non-string or empty/whitespace
 * values.
 *
 * @param value    - Raw string value.
 * @param fallback - Default when the value is empty.
 * @returns The trimmed string, or `fallback`.
 */
export function normalizeString(value: unknown, fallback: string): string {
    if (typeof value !== "string") {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

// ── Curator timeout ────────────────────────────

const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 600;
const DEFAULT_TIMEOUT = 20;

/**
 * Normalise a curator timeout value in seconds.
 *
 * Clamps the result to `[1, 600]`.  When the input is
 * not a finite number, falls back to `fallback` (default `20`).
 *
 * @param value    - Raw timeout value.
 * @param fallback - Default when the value is invalid (default `20`).
 * @returns A clamped timeout in seconds.
 */
export function normalizeCuratorTimeoutSeconds(
    value: unknown,
    fallback: number = DEFAULT_TIMEOUT,
): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return clamp(fallback, MIN_TIMEOUT, MAX_TIMEOUT);
    }
    return clamp(Math.floor(value), MIN_TIMEOUT, MAX_TIMEOUT);
}

// ── Search workflow ────────────────────────────

/**
 * Normalise a search workflow string.
 *
 * Valid values are `"none"` and `"summary-review"`.
 * Everything else (including non-string inputs) falls
 * back to `"summary-review"`.
 *
 * @param value - Raw workflow value.
 * @returns A valid `SearchWorkflow`.
 */
export function normalizeSearchWorkflow(value: unknown): SearchWorkflow {
    if (typeof value !== "string") {
        return "summary-review";
    }
    const lower = value.trim().toLowerCase();
    return (VALID_WORKFLOWS.has(lower) ? lower : "summary-review") as SearchWorkflow;
}

// ── Chrome profile ─────────────────────────────

/**
 * Normalise a Chrome/Chromium profile path string.
 *
 * Returns `undefined` for non-string or empty/whitespace
 * values.
 *
 * @param value - Raw profile path.
 * @returns The trimmed path, or `undefined`.
 */
export function normalizeChromeProfile(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

// ── Helpers ────────────────────────────────────

/**
 * Clamp a number to the inclusive range `[min, max]`.
 */
function clamp(n: number, min: number, max: number): number {
    return Math.min(Math.max(n, min), max);
}
