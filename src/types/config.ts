/**
 * ──────────────────────────────────────────────
 *  Config Types
 * ──────────────────────────────────────────────
 * Centralised type definitions for all configuration
 * shapes read from `~/.pi/web-search.json`.
 *
 * Every field is optional at the JSON level; the
 * config loader fills in defaults for anything
 * that is missing.
 */

import type { SearchProvider, SearchWorkflow } from "./search.js";

// ── Top-level config ───────────────────────────

/**
 * The shape of `~/.pi/web-search.json`.
 *
 * All fields are optional — the config loader returns
 * a fully populated `IResolvedConfig` after applying
 * defaults and environment-variable overrides.
 */
export interface IRawConfig {
    readonly exaApiKey?: string;
    readonly perplexityApiKey?: string;
    readonly geminiApiKey?: string;
    readonly provider?: SearchProvider;
    readonly searchProvider?: SearchProvider;
    readonly searchModel?: string;
    readonly workflow?: SearchWorkflow;
    readonly curatorTimeoutSeconds?: number;
    readonly chromeProfile?: string;
    readonly githubClone?: IGitHubCloneConfig;
    readonly youtube?: IYouTubeConfig;
    readonly video?: IVideoConfig;
    readonly shortcuts?: IShortcutConfig;
}

// ── Feature sub-configs ────────────────────────

export interface IGitHubCloneConfig {
    readonly enabled?: boolean;
    readonly maxRepoSizeMB?: number;
    readonly cloneTimeoutSeconds?: number;
    readonly clonePath?: string;
}

export interface IYouTubeConfig {
    readonly enabled?: boolean;
    readonly preferredModel?: string;
}

export interface IVideoConfig {
    readonly enabled?: boolean;
    readonly preferredModel?: string;
    readonly maxSizeMB?: number;
}

export interface IShortcutConfig {
    readonly curate?: string;
    readonly activity?: string;
}

// ── Environment / resolved config ──────────────

/**
 * A fully resolved config with all defaults applied and
 * environment-variable overrides merged in.
 */
export interface IResolvedConfig {
    /** Resolved API keys (env > file > none). */
    readonly exaApiKey: string | null;
    readonly perplexityApiKey: string | null;
    readonly geminiApiKey: string | null;

    /** Default search provider (env > file > `"auto"`). */
    readonly defaultProvider: SearchProvider;

    /** Gemini model override for search. */
    readonly searchModel: string | undefined;

    /** Curator workflow (default: `"summary-review"`). */
    readonly workflow: SearchWorkflow;

    /** Curator idle timeout in seconds (default: 20, max: 600). */
    readonly curatorTimeoutSeconds: number;

    /** Chrome/Chromium profile directory override. */
    readonly chromeProfile: string | undefined;

    readonly githubClone: IResolvedGitHubCloneConfig;
    readonly youtube: IResolvedYouTubeConfig;
    readonly video: IResolvedVideoConfig;
    readonly shortcuts: IShortcutConfig;
}

export interface IResolvedGitHubCloneConfig {
    readonly enabled: boolean;
    readonly maxRepoSizeMB: number;
    readonly cloneTimeoutSeconds: number;
    readonly clonePath: string;
}

export interface IResolvedYouTubeConfig {
    readonly enabled: boolean;
    readonly preferredModel: string;
}

export interface IResolvedVideoConfig {
    readonly enabled: boolean;
    readonly preferredModel: string;
    readonly maxSizeMB: number;
}

// ── Provider availability ──────────────────────

export interface IProviderAvailability {
    readonly perplexity: boolean;
    readonly exa: boolean;
    readonly gemini: boolean;
}

// ── Config file path ───────────────────────────

/** The default path to the user's config file. */
export const WEB_SEARCH_CONFIG_PATH = ".pi/web-search.json";

/** The default path for Exa usage tracking. */
export const EXA_USAGE_PATH = ".pi/exa-usage.json";

// ── Default values ─────────────────────────────

export const DEFAULTS = {
    curatorTimeoutSeconds: 20,
    maxCuratorTimeoutSeconds: 600,
    searchWorkflow: "summary-review" as SearchWorkflow,
    defaultProvider: "auto" as SearchProvider,

    githubClone: {
        enabled: true,
        maxRepoSizeMB: 350,
        cloneTimeoutSeconds: 30,
        clonePath: "/tmp/pi-github-repos",
    } satisfies IResolvedGitHubCloneConfig,

    youtube: {
        enabled: true,
        preferredModel: "gemini-3-flash-preview",
    } satisfies IResolvedYouTubeConfig,

    video: {
        enabled: true,
        preferredModel: "gemini-3-flash-preview",
        maxSizeMB: 50,
    } satisfies IResolvedVideoConfig,

    shortcuts: {
        curate: "ctrl+shift+s",
        activity: "ctrl+shift+w",
    } satisfies IShortcutConfig,

    /** Exa free-tier monthly limit. */
    exaMonthlyLimit: 1000,
    exaWarningThreshold: 800,
} as const;

// ── Environment variable keys ──────────────────

export const ENV_KEYS = {
    exaApiKey: "EXA_API_KEY",
    perplexityApiKey: "PERPLEXITY_API_KEY",
    geminiApiKey: "GEMINI_API_KEY",
} as const;
