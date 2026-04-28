// ─── Extracted URLs / Content ─────────────────────────────────────────────────

/** Options for content extraction */
export interface ExtractOptions {
    timeoutMs?: number;
    forceClone?: boolean;
    prompt?: string;
    timestamp?: string;
    frames?: number;
    model?: string;
}

/** Result from a frame extraction (single frame) */
export type FrameResult = { data: string; mimeType: string } | { error: string };

/** A single video frame extracted from a video source */
export interface VideoFrame {
    data: string;
    mimeType: string;
    timestamp: string;
}

/** Extracted content from a URL */
export interface ExtractedContent {
    url: string;
    title?: string;
    content: string;
    error: string | null;
    thumbnail?: { data: string; mimeType: string };
    frames?: VideoFrame[];
    duration?: number;
}

// ─── Search Results ───────────────────────────────────────────────────────────

/** A single search result entry */
export interface SearchResult {
    title: string;
    url: string;
    snippet?: string;
    domain?: string;
}

/** Response from a search provider */
export interface SearchResponse {
    answer: string;
    results: SearchResult[];
    inlineContent?: ExtractedContent[];
}

/** Search response with provider attribution */
export interface AttributedSearchResponse extends SearchResponse {
    provider: ResolvedSearchProvider;
}

// ─── Search Providers ─────────────────────────────────────────────────────────

export type SearchProvider = "auto" | "perplexity" | "gemini" | "exa";
export type ResolvedSearchProvider = Exclude<SearchProvider, "auto">;

export interface SearchOptions {
    numResults?: number;
    recencyFilter?: "day" | "week" | "month" | "year";
    domainFilter?: string[];
    signal?: AbortSignal;
}

export interface FullSearchOptions extends SearchOptions {
    provider?: SearchProvider;
    includeContent?: boolean;
}

// ─── Stored Query Results ─────────────────────────────────────────────────────

export interface QueryResultData {
    query: string;
    answer: string;
    results: SearchResult[];
    error: string | null;
    provider?: string;
    timestamp?: number;
}

export interface StoredSearchData {
    id: string;
    type: "search" | "fetch";
    timestamp: number;
    queries?: QueryResultData[];
    urls?: ExtractedContent[];
}

// ─── Webclaw ──────────────────────────────────────────────────────────────────

export type WebclawFormat = "markdown" | "json" | "text" | "llm" | "html";
export type WebclawBrowser = "chrome" | "firefox" | "safari-ios" | "random";

export interface WebclawOptions {
    format?: WebclawFormat;
    browser?: WebclawBrowser;
    proxy?: string;
    timeout?: number;
    include?: string;
    exclude?: string;
    onlyMainContent?: boolean;
    metadata?: boolean;
    signal?: AbortSignal;
}

export interface WebclawResult {
    url: string;
    title: string;
    content: string;
    metadata?: {
        language?: string;
        wordCount?: number;
    };
}

// ─── Vertical Extractors ──────────────────────────────────────────────────────

export type VerticalExtractorName =
    | "github_repo"
    | "github_pr"
    | "github_issue"
    | "github_release"
    | "youtube_video"
    | "reddit"
    | "hackernews"
    | "pypi"
    | "npm"
    | "crates_io"
    | "huggingface_model"
    | "huggingface_dataset"
    | "arxiv"
    | "docker_hub"
    | "dev_to"
    | "stackoverflow"
    | "substack_post"
    | "linkedin_post"
    | "instagram_post"
    | "instagram_profile"
    | "shopify_product"
    | "amazon_product"
    | "ebay_listing"
    | "etsy_listing"
    | "trustpilot_reviews"
    | "ecommerce_product"
    | "woocommerce_product"
    | "shopify_collection";

// ─── Curator ──────────────────────────────────────────────────────────────────

export type WebSearchWorkflow = "none" | "summary-review";
export type CuratorWorkflow = "summary-review";

export interface ProviderAvailability {
    perplexity: boolean;
    exa: boolean;
    gemini: boolean;
}

export interface SummaryMeta {
    model: string | null;
    durationMs: number;
    tokenEstimate: number;
    fallbackUsed: boolean;
    fallbackReason?: string;
    edited?: boolean;
}

// ─── Activity Monitor ─────────────────────────────────────────────────────────

export interface ActivityEntry {
    id: string;
    type: "api" | "fetch";
    startTime: number;
    endTime?: number;
    query?: string;
    url?: string;
    status: number | null;
    error?: string;
}

export interface RateLimitInfo {
    used: number;
    max: number;
    oldestTimestamp: number | null;
    windowMs: number;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

export interface GitHubUrlInfo {
    owner: string;
    repo: string;
    ref?: string;
    refIsFullSha: boolean;
    path?: string;
    type: "root" | "blob" | "tree";
}
