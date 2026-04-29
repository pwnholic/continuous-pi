import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { activityMonitor } from "./activity/monitor.js";
import { loadConfigSafe } from "./config.js";
import { findWebclawBinary, getWebclawVersion } from "./extractors/webclaw.js";
import { clearResults, generateId, restoreFromSession, storeResult } from "./storage/index.js";
import { executeCodeSearch } from "./tools/code-search.js";
import { extractContent, fetchAllContent } from "./tools/fetch-content.js";
import { executeWebSearch } from "./tools/web-search.js";
import type { ActivityEntry, StoredSearchData } from "./types.js";

// ─── Init ──────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
    const cfg = loadConfigSafe();

    // Log webclaw availability
    const wcPath = findWebclawBinary();
    if (wcPath) {
        const version = getWebclawVersion();
        console.error(`[pi-web-access] webclaw ${version ?? "?"} found at ${wcPath}`);
    } else {
        console.error(
            "[pi-web-access] webclaw not found — install with: brew install webclaw or cargo install webclaw-cli",
        );
    }

    // ── Session Lifecycle ─────────────────────────────────────────────────────────

    let _sessionActive = false;
    let widgetVisible = false;
    let widgetUnsubscribe: (() => void) | null = null;

    pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
        _sessionActive = true;
        restoreFromSession(ctx);

        widgetUnsubscribe?.();
        widgetUnsubscribe = null;
        activityMonitor.clear();
        if (widgetVisible) {
            widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
            updateWidget(ctx);
        }
    });

    pi.on("session_shutdown", () => {
        _sessionActive = false;
        widgetUnsubscribe?.();
        widgetUnsubscribe = null;
        activityMonitor.clear();
        widgetVisible = false;
        clearResults();
    });

    // ── Web Search Tool ──────────────────────────────────────────────────────────

    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web using Exa, Perplexity, or Gemini. Returns an AI-synthesized answer with source citations. For comprehensive research, prefer queries (plural) with 2-4 varied angles over a single query.",
        promptSnippet: "Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles.",
        parameters: Type.Object({
            query: Type.Optional(Type.String({ description: "Single search query." })),
            queries: Type.Optional(
                Type.Array(Type.String(), { description: "Multiple queries (preferred for broad research)." }),
            ),
            numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
            includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content" })),
            recencyFilter: Type.Optional(
                StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
            ),
            domainFilter: Type.Optional(
                Type.Array(Type.String(), { description: "Limit domains, prefix with - to exclude" }),
            ),
            provider: Type.Optional(
                StringEnum(["auto", "perplexity", "gemini", "exa"], { description: "Search provider (default: auto)" }),
            ),
        }),

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async execute(_toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any): Promise<any> {
            return executeWebSearch(
                {
                    query: params.query as string | undefined,
                    queries: params.queries as string[] | undefined,
                    numResults: params.numResults as number | undefined,
                    includeContent: params.includeContent as boolean | undefined,
                    recencyFilter: params.recencyFilter as "day" | "week" | "month" | "year" | undefined,
                    domainFilter: params.domainFilter as string[] | undefined,
                    provider: params.provider as string | undefined,
                },
                signal,
                onUpdate,
            );
        },

        renderCall(args: any, theme: Theme) {
            const rawQueryList: unknown[] = Array.isArray(args.queries)
                ? args.queries
                : args.query !== undefined
                  ? [args.query]
                  : [];
            const queryList = rawQueryList.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
            if (queryList.length === 0)
                return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
            if (queryList.length === 1) {
                const q = queryList[0]!;
                const display = q.length > 60 ? `${q.slice(0, 57)}...` : q;
                return new Text(
                    theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`),
                    0,
                    0,
                );
            }
            const lines = [
                theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`),
            ];
            for (const q of queryList.slice(0, 5)) {
                const display = q.length > 50 ? `${q.slice(0, 47)}...` : q;
                lines.push(theme.fg("muted", `  "${display}"`));
            }
            if (queryList.length > 5) lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
            return new Text(lines.join("\n"), 0, 0);
        },

        renderResult(result: any, { isPartial }: any, theme: Theme) {
            const details = result.details as Record<string, unknown> | undefined;
            if (isPartial) {
                const progress = (details?.progress as number) ?? 0;
                const bar =
                    "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
                const query = (details?.currentQuery as string) ?? "";
                const display = query.length > 40 ? `${query.slice(0, 37)}...` : query;
                return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
            }
            if (details?.error) return new Text(theme.fg("error", `Error: ${String(details.error)}`), 0, 0);
            const queryInfo =
                (details?.queryCount as number) === 1
                    ? ""
                    : `${details?.successfulQueries}/${details?.queryCount} queries, `;
            return new Text(theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources`), 0, 0);
        },
    });

    // ── Fetch Content Tool ───────────────────────────────────────────────────────

    pi.registerTool({
        name: "fetch_content",
        label: "Fetch Content",
        description: "Fetch and extract readable content from URLs. Supports web pages, GitHub repos, and video.",
        promptSnippet: "Use to extract content from specific URLs.",
        parameters: Type.Object({
            url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
            urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
            forceClone: Type.Optional(Type.Boolean({ description: "Force cloning large GitHub repos" })),
            prompt: Type.Optional(Type.String({ description: "Question for video analysis" })),
            timestamp: Type.Optional(
                Type.String({ description: "Video frame timestamp: '1:23:45', '85', or '23:41-25:00'" }),
            ),
            frames: Type.Optional(Type.Number({ description: "Number of video frames (1-12)" })),
            model: Type.Optional(Type.String({ description: "Override Gemini model for video" })),
        }),

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async execute(_toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any): Promise<any> {
            const urls: string[] = [];
            if (Array.isArray(params.urls))
                urls.push(...(params.urls as string[]).filter((u) => typeof u === "string" && u.trim().length > 0));
            if (typeof params.url === "string" && params.url.trim().length > 0 && !urls.includes(params.url.trim()))
                urls.push(params.url.trim());

            if (urls.length === 0) {
                return {
                    content: [{ type: "text" as const, text: "Error: No URL provided." }],
                    details: { error: "No URL provided" },
                };
            }

            onUpdate?.({
                content: [{ type: "text" as const, text: `Fetching ${urls.length} URL(s)...` }],
                details: { phase: "fetching" },
            });

            const results = await fetchAllContent(urls, signal, {
                forceClone: params.forceClone as boolean | undefined,
                prompt: params.prompt as string | undefined,
                timestamp: params.timestamp as string | undefined,
                frames: params.frames as number | undefined,
                model: params.model as string | undefined,
            });

            if (signal?.aborted) return { content: [{ type: "text" as const, text: "Aborted" }], details: {} };

            const ok = results.filter((r) => !r.error).length;
            const output = results
                .map((r) => (r.error ? `---\n**${r.url}** → Error: ${r.error}` : `---\n**${r.url}**\n${r.content}`))
                .join("\n\n");

            const fetchId = generateId();
            const data: StoredSearchData = { id: fetchId, type: "fetch", timestamp: Date.now(), urls: results };
            storeResult(fetchId, data);

            return {
                content: [{ type: "text" as const, text: output }],
                details: { urls, successful: ok, failed: results.length - ok, total: results.length, fetchId },
            };
        },
    });

    // ── Code Search Tool ─────────────────────────────────────────────────────────

    pi.registerTool({
        name: "code_search",
        label: "Code Search",
        description: "Search for code examples, docs, and API references.",
        promptSnippet: "Search for code examples and API docs.",
        parameters: Type.Object({
            query: Type.String({ description: "Programming question or topic" }),
            maxTokens: Type.Optional(Type.Number({ description: "Max tokens (default: 5000)" })),
        }),

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async execute(_toolCallId: string, params: any, signal?: AbortSignal): Promise<any> {
            const query = typeof params.query === "string" ? params.query.trim() : "";
            if (!query)
                return {
                    content: [{ type: "text" as const, text: "Error: No query provided." }],
                    details: { error: "No query" },
                };
            return executeCodeSearch(query, (params.maxTokens as number) ?? 5000, signal);
        },
    });

    // ── Get Search Content Tool ──────────────────────────────────────────────────

    pi.registerTool({
        name: "get_search_content",
        label: "Get Search Content",
        description: "Retrieve full content from a previous web_search or fetch_content by responseId.",
        promptSnippet: "Use to access full content from a previous fetch or search.",
        parameters: Type.Object({
            responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
            query: Type.Optional(Type.String({ description: "Specific query within search results" })),
            queryIndex: Type.Optional(Type.Number({ description: "Query index within search results" })),
            url: Type.Optional(Type.String({ description: "Specific URL from fetch results" })),
            urlIndex: Type.Optional(Type.Number({ description: "URL index from fetch results" })),
        }),

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async execute(_toolCallId: string, params: any): Promise<any> {
            const { getContentForQuery, getSearchContent } = await import("./tools/get-content.js");
            const responseId = typeof params.responseId === "string" ? params.responseId.trim() : "";
            if (!responseId) {
                return {
                    content: [{ type: "text" as const, text: "Error: No responseId provided." }],
                    details: { responseId: null, error: "No responseId" },
                };
            }

            // Drill into specific query/url
            if (params.query || params.queryIndex !== undefined || params.url || params.urlIndex !== undefined) {
                const result = getContentForQuery(
                    responseId,
                    typeof params.query === "string" ? params.query : undefined,
                    typeof params.queryIndex === "number" ? params.queryIndex : undefined,
                );
                if (result.error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
                        details: { responseId, error: result.error },
                    };
                }
                return { content: [{ type: "text" as const, text: result.content }], details: { responseId } };
            }

            // Get full stored data
            const { data, error } = getSearchContent(responseId);
            if (error || !data) {
                return {
                    content: [{ type: "text" as const, text: `Error: ${error}` }],
                    details: { responseId, error },
                };
            }

            if (data.type === "fetch") {
                const entries = data.urls ?? [];
                const content = entries.map((u) => `## ${u.url}\n\n${u.content}`).join("\n\n---\n\n");
                return { content: [{ type: "text" as const, text: content }], details: { responseId, type: "fetch" } };
            }

            if (data.type === "search") {
                const queries = data.queries ?? [];
                const content = queries
                    .map(
                        (q) =>
                            `## ${q.query}\n\n${q.answer || "(no answer)"}\n\nSources:\n${q.results.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`,
                    )
                    .join("\n\n---\n\n");
                return { content: [{ type: "text" as const, text: content }], details: { responseId, type: "search" } };
            }

            return {
                content: [{ type: "text" as const, text: "Unknown result type" }],
                details: { responseId, error: "Unknown type" },
            };
        },
    });

    // ── Activity Widget ─────────────────────────────────────────────────────────

    function updateWidget(ctx: ExtensionContext): void {
        const theme = (ctx as unknown as { ui: { theme: Theme } }).ui.theme;
        const entries = activityMonitor.getEntries();
        const lines: string[] = [];

        lines.push(theme.fg("accent", `─── Web Search Activity ${"─".repeat(36)}`));
        if (entries.length === 0) {
            lines.push(theme.fg("muted", "  No activity yet"));
        } else {
            for (const e of entries) {
                lines.push(`  ${formatEntryLine(e, theme)}`);
            }
        }
        lines.push(theme.fg("accent", "─".repeat(60)));

        const rateInfo = activityMonitor.getRateLimitInfo();
        const resetMs = rateInfo.oldestTimestamp
            ? Math.max(0, rateInfo.oldestTimestamp + rateInfo.windowMs - Date.now())
            : 0;
        const resetSec = Math.ceil(resetMs / 1000);
        lines.push(
            theme.fg("muted", `Rate: ${rateInfo.used}/${rateInfo.max}`) +
                (resetMs > 0 ? theme.fg("dim", ` (resets in ${resetSec}s)`) : ""),
        );

        ctx.ui.setWidget("web-activity", lines);
    }

    function formatEntryLine(entry: ActivityEntry, theme: Theme): string {
        const typeStr = entry.type === "api" ? "API" : "GET";
        const target =
            entry.type === "api"
                ? `"${truncateToWidth(entry.query || "", 28, "")}"`
                : truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");

        const duration = entry.endTime
            ? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
            : `${((Date.now() - entry.startTime) / 1000).toFixed(1)}s`;

        let statusStr: string;
        let indicator: string;
        if (entry.error) {
            statusStr = "err";
            indicator = theme.fg("error", "✗");
        } else if (entry.status === null) {
            statusStr = "...";
            indicator = theme.fg("warning", "⋯");
        } else if (entry.status === 0) {
            statusStr = "abort";
            indicator = theme.fg("muted", "○");
        } else {
            statusStr = String(entry.status);
            indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "✓") : theme.fg("error", "✗");
        }

        return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
    }

    // ── Shortcuts ────────────────────────────────────────────────────────────────

    const shortcutActivity = cfg.shortcuts?.activity ?? "ctrl+shift+w";

    pi.registerShortcut(shortcutActivity as any, {
        description: "Toggle web search activity widget",
        handler: async (ctx: ExtensionContext) => {
            widgetVisible = !widgetVisible;
            if (widgetVisible) {
                widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
                updateWidget(ctx);
            } else {
                widgetUnsubscribe?.();
                widgetUnsubscribe = null;
                ctx.ui.setWidget("web-activity", undefined);
            }
        },
    });

    // ── Commands ─────────────────────────────────────────────────────────────────

    pi.registerCommand("webclaw-status", {
        description: "Show webclaw installation status",
        handler: async (_args, ctx: ExtensionCommandContext) => {
            const binPath = findWebclawBinary();
            if (binPath) {
                const version = getWebclawVersion();
                ctx.ui.notify(`webclaw ${version ?? "?"} — ${binPath}`, "info");
            } else {
                ctx.ui.notify("webclaw not found. Install: brew install webclaw", "error");
            }
        },
    });

    pi.registerCommand("web-search-config", {
        description: "Show web-search config file path",
        handler: async (_args, ctx: ExtensionCommandContext) => {
            const { getConfigPath } = await import("./config.js");
            ctx.ui.notify(`Config: ${getConfigPath()}`, "info");
        },
    });
}
