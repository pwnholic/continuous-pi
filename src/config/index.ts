/**
 * Reads, caches, and resolves the user's
 * `~/.pi/web-search.json` configuration file,
 * merging environment-variable overrides and
 * applying sensible defaults for every field.
 *
 * @module config
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
    IRawConfig,
    IResolvedConfig,
    IResolvedGitHubCloneConfig,
    IResolvedYouTubeConfig,
    IResolvedVideoConfig,
    IShortcutConfig,
} from "../types/config.js";
import { WEB_SEARCH_CONFIG_PATH, DEFAULTS, ENV_KEYS } from "../types/config.js";

import {
    normalizeApiKey,
    normalizeSearchProvider,
    normalizeSearchModel,
    normalizeEnabled,
    normalizePositiveNumber,
    normalizeString,
    normalizeCuratorTimeoutSeconds,
    normalizeSearchWorkflow,
    normalizeChromeProfile,
} from "./validators.js";

// ── Internal helpers ─────────────────────────

/**
 * Return the absolute path to the user config file.
 */
function configFilePath(): string {
    return join(homedir(), WEB_SEARCH_CONFIG_PATH);
}

// ── IConfigLoader (interface) ─────────────────

/**
 * Read-only view of the config loader used by search providers
 * and extractors.  Providers receive this interface so they never
 * depend on the concrete loading/caching implementation.
 */
export interface IConfigLoader {
    readonly exaApiKey: string | null;
    readonly perplexityApiKey: string | null;
    readonly geminiApiKey: string | null;
    readonly defaultProvider: string;
    readonly searchModel: string | undefined;
    readonly workflow: string;
    readonly curatorTimeoutSeconds: number;
    readonly chromeProfile: string | undefined;
    readonly githubClone: IResolvedGitHubCloneConfig;
    readonly youtube: IResolvedYouTubeConfig;
    readonly video: IResolvedVideoConfig;
    readonly shortcuts: IShortcutConfig;
    load(): IResolvedConfig;
    reload(): void;
}

// ── ConfigLoader ──────────────────────────────

/**
 * Loads and caches the user's web-search configuration.
 *
 * Reads `~/.pi/web-search.json` once and merges environment-variable
 * overrides for API keys.  Call {@link reload} to force a re-read.
 *
 * Exposes typed helper properties so consumers never need to touch
 * raw config objects.
 *
 * ```ts
 * const cfg = new ConfigLoader();
 * console.log(cfg.exaApiKey);
 * console.log(cfg.defaultProvider);
 * ```
 */
export class ConfigLoader {
    /** Cached resolved configuration. */
    #cached: IResolvedConfig | null = null;

    // ── Loading ──────────────────────────────────

    /**
     * Read (or re-read) the config file and resolve all defaults.
     *
     * The result is cached until the next call to {@link reload}.
     *
     * @throws {Error} If the config file exists but contains invalid JSON.
     */
    load(): IResolvedConfig {
        if (this.#cached) {
            return this.#cached;
        }
        this.#cached = this.#readAndResolve();
        return this.#cached;
    }

    /**
     * Force the config file to be re-read on the next access.
     *
     * The next call to a getter or to {@link load} will re-parse
     * `~/.pi/web-search.json` and re-apply environment overrides.
     */
    reload(): void {
        this.#cached = null;
    }

    // ── Helper properties ────────────────────────

    /** Resolved Exa API key (env override > file > `null`). */
    get exaApiKey(): string | null {
        return this.load().exaApiKey;
    }

    /** Resolved Perplexity API key (env override > file > `null`). */
    get perplexityApiKey(): string | null {
        return this.load().perplexityApiKey;
    }

    /** Resolved Gemini API key (env override > file > `null`). */
    get geminiApiKey(): string | null {
        return this.load().geminiApiKey;
    }

    /** Default search provider (env override > file > `"auto"`). */
    get defaultProvider(): string {
        return this.load().defaultProvider;
    }

    /** Gemini model override for search queries (or `undefined`). */
    get searchModel(): string | undefined {
        return this.load().searchModel;
    }

    /** Curator workspace timeout in seconds. */
    get curatorTimeoutSeconds(): number {
        return this.load().curatorTimeoutSeconds;
    }

    /** Resolved curator workflow. */
    get workflow(): string {
        return this.load().workflow;
    }

    /** Chrome/Chromium profile path override (or `undefined`). */
    get chromeProfile(): string | undefined {
        return this.load().chromeProfile;
    }

    /** Resolved GitHub clone config. */
    get githubClone(): IResolvedGitHubCloneConfig {
        return this.load().githubClone;
    }

