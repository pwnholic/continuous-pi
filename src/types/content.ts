/**
 * ──────────────────────────────────────────────
 *  Content Types
 * ──────────────────────────────────────────────
 * Types for URL content extraction, video analysis,
 * and frame extraction.
 */

// ── Frame data ─────────────────────────────────

/** A single decoded (base64) video frame. */
export interface IVideoFrame {
    readonly data: string;
    readonly mimeType: string;
    readonly timestamp: string;
}

/** Either a decoded frame or an error message. */
export type FrameData = { readonly data: string; readonly mimeType: string };
export type FrameResult = FrameData | { readonly error: string };

// ── Thumbnail ──────────────────────────────────

export interface IThumbnail {
    readonly data: string;
    readonly mimeType: string;
}

// ── Extracted single-URL result ────────────────

export interface IExtractedContent {
    readonly url: string;
    readonly title: string;
    readonly content: string;
    readonly error: string | null;

    /** A video thumbnail (YouTube thumbnail or local video still). */
    readonly thumbnail?: IThumbnail;

    /** Decoded frame images extracted at specific timestamps. */
    readonly frames?: readonly IVideoFrame[];

    /** Duration in seconds (YouTube / local video). */
    readonly duration?: number;
}

// ── Extraction routing ─────────────────────────

/**
 * Identifies the _kind_ of content a URL points to so the
 * orchestrator can dispatch to the correct extractor.
 */
export type ContentKind = "github" | "youtube" | "local-video" | "pdf" | "web";

export interface IContentKindResult {
    readonly kind: ContentKind;
    readonly videoId?: string;
}

// ── Per-call extract options ───────────────────

export interface IExtractOptions {
    /** Question to ask about a YouTube or local video. */
    readonly prompt?: string;

    /**
     * Timestamp for frame extraction.
     * Accepts "MM:SS", "H:MM:SS", or bare seconds.
     */
    readonly timestamp?: string;

    /** Number of frames to extract (max 12). */
    readonly frames?: number;

    /** Override the model used for Gemini-powered extraction. */
    readonly model?: string;

    /** Force a GitHub clone even when the repo exceeds the size limit. */
    readonly forceClone?: boolean;

    /** External abort signal. */
    readonly signal?: AbortSignal;
}

// ── Frame helpers ──────────────────────────────

export type TimestampSpec =
    | { readonly type: "single"; readonly seconds: number }
    | { readonly type: "range"; readonly start: number; readonly end: number }
    | { readonly type: "frames"; readonly seconds: readonly number[] };

// ── File / video info ──────────────────────────

export interface IVideoFileInfo {
    readonly absolutePath: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
}

// ── RSC extraction ─────────────────────────────

export interface IRSCExtractResult {
    readonly title: string;
    readonly content: string;
}
