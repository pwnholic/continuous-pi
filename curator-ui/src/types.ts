/// <reference types="vite/client" />

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface SourceResult {
    title: string;
    url: string;
    domain: string;
}

export interface SearchQueryInfo {
    queryIndex: number;
    query: string;
    answer: string;
    results: SourceResult[];
    provider: string;
    error?: string;
    loading: boolean;
}

export interface SummaryMeta {
    model: string | null;
    durationMs: number;
    tokenEstimate: number;
    fallbackUsed: boolean;
    fallbackReason?: string;
    edited?: boolean;
}

export interface SummaryModel {
    value: string;
    label: string;
}

export type ServerState = "SEARCHING" | "RESULT_SELECTION" | "COMPLETED";

export type Provider = "perplexity" | "exa" | "gemini";

export interface AvailableProviders {
    perplexity: boolean;
    exa: boolean;
    gemini: boolean;
}

export interface ServerOptions {
    queries: string[];
    sessionToken: string;
    timeout: number;
    availableProviders: AvailableProviders;
    defaultProvider: string;
    summaryModels: SummaryModel[];
    defaultSummaryModel: string | null;
}

export interface SearchEvent {
    queryIndex: number;
    query: string;
    answer: string;
    results: SourceResult[];
    provider: string;
}

export interface SearchErrorEvent {
    queryIndex: number;
    query: string;
    error: string;
    provider?: string;
}
