/**
 * ──────────────────────────────────────────────
 *  Curator — Ephemeral HTTP Server
 * ──────────────────────────────────────────────
 * Spins up a local HTTP server that serves the
 * curator HTML page and provides a REST/SSE API
 * for streaming search results and managing
 * summary generation.
 *
 * The server is ephemeral — created for each
 * curator session and torn down when the session
 * ends or the browser window closes.
 *
 * @module curator/server
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type {
    ICuratorServerHandle,
    ICuratorBootstrap,
    ISummaryMeta,
    CuratorServerEvent,
    ServerState,
} from "../types/curator.js";
import type { ResolvedSearchProvider, IAttributedSearchResponse } from "../types/search.js";
import type { IProviderAvailability } from "../types/config.js";

import { generateCuratorPage } from "./page.js";

// ── Constants ──────────────────────────────────

const STALE_THRESHOLD_MS = 60_000; // 60 s without heartbeat → stale
const WATCHDOG_INTERVAL_MS = 10_000; // check every 10 s

// ── Options & callbacks ────────────────────────

export interface ICuratorServerOptions {
    queries: readonly string[];
    sessionToken: string;
    timeout: number;
    availableProviders: IProviderAvailability;
    defaultProvider: ResolvedSearchProvider;
    summaryModels: ReadonlyArray<{ value: string; label: string }>;
    defaultSummaryModel: string;
}

export interface ICuratorServerCallbacks {
    onSearch: (query: string, provider: string, signal: AbortSignal) => Promise<void>;
    onSummarize: (
        model: string | undefined,
        feedback: string | undefined,
        signal: AbortSignal,
    ) => Promise<{ summary: string; meta: ISummaryMeta }>;
    onSubmit: (
        summary: string,
        summaryMeta: ISummaryMeta,
        selectedQueryIndices: readonly number[],
    ) => void;
    onCancel: (reason?: string) => void;
    onQueryRewrite: (query: string, signal: AbortSignal) => Promise<string>;
}

// ── Server creation ────────────────────────────

/**
 * Start an ephemeral HTTP server for the curator UI.
 *
 * @param options   - Server configuration (queries, providers, timeouts).
 * @param callbacks - Event handlers for search, summarise, submit, cancel.
 * @returns A handle with the server URL and control methods.
 */