    /** Resolved YouTube config. */
    get youtube(): IResolvedYouTubeConfig {
        return this.load().youtube;
    }

    /** Resolved video config. */
    get video(): IResolvedVideoConfig {
        return this.load().video;
    }

    /** Resolved keyboard shortcuts. */
    get shortcuts(): IShortcutConfig {
        return this.load().shortcuts;
    }

    // ── Internal: read & resolve ─────────────────

    /**
     * Read the raw JSON from disk, parse it safely, then merge
     * defaults and environment overrides.
     */
    #readAndResolve(): IResolvedConfig {
        const raw = this.#readRawConfig();

        // ── API keys (env > file > null) ────────────
        const exaApiKey =
            normalizeApiKey(process.env[ENV_KEYS.exaApiKey]) ?? normalizeApiKey(raw.exaApiKey);

        const perplexityApiKey =
            normalizeApiKey(process.env[ENV_KEYS.perplexityApiKey]) ??
            normalizeApiKey(raw.perplexityApiKey);

        const geminiApiKey =
            normalizeApiKey(process.env[ENV_KEYS.geminiApiKey]) ??
            normalizeApiKey(raw.geminiApiKey);

        // ── Provider ────────────────────────────────
        // The config file may use either `provider` or `searchProvider`;
        // prefer `searchProvider` and fall back to `provider`.
        const fileProvider = normalizeSearchProvider(raw.searchProvider ?? raw.provider);
        // Env can also override the default provider.
        const envProvider = normalizeSearchProvider(process.env["SEARCH_PROVIDER"]);
        const defaultProvider = envProvider !== "auto" ? envProvider : fileProvider;

        // ── Workflow ────────────────────────────────
        const workflow = normalizeSearchWorkflow(raw.workflow);

        // ── Search model ────────────────────────────
        const searchModel = normalizeSearchModel(raw.searchModel);

        // ── Curator timeout ─────────────────────────
        const curatorTimeoutSeconds = normalizeCuratorTimeoutSeconds(
            raw.curatorTimeoutSeconds,
            DEFAULTS.curatorTimeoutSeconds,
        );

        // ── Chrome profile ──────────────────────────
        const chromeProfile = normalizeChromeProfile(raw.chromeProfile);

        // ── Feature sub-configs ─────────────────────
        const gh = raw.githubClone ?? {};
        const githubClone: IResolvedGitHubCloneConfig = {
            enabled: normalizeEnabled(gh.enabled, DEFAULTS.githubClone.enabled),
            maxRepoSizeMB: normalizePositiveNumber(
                gh.maxRepoSizeMB,
                DEFAULTS.githubClone.maxRepoSizeMB,
            ),
            cloneTimeoutSeconds: normalizePositiveNumber(
                gh.cloneTimeoutSeconds,
                DEFAULTS.githubClone.cloneTimeoutSeconds,
            ),
            clonePath: normalizeString(gh.clonePath, DEFAULTS.githubClone.clonePath),
        };

        const yt = raw.youtube ?? {};
        const youtube: IResolvedYouTubeConfig = {
            enabled: normalizeEnabled(yt.enabled, DEFAULTS.youtube.enabled),
            preferredModel: normalizeString(yt.preferredModel, DEFAULTS.youtube.preferredModel),
        };

        const v = raw.video ?? {};
        const video: IResolvedVideoConfig = {
            enabled: normalizeEnabled(v.enabled, DEFAULTS.video.enabled),
            preferredModel: normalizeString(v.preferredModel, DEFAULTS.video.preferredModel),
            maxSizeMB: normalizePositiveNumber(v.maxSizeMB, DEFAULTS.video.maxSizeMB),
        };

        const shortcuts: IShortcutConfig = {
            curate: normalizeString(raw.shortcuts?.curate, DEFAULTS.shortcuts.curate),
            activity: normalizeString(raw.shortcuts?.activity, DEFAULTS.shortcuts.activity),
        };

        return {
            exaApiKey,
            perplexityApiKey,
            geminiApiKey,
            defaultProvider,
            searchModel,
            workflow,
            curatorTimeoutSeconds,
            chromeProfile,
            githubClone,
            youtube,
            video,
            shortcuts,
        };
    }

    /**
     * Read and parse `~/.pi/web-search.json`.
     *
     * Returns an empty object when the file does not exist.
     *
     * @throws {Error} When the file exists but is not valid JSON.
     */
    #readRawConfig(): IRawConfig {
        const path = configFilePath();

        if (!existsSync(path)) {
            return {};
        }

        const rawText = readFileSync(path, "utf-8");

        try {
            return JSON.parse(rawText) as IRawConfig;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to parse ${path}: ${message}`);
        }
    }
}
