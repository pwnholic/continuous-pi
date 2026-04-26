/**
 * ──────────────────────────────────────────────
 *  Provider Interface Types
 * ──────────────────────────────────────────────
 * Formal contracts for search providers, content
 * extractors, and their registries.  Every provider
 * / extractor module implements one of these
 * interfaces so the orchestrator can treat them
 * polymorphically.
 */

import type {
    ISearchOptions,
    ISearchResponse,
    ISearchResult,
    IFullSearchOptions,
    IAttributedSearchResponse,
    SearchProvider,
    ResolvedSearchProvider,
} from "./search.js";
import type { IExtractedContent, IExtractOptions, IVideoFrame } from "./content.js";
import type { IProviderAvailability } from "./config.js";

// ══════════════════════════════════════════════
//  Search Provider Interface
// ══════════════════════════════════════════════

/**
 * A search provider can fulfill a search query and
 * return a synthesised answer with source citations.
 */
export interface ISearchProvider {
    /** Human-readable name (e.g. `"exa"`, `"perplexity"`). */
    readonly name: string;

    /**
     * Check whether this provider is available right now
     * (API key configured, cookies present, budget not
     * exhausted, etc.).
     */
    isAvailable(): Promise<boolean>;

    /**
     * Execute a single search query and return the results.
     *
     * @throws {Error} if the provider is unavailable or the
     *   upstream API returns an error.
     */
    search(query: string, options: ISearchOptions): Promise<ISearchResponse>;

    /**
     * Optional additional content-fetch step.  Called when
     * `includeContent` is requested — downloads the full
     * text of each source URL.
     */
    fetchInlineContent?(
        results: readonly ISearchResult[],
        signal?: AbortSignal,
    ): Promise<readonly IExtractedContent[]>;
}

// ══════════════════════════════════════════════
//  Content Extractor Interface
// ══════════════════════════════════════════════

/**
 * A content extractor knows how to take a URL (or local
 * file path) and produce structured Markdown content
 * from it.
 *
 * Extractors are registered with a **priority** that
 * determines invocation order in the fallback chain.
 * Higher priority = tried first.
 */
export interface IContentExtractor {
    /** Human-readable name (e.g. `"github"`, `"youtube"`). */
    readonly name: string;

    /** Priority in the fallback chain (higher = tried first). */
    readonly priority: number;

    /**
     * Return `true` if this extractor can handle the given
     * URL/path.  The router calls this first before attempting
     * extraction.
     */
    canHandle(url: string): boolean;

    /**
     * Perform extraction.  Returns `null` when the extractor
     * cannot handle the input (e.g. video too large, private
     * YouTube video), which lets the fallback chain continue.
     *
     * @throws {Error} only for unrecoverable configuration
     *   errors (e.g. malformed config file); *do not* throw
     *   for transient failures that should be handled by
     *   the next extractor in the chain.
     */
    extract(url: string, options: IExtractOptions): Promise<IExtractedContent | null>;
}

// ══════════════════════════════════════════════
//  YouTube / Video Frame Extractor
// ══════════════════════════════════════════════

/**
 * Optional capability for extractors that can produce
 * individual video frames as images.
 */
export interface IFrameExtractor {
    /** Extract a single frame at the given second offset. */
    extractFrame(
        videoId: string,
        seconds: number,
    ): Promise<{ readonly data: string; readonly mimeType: string } | { readonly error: string }>;

    /** Extract multiple frames at the given timestamps. */
    extractFrames(
        videoId: string,
        timestamps: readonly number[],
    ): Promise<{
        readonly frames: readonly IVideoFrame[];
        readonly duration: number | null;
        readonly error: string | null;
    }>;
}

// ══════════════════════════════════════════════
//  Provider Registry Interface
// ══════════════════════════════════════════════

/**
 * The provider registry provides a single entry-point
 * for all search operations, handling the fallback
 * chain automatically.
 */
export interface ISearchProviderRegistry {
    /**
     * Search with the given provider (or `"auto"` to
     * use the default fallback chain).
     */
    search(query: string, options?: IFullSearchOptions): Promise<IAttributedSearchResponse>;

    /** Get the availability status of every registered provider. */
    getAvailability(): Promise<IProviderAvailability>;

    /** Resolve a `SearchProvider` string to a concrete provider name. */
    resolveProvider(provider: SearchProvider): Promise<ResolvedSearchProvider>;
}

// ══════════════════════════════════════════════
//  Content Extractor Registry Interface
// ══════════════════════════════════════════════

/**
 * The extractor registry routes a URL to the appropriate
 * extractor and manages the fallback chain.
 */
export interface IContentExtractorRegistry {
    /**
     * Extract content from a URL or local path, trying
     * extractors in priority order.
     */
    extract(url: string, options: IExtractOptions): Promise<IExtractedContent>;

    /**
     * Extract content from multiple URLs concurrently
     * (respecting the configured concurrency limit).
     */
    extractAll(
        urls: readonly string[],
        options: IExtractOptions,
    ): Promise<readonly IExtractedContent[]>;
}
