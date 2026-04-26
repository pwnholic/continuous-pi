/**
 * ──────────────────────────────────────────────
 *  Curator Types
 * ──────────────────────────────────────────────
 * Types for the search curator — the ephemeral HTTP
 * server + browser-based UI that lets users review,
 * add, select results, and approve/reject summaries.
 */

import type { IAttributedSearchResponse, ResolvedSearchProvider } from "./search.js";
import type { IProviderAvailability } from "./config.js";

// ── Bootstrap ──────────────────────────────────

/** Data sent to the curator UI on initial load. */
export interface ICuratorBootstrap {
    readonly availableProviders: IProviderAvailability;
    readonly defaultProvider: ResolvedSearchProvider;
    readonly timeoutSeconds: number;
}

// ── Server handle ──────────────────────────────

/** Opaque handle returned by `startCuratorServer`. */
export interface ICuratorServerHandle {
    /** The HTTP URL the browser should open. */
    readonly url: string;

    /** Gracefully shut down the server. */
    close(): void;

    /** Push a per-query search result to the SSE stream. */
    pushResult(queryIndex: number, response: IAttributedSearchResponse): void;

    /** Push a per-query error to the SSE stream. */
    pushError(queryIndex: number, error: string, provider?: string): void;

    /** Signal that all searches are done. */
    searchesDone(): void;
}

// ── Server state machine ───────────────────────

export type ServerState = "idle" | "searching" | "fetching" | "summarizing" | "completed";

// ── Summary meta ───────────────────────────────

export interface ISummaryMeta {
    readonly model: string | null;
    readonly durationMs: number;
    readonly tokenEstimate: number;
    readonly fallbackUsed: boolean;
    readonly fallbackReason?: string;
    readonly edited?: boolean;
}

// ── Summary generation context ─────────────────

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ISummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry">;

// ── SSE event payloads ─────────────────────────

/** Events the curator server sends to the browser via SSE. */
export type CuratorServerEvent =
    | {
          readonly type: "init";
          readonly queries: readonly string[];
      }
    | {
          readonly type: "progress";
          readonly current: number;
          readonly total: number;
          readonly query: string;
      }
    | {
          readonly type: "result";
          readonly queryIndex: number;
          readonly answer: string;
          readonly results: ReadonlyArray<{
              readonly title: string;
              readonly url: string;
          }>;
          readonly provider: string;
      }
    | {
          readonly type: "error";
          readonly queryIndex: number;
          readonly error: string;
          readonly provider?: string;
      }
    | {
          readonly type: "done";
      }
    | {
          readonly type: "summary_ready";
          readonly summary: string;
          readonly meta: ISummaryMeta;
      };

// ── Client → Server request body types ─────────

/** Shape of the POST body when the curator submits a summary. */
export interface ISubmitSummaryBody {
    readonly summary: string;
    readonly meta: ISummaryMeta;
    readonly selectedQueryIndices?: readonly number[];
}

/** Shape of the POST body when requesting a summary draft. */
export interface IGenerateSummaryBody {
    readonly model?: string;
    readonly feedback?: string;
}

/** Shape of the POST body for a search-query update. */
export interface IQueryResultBody {
    readonly queryIndex: number;
    readonly answer: string;
    readonly results: ReadonlyArray<{
        readonly title: string;
        readonly url: string;
    }>;
    readonly provider: string;
}

/** Shape of the POST body for a query error. */
export interface IQueryErrorBody {
    readonly queryIndex: number;
    readonly error: string;
    readonly provider?: string;
}
