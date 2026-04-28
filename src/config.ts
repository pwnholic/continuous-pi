import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Schema — Zod validation untuk ~/.pi/web-search.json
// ═══════════════════════════════════════════════════════════════════════════════

const WebSearchConfigSchema = z.object({
    // ── General ────────────────────────────────────────────────────────────────
    provider: z.enum(["auto", "perplexity", "exa", "gemini"]).optional(),
    workflow: z.enum(["none", "summary-review"]).optional(),
    curatorTimeoutSeconds: z.number().int().min(1).max(600).optional(),

    // ── API Keys ────────────────────────────────────────────────────────────────
    perplexityApiKey: z.string().optional(),
    exaApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),

    // ── API Base URLs ──────────────────────────────────────────────────────────
    perplexityApiBase: z.string().url().optional(),
    exaApiBase: z.string().url().optional(),
    geminiApiBase: z.string().url().optional(),
    geminiWebAppUrl: z.string().url().optional(),
    geminiWebApiBase: z.string().url().optional(),
    geminiWebUploadBase: z.string().url().optional(),
    geminiApiUploadBase: z.string().url().optional(),

    // ── Models ─────────────────────────────────────────────────────────────────
    models: z
        .object({
            /** Default model for summary generation (format: provider/id) */
            summarizer: z.string().optional(),
            /** Default model for video analysis (format: provider/id) */
            video: z.string().optional(),
            /** Preferred summary models fallback chain */
            preferred: z
                .array(
                    z.object({
                        provider: z.string(),
                        id: z.string(),
                    }),
                )
                .optional(),
        })
        .optional(),

    // ── Shortcuts ──────────────────────────────────────────────────────────────
    shortcuts: z
        .object({
            curate: z.string().optional(),
            activity: z.string().optional(),
        })
        .optional(),

    // ── Gemini Web ──────────────────────────────────────────────────────────────
    chromeProfile: z.string().optional(),

    // ── YouTube ─────────────────────────────────────────────────────────────────
    youtube: z
        .object({
            enabled: z.boolean().optional(),
            preferredModel: z.string().optional(),
        })
        .optional(),

    // ── Local Video ─────────────────────────────────────────────────────────────
    video: z
        .object({
            enabled: z.boolean().optional(),
            preferredModel: z.string().optional(),
            maxSizeMB: z.number().positive().optional(),
        })
        .optional(),

    // ── GitHub Clone ────────────────────────────────────────────────────────────
    githubClone: z
        .object({
            enabled: z.boolean().optional(),
            maxRepoSizeMB: z.number().positive().optional(),
            cloneTimeoutSeconds: z.number().positive().optional(),
            clonePath: z.string().optional(),
        })
        .optional(),

    // ── Webclaw ─────────────────────────────────────────────────────────────────
    webclaw: z
        .object({
            path: z.string().optional(),
            browser: z.enum(["chrome", "firefox", "safari-ios", "random"]).optional(),
            proxy: z.string().optional(),
            fallbackToReadability: z.boolean().optional(),
        })
        .optional(),
});

