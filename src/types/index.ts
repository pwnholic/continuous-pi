/**
 * ──────────────────────────────────────────────
 *  Types — barrel re-export
 * ──────────────────────────────────────────────
 * Every public type consumed by the rest of the
 * codebase is reachable from this module.
 *
 * Internal type-groups are organised in separate
 * files under `src/types/` but this barrel is the
 * single import target for consumers.
 */

// ── Result & branded types ─────────────────────
export type { Result, Brand, OkType, ErrType } from "./result.js";
export { ok, err, unwrapOr, unwrap } from "./result.js";

// ── Search ─────────────────────────────────────
export type {
    ISearchResult,
    ISearchResponse,
    SearchProvider,
    ResolvedSearchProvider,
    IAttributedSearchResponse,
    ISearchOptions,
    IFullSearchOptions,
    SearchWorkflow,
    SearchPhase,
} from "./search.js";

// ── Content / extraction ───────────────────────
export type {
    IVideoFrame,
    FrameData,
    FrameResult,
    IThumbnail,
    IExtractedContent,
    ContentKind,
    IContentKindResult,
    IExtractOptions,
    TimestampSpec,
    IVideoFileInfo,
    IRSCExtractResult,
} from "./content.js";

// ── Config ─────────────────────────────────────
export type {
    IRawConfig,
    IGitHubCloneConfig,
    IYouTubeConfig,
    IVideoConfig,
    IShortcutConfig,
    IResolvedConfig,
    IResolvedGitHubCloneConfig,
    IResolvedYouTubeConfig,
    IResolvedVideoConfig,
    IProviderAvailability,
} from "./config.js";
export { WEB_SEARCH_CONFIG_PATH, EXA_USAGE_PATH, DEFAULTS, ENV_KEYS } from "./config.js";

// ── Curator ────────────────────────────────────
export type {
    ICuratorBootstrap,
    ICuratorServerHandle,
    ServerState,
    ISummaryMeta,
    ISummaryGenerationContext,
    CuratorServerEvent,
    ISubmitSummaryBody,
    IGenerateSummaryBody,
    IQueryResultBody,
    IQueryErrorBody,
} from "./curator.js";

// ── Activity ───────────────────────────────────
export type { IActivityEntry, IRateLimitInfo, ActivityListener } from "./activity.js";
export { ACTIVITY_DEFAULTS } from "./activity.js";

// ── Provider interfaces ────────────────────────
export type {
    ISearchProvider,
    IContentExtractor,
    IFrameExtractor,
    ISearchProviderRegistry,
    IContentExtractorRegistry,
} from "./provider.js";