export function startCuratorServer(
    options: ICuratorServerOptions,
    callbacks: ICuratorServerCallbacks,
): ICuratorServerHandle {
    const {
        queries,
        sessionToken,
        timeout,
        availableProviders,
        defaultProvider,
        summaryModels,
        defaultSummaryModel,
    } = options;

    // ── State ──────────────────────────────────
    let browserConnected = false;
    let lastHeartbeatAt = Date.now();
    let completed = false;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let state: ServerState = "idle";
    let sseResponse: ServerResponse | null = null;
    const sseBuffer: string[] = [];

    let summarizeAbortController: AbortController | null = null;
    let summarizeRequestSeq = 0;
    let sseKeepalive: ReturnType<typeof setInterval> | null = null;

    // ── Helpers ────────────────────────────────

    function abortInFlightSummarize(): void {
        if (summarizeAbortController) {
            summarizeAbortController.abort();
            summarizeAbortController = null;
        }
    }

    function markCompleted(): void {
        completed = true;
        state = "completed";
        if (watchdog) {
            clearInterval(watchdog);
            watchdog = null;
        }
        if (sseKeepalive) {
            clearInterval(sseKeepalive);
            sseKeepalive = null;
        }
    }

    function touchHeartbeat(): void {
        lastHeartbeatAt = Date.now();
    }

    function validateToken(token: string): boolean {
        return token === sessionToken;
    }

    function isAvailableProvider(provider: string): boolean {
        switch (provider) {
            case "exa":
                return availableProviders.exa;
            case "perplexity":
                return availableProviders.perplexity;
            case "gemini":
                return availableProviders.gemini;
            default:
                return false;
        }
    }

    function sendSSE(data: CuratorServerEvent): void {
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        if (sseResponse && browserConnected && !completed) {
            try {
                sseResponse.write(payload);
            } catch {
                // Client disconnected
                browserConnected = false;
                sseBuffer.push(payload);
            }
        } else {
            sseBuffer.push(payload);
        }
    }

    // ── Bootstrap data ─────────────────────────
    const bootstrap: ICuratorBootstrap = {
        availableProviders,
        defaultProvider,
        timeoutSeconds: timeout,
    };

    // ── SSE keepalive ──────────────────────────
    sseKeepalive = setInterval(() => {
        if (sseResponse && browserConnected && !completed) {
            try {
                sseResponse.write(": keepalive\n\n");
            } catch {
                browserConnected = false;
            }
        }
    }, 15_000);

    // ── HTTP server ────────────────────────────
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        const parsedUrl = new URL(url, `http://${req.headers.host ?? "localhost"}`);
        const pathname = parsedUrl.pathname;

        // ── CORS headers for all responses ──────
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if (method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        // ── GET / → serve curator page ──────────
        if (method === "GET" && pathname === "/") {
            const token = parsedUrl.searchParams.get("token") ?? "";
            if (!validateToken(token)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid token" }));
                return;
            }

            const pageHtml = generateCuratorPage({
                queries,
                sessionToken,
                bootstrap,
                summaryModels: summaryModels as Array<{
                    value: string;
                    label: string;
                }>,
                defaultSummaryModel,
            });

            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-cache",
            });
            res.end(pageHtml);
            return;
        }

        // ── GET /health → heartbeat ─────────────
        if (method === "GET" && pathname === "/health") {
            touchHeartbeat();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, state }));
            return;
        }

        // ── GET /sse → SSE stream ───────────────
        if (method === "GET" && pathname === "/sse") {
            const token = parsedUrl.searchParams.get("token") ?? "";
            if (!validateToken(token)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid token" }));
                return;
            }

            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });

            sseResponse = res;
            browserConnected = true;

            // Flush buffered events
            while (sseBuffer.length > 0) {
                const buffered = sseBuffer.shift();
                if (buffered) {
                    try {
                        res.write(buffered);
                    } catch {
                        break;
                    }
                }
            }

            // Send initial state
            const initEvent: CuratorServerEvent = {
                type: "init",
                queries: queries as string[],
            };
            sendSSE(initEvent);

            req.on("close", () => {
                browserConnected = false;
                sseResponse = null;
            });

            return;
        }

        // ── POST /heartbeat ──────────────────────
        if (method === "POST" && pathname === "/heartbeat") {
            touchHeartbeat();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // ── POST /update-provider ────────────────
        if (method === "POST" && pathname === "/update-provider") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { provider } = JSON.parse(body) as { provider?: string };
                    if (!provider || !isAvailableProvider(provider)) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Invalid provider" }));
                        return;
                    }
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, provider }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /search ─────────────────────────
        if (method === "POST" && pathname === "/search") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { query, provider } = JSON.parse(body) as {
                        query?: string;
                        provider?: string;
                    };
                    if (!query) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Query is required" }));
                        return;
                    }
                    const effectiveProvider = provider ?? defaultProvider;
                    state = "searching";
                    const abortController = new AbortController();

                    callbacks
                        .onSearch(query, effectiveProvider, abortController.signal)
                        .catch(() => {
                            // Errors handled by caller
                        });

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true, query, provider: effectiveProvider }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /push-result ────────────────────
        if (method === "POST" && pathname === "/push-result") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { queryIndex, answer, results, provider } = JSON.parse(body) as {
                        queryIndex?: number;
                        answer?: string;
                        results?: Array<{ title: string; url: string }>;
                        provider?: string;
                    };
                    if (queryIndex == null) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "queryIndex is required" }));
                        return;
                    }

                    const event: CuratorServerEvent = {
                        type: "result",
                        queryIndex,
                        answer: answer ?? "",
                        results: (results ?? []).map((r) => ({
                            title: r.title,
                            url: r.url,
                        })),
                        provider: provider ?? "unknown",
                    };
                    sendSSE(event);

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /push-error ─────────────────────
        if (method === "POST" && pathname === "/push-error") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { queryIndex, error, provider } = JSON.parse(body) as {
                        queryIndex?: number;
                        error?: string;
                        provider?: string;
                    };
                    if (queryIndex == null) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "queryIndex is required" }));
                        return;
                    }

                    const event: CuratorServerEvent = {
                        type: "error",
                        queryIndex,
                        error: error ?? "Unknown error",
                        provider,
                    };
                    sendSSE(event);

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /done ───────────────────────────
        if (method === "POST" && pathname === "/done") {
            state = "fetching";
            const event: CuratorServerEvent = { type: "done" };
            sendSSE(event);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // ── POST /rewrite ────────────────────────
        if (method === "POST" && pathname === "/rewrite") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { query } = JSON.parse(body) as { query?: string };
                    if (!query) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: "Query is required" }));
                        return;
                    }

                    const abortController = new AbortController();
                    callbacks
                        .onQueryRewrite(query, abortController.signal)
                        .then((rewritten) => {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: true, query: rewritten }));
                        })
                        .catch((err) => {
                            const message = err instanceof Error ? err.message : String(err);
                            res.writeHead(500, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: message }));
                        });
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /summarize ──────────────────────
        if (method === "POST" && pathname === "/summarize") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { model, feedback } = JSON.parse(body) as {
                        model?: string;
                        feedback?: string;
                    };

                    abortInFlightSummarize();
                    summarizeAbortController = new AbortController();
                    const requestId = ++summarizeRequestSeq;
                    const signal = summarizeAbortController.signal;

                    state = "summarizing";

                    callbacks
                        .onSummarize(model, feedback, signal)
                        .then((result) => {
                            if (requestId !== summarizeRequestSeq) {
                                return;
                            } // superseded

                            const event: CuratorServerEvent = {
                                type: "summary_ready",
                                summary: result.summary,
                                meta: result.meta,
                            };
                            sendSSE(event);

                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(
                                JSON.stringify({
                                    ok: true,
                                    summary: result.summary,
                                    meta: result.meta,
                                }),
                            );
                        })
                        .catch((err) => {
                            if (requestId !== summarizeRequestSeq) {
                                return;
                            }
                            const message = err instanceof Error ? err.message : String(err);
                            res.writeHead(500, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ ok: false, error: message }));
                        })
                        .finally(() => {
                            if (requestId === summarizeRequestSeq) {
                                summarizeAbortController = null;
                            }
                        });
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /submit ─────────────────────────
        if (method === "POST" && pathname === "/submit") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const parsed = JSON.parse(body) as {
                        summary?: string;
                        meta?: ISummaryMeta;
                        selectedQueryIndices?: readonly number[];
                    };

                    const summary = parsed.summary ?? "";
                    const summaryMeta = parsed.meta ?? {
                        model: null,
                        durationMs: 0,
                        tokenEstimate: 0,
                        fallbackUsed: true,
                        fallbackReason: "submitted",
                        edited: false,
                    };
                    const selectedIndices = parsed.selectedQueryIndices ?? [];

                    callbacks.onSubmit(summary, summaryMeta, selectedIndices);
                    markCompleted();

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── POST /cancel ─────────────────────────
        if (method === "POST" && pathname === "/cancel") {
            let body = "";
            req.on("data", (chunk: Buffer) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const { reason } = JSON.parse(body) as { reason?: string };
                    abortInFlightSummarize();
                    callbacks.onCancel(reason);
                    markCompleted();

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        // ── 404 fallback ─────────────────────────
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    // ── Watchdog timer ─────────────────────────
    watchdog = setInterval(() => {
        if (completed) {
            return;
        }
        if (!browserConnected) {
            return;
        }
        if (Date.now() - lastHeartbeatAt > STALE_THRESHOLD_MS) {
            // Browser has gone away — auto-submit or cancel
            abortInFlightSummarize();
            callbacks.onCancel("browser-timeout");
            markCompleted();
        }
    }, WATCHDOG_INTERVAL_MS);

    // ── Start listening ────────────────────────
    server.listen(0, "127.0.0.1");

    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : 0;
    const serverUrl = `http://127.0.0.1:${port}`;

    // ── Return handle ──────────────────────────
    const handle: ICuratorServerHandle = {
        url: serverUrl,

        close(): void {
            abortInFlightSummarize();
            markCompleted();
            if (sseResponse) {
                try {
                    sseResponse.end();
                } catch {
                    /* ignore */
                }
                sseResponse = null;
            }
            server.close();
        },

        pushResult(queryIndex: number, response: IAttributedSearchResponse): void {
            const event: CuratorServerEvent = {
                type: "result",
                queryIndex,
                answer: response.answer,
                results: response.results.map((r) => ({ title: r.title, url: r.url })),
                provider: response.provider,
            };
            sendSSE(event);
        },

        pushError(queryIndex: number, error: string, provider?: string): void {
            const event: CuratorServerEvent = {
                type: "error",
                queryIndex,
                error,
                provider,
            };
            sendSSE(event);
        },

        searchesDone(): void {
            state = "fetching";
            const event: CuratorServerEvent = { type: "done" };
            sendSSE(event);
        },
    };

    return handle;
}