export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults — semua nilai default terpusat di sini
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULTS = {
    // ── General ────────────────────────────────────────────────────────────────
    curatorTimeoutSeconds: 20,
    shortcutCurate: "ctrl+shift+s" as const,
    shortcutActivity: "ctrl+shift+w" as const,

    // ── API Base URLs ──────────────────────────────────────────────────────────
    perplexityApiBase: "https://api.perplexity.ai/chat/completions" as const,
    exaApiBase: "https://api.exa.ai" as const,
    geminiApiBase: "https://generativelanguage.googleapis.com/v1beta" as const,
    geminiWebAppUrl: "https://gemini.google.com/app" as const,
    geminiWebApiBase:
        "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate" as const,
    geminiWebUploadBase: "https://content-push.googleapis.com/upload" as const,
    geminiApiUploadBase: "https://generativelanguage.googleapis.com/upload/v1beta" as const,

    // ── Models ─────────────────────────────────────────────────────────────────
    /** Default model for summary generation */
    summarizerModel: "anthropic/claude-haiku-4-5" as const,
    /** Default model for video analysis */
    videoModel: "gemini-3-flash-preview" as const,
    /** Preferred summary models fallback chain */
    preferredSummaryModels: [
        { provider: "anthropic", id: "claude-haiku-4-5" },
        { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
    ] as const,

    // ── YouTube ────────────────────────────────────────────────────────────────
    youtubeEnabled: true,
    youtubeModel: "gemini-3-flash-preview" as const,

    // ── Video ──────────────────────────────────────────────────────────────────
    videoEnabled: true,
    videoMaxSizeMB: 50,

    // ── Webclaw ────────────────────────────────────────────────────────────────
    webclawBrowser: "chrome" as const,
    webclawFallbackToReadability: true,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Path
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

// ═══════════════════════════════════════════════════════════════════════════════
// Loader
// ═══════════════════════════════════════════════════════════════════════════════

let cachedConfig: WebSearchConfig | null = null;

/**
 * Load config from ~/.pi/web-search.json.
 */
export function loadConfig(): WebSearchConfig {
    if (cachedConfig) return cachedConfig;

    if (!existsSync(CONFIG_PATH)) {
        cachedConfig = {};
        return cachedConfig;
    }

    const raw = readFileSync(CONFIG_PATH, "utf-8");
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }

    const result = WebSearchConfigSchema.safeParse(parsed);
    if (result.success) {
        cachedConfig = result.data;
    } else {
        console.error("[pi-web-access] Config validation warnings:");
        for (const issue of result.error.issues) {
            console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
        }
        cachedConfig = parsed as WebSearchConfig;
    }

    return cachedConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Save
// ═══════════════════════════════════════════════════════════════════════════════

export function saveConfig(updates: Partial<WebSearchConfig>): void {
    const current = loadConfig();
    const merged = { ...current, ...updates };
    const dir = join(homedir(), ".pi");

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    writeFileSync(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`);
    cachedConfig = merged;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Get the config file path */
export function getConfigPath(): string {
    return CONFIG_PATH;
}

/** Load config with graceful error handling */
export function loadConfigSafe(): WebSearchConfig {
    try {
        return loadConfig();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[pi-web-access] ${message}`);
        return {};
    }
}

/** Get webclaw config with defaults */
export function getWebclawConfig(config?: Partial<WebSearchConfig>): {
    path?: string;
    browser: string;
    proxy?: string;
    fallbackToReadability: boolean;
} {
    const cfg = config ?? loadConfig();
    const wc = cfg.webclaw ?? {};
    return {
        path: wc.path,
        browser: wc.browser ?? DEFAULTS.webclawBrowser,
        proxy: wc.proxy,
        fallbackToReadability: wc.fallbackToReadability ?? DEFAULTS.webclawFallbackToReadability,
    };
}

/**
 * Get summary models config.
 * Returns preferred models from config, or falls back to DEFAULTS.
 */
export function getSummaryModels(configOverride?: Partial<WebSearchConfig>): Array<{ provider: string; id: string }> {
    const cfg = configOverride ?? loadConfig();
    const preferred = cfg.models?.preferred;
    if (preferred && preferred.length > 0) return preferred;
    return [...DEFAULTS.preferredSummaryModels];
}

/**
 * Get the default summarizer model string (provider/id).
 */
export function getSummarizerModel(): string {
    const cfg = loadConfig();
    return cfg.models?.summarizer ?? DEFAULTS.summarizerModel;
}

/**
 * Get the default video model string.
 */
export function getVideoModel(): string {
    const cfg = loadConfig();
    return cfg.models?.video ?? DEFAULTS.videoModel;
}

/**
 * Get API base URL for a service.
 */
/** Get API base URL for a service. */
export function getApiBaseUrl(
    service: "perplexity" | "exa" | "gemini" | "gemini-web" | "gemini-web-upload" | "gemini-api-upload",
): string {
    const cfg = loadConfig();
    switch (service) {
        case "perplexity":
            return cfg.perplexityApiBase ?? DEFAULTS.perplexityApiBase;
        case "exa":
            return cfg.exaApiBase ?? DEFAULTS.exaApiBase;
        case "gemini":
            return cfg.geminiApiBase ?? DEFAULTS.geminiApiBase;
        case "gemini-web":
            return cfg.geminiWebApiBase ?? DEFAULTS.geminiWebApiBase;
        case "gemini-web-upload":
            return cfg.geminiWebUploadBase ?? DEFAULTS.geminiWebUploadBase;
        case "gemini-api-upload":
            return cfg.geminiApiUploadBase ?? DEFAULTS.geminiApiUploadBase;
    }
}

/** Get Gemini Web app base URL */
export function getGeminiWebAppUrl(): string {
    const cfg = loadConfig();
    return cfg.geminiWebAppUrl ?? DEFAULTS.geminiWebAppUrl;
}
