/**
 * ──────────────────────────────────────────────
 *  Extension Entry Point
 * ──────────────────────────────────────────────
 * Registers search, fetch, and code-search tools
 * with the Pi Coding Agent runtime.
 *
 * @module index
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ── Config ────────────────────────────────────
import { ConfigLoader } from "./config/index.js";

// ── Search ────────────────────────────────────
import { search } from "./providers/registry.js";
import { executeCodeSearch } from "./providers/code-search.js";
import { clearCloneCache } from "./extractors/github.js";

// ── Content extraction ────────────────────────
import { extractContent } from "./extractors/registry.js";

// ── Storage ───────────────────────────────────
import {
    generateId,
    storeResult,
    getResult,
    getAllResults,
    clearResults,
    restoreFromSession,
    type IQueryResultData,
} from "./storage.js";

// ── Activity ──────────────────────────────────
import { activityMonitor } from "./activity.js";

// ── Singleton config loader ───────────────────
const config = new ConfigLoader();

// ══════════════════════════════════════════════
//  Extension: register
// ══════════════════════════════════════════════

export default async function main(pi: ExtensionAPI) {
    // ── Restore session data ──────────────────────
    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
        restoreFromSession(ctx);
    });

    pi.on("session_shutdown", () => {
        clearResults();
        clearCloneCache();
        activityMonitor.clear();
        config.reload();
    });

    // ── Tool: web_search ──────────────────────────
    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            `Search the web using Exa, Perplexity, or Gemini. Returns an AI-synthesised answer with source citations. ` +
            `For comprehensive research, prefer {queries:[...]} with 2–4 varied angles. ` +
            `When includeContent is true, full page content is fetched in the background.`,
        promptSnippet:
            "Use for web research questions. Prefer {queries:[...]} with 2–4 varied angles.",
        parameters: Type.Object({
            query: Type.Optional(Type.String({ description: "Single search query." })),
            queries: Type.Optional(
                Type.Array(Type.String(), {
                    description:
                        "Multiple queries searched in sequence. Prefer this for research — vary phrasing and scope across 2–4 queries.",
                }),
            ),
            numResults: Type.Optional(
                Type.Number({ description: "Results per query (default: 5, max: 20)" }),
            ),
            includeContent: Type.Optional(
                Type.Boolean({
                    description: "Fetch full page content from sources (async)",
                }),
            ),
            recencyFilter: Type.Optional(
                Type.Union(
                    [
                        Type.Literal("day"),
                        Type.Literal("week"),
                        Type.Literal("month"),
                        Type.Literal("year"),
                    ],
                    { description: "Filter by recency" },
                ),
            ),
            domainFilter: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Limit to domains (prefix with - to exclude)",
                }),
            ),
            provider: Type.Optional(
                Type.Union(
                    [
                        Type.Literal("auto"),
                        Type.Literal("exa"),
                        Type.Literal("perplexity"),
                        Type.Literal("gemini"),
                    ],
                    { description: "Search provider (default: auto)" },
                ),
            ),
            workflow: Type.Optional(
                Type.Union([Type.Literal("none"), Type.Literal("summary-review")], {
                    description: "Workflow mode (default: summary-review)",
                }),
            ),
        }),

        async execute(_toolCallId, params, signal) {
            const rawQueryList = params.query
                ? [params.query]
                : Array.isArray(params.queries) && params.queries.length > 0
                  ? params.queries
                  : [];

            if (rawQueryList.length === 0) {
                return {
                    content: [{ type: "text" as const, text: "Error: No query provided." }],
                    details: { error: "No query provided" },
                };
            }

            const provider = params.provider ?? "auto";

            // Single query — simple path
            if (rawQueryList.length === 1) {
                try {
                    const result = await search(rawQueryList[0], config, {
                        provider: provider as never,
                        numResults: params.numResults,
                        recencyFilter: params.recencyFilter,
                        domainFilter: params.domainFilter,
                        includeContent: params.includeContent,
                        signal,
                    });

                    const responseId = generateId();
                    storeResult(responseId, {
                        id: responseId,
                        type: "search",
                        timestamp: Date.now(),
                        queries: [
                            {
                                query: rawQueryList[0],
                                answer: result.answer,
                                results: result.results as never[],
                                error: null,
                                provider: result.provider,
                            },
                        ],
                    });

                    const text = `# ${result.provider} Search Results\n\n${result.answer}\n\nSources:\n${result.results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n")}`;

                    return {
                        content: [{ type: "text" as const, text }],
                        details: {
                            queries: rawQueryList,
                            queryCount: 1,
                            responseId,
                            provider: result.provider,
                            resultCount: result.results.length,
                        },
                    };
                } catch (err) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                            },
                        ],
                        details: {
                            error: err instanceof Error ? err.message : String(err),
                        },
                    };
                }
            }

            // Multiple queries — sequential
            const queryResults: IQueryResultData[] = [];
            for (const q of rawQueryList) {
                try {
                    const result = await search(q, config, {
                        provider: provider as never,
                        numResults: params.numResults,
                        recencyFilter: params.recencyFilter,
                        domainFilter: params.domainFilter,
                        signal,
                    });
                    queryResults.push({
                        query: q,
                        answer: result.answer,
                        results: result.results as never[],
                        error: null,
                        provider: result.provider,
                    });
                } catch (err) {
                    queryResults.push({
                        query: q,
                        answer: "",
                        results: [],
                        error: err instanceof Error ? err.message : String(err),
                        provider: "unknown",
                    });
                }
            }

            const responseId = generateId();
            storeResult(responseId, {
                id: responseId,
                type: "search",
                timestamp: Date.now(),
                queries: queryResults,
            });

            const text = queryResults
                .map(
                    (qr) =>
                        `## Query: ${qr.query}\n${qr.error ? `Error: ${qr.error}` : `Provider: ${qr.provider}\n\n${qr.answer}\n\nSources:\n${qr.results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join("\n")}`}`,
                )
                .join("\n\n---\n\n");

            return {
                content: [{ type: "text" as const, text }],
                details: {
                    queries: rawQueryList,
                    queryCount: rawQueryList.length,
                    responseId,
                },
            };
        },
    });

    // ── Tool: code_search ─────────────────────────
    pi.registerTool({
        name: "code_search",
        label: "Code Search",
        description:
            "Search for code examples, documentation, and API references. " +
            "Returns relevant code snippets and docs.",
        promptSnippet: "Use for programming/API/library questions to retrieve concrete examples.",
        parameters: Type.Object({
            query: Type.String({
                description: "Programming question, API, library, or debugging topic",
            }),
            maxTokens: Type.Optional(
                Type.Integer({
                    minimum: 1000,
                    maximum: 50000,
                    description: "Maximum tokens of context (default: 5000)",
                }),
            ),
        }),

        async execute(toolCallId, params, signal) {
            return executeCodeSearch(toolCallId, params, signal);
        },
    });

    // ── Tool: fetch_content ───────────────────────
    pi.registerTool({
        name: "fetch_content",
        label: "Fetch Content",
        description:
            "Fetch URL(s) and extract readable content as markdown. " +
            "Supports web pages, YouTube videos, GitHub repos, PDFs, and local videos. " +
            "Content is always stored and can be retrieved with get_search_content.",
        promptSnippet:
            "Use to extract readable content from URL(s), YouTube, GitHub repos, or local videos.",
        parameters: Type.Object({
            url: Type.Optional(Type.String({ description: "Single URL or file path" })),
            urls: Type.Optional(
                Type.Array(Type.String(), { description: "Multiple URLs (parallel)" }),
            ),
            prompt: Type.Optional(
                Type.String({
                    description: "Question for video analysis (YouTube / local video)",
                }),
            ),
            forceClone: Type.Optional(
                Type.Boolean({
                    description: "Force cloning large GitHub repos that exceed the size threshold",
                }),
            ),
            timestamp: Type.Optional(
                Type.String({
                    description: "Extract video frame(s) at timestamp or time range",
                }),
            ),
            frames: Type.Optional(
                Type.Integer({
                    minimum: 1,
                    maximum: 12,
                    description: "Number of frames to extract (max 12)",
                }),
            ),
            model: Type.Optional(
                Type.String({
                    description: "Override Gemini model for video analysis",
                }),
            ),
        }),

        async execute(_toolCallId, params, signal) {
            const urlList: string[] = [];
            if (params.url) {
                urlList.push(params.url);
            }
            if (Array.isArray(params.urls)) {
                urlList.push(...params.urls);
            }

            if (urlList.length === 0) {
                return {
                    content: [{ type: "text" as const, text: "Error: No URL(s) provided." }],
                    details: { error: "No URL(s) provided" },
                };
            }

            const fetchResults = await Promise.all(
                urlList.map((url) =>
                    extractContent(url, config, {
                        prompt: params.prompt,
                        forceClone: params.forceClone,
                        timestamp: params.timestamp,
                        frames: params.frames,
                        model: params.model,
                        signal,
                    }),
                ),
            );

            const successful = fetchResults.filter((r) => !r.error).length;
            const totalChars = fetchResults.reduce((sum, r) => sum + r.content.length, 0);

            const responseId = generateId();
            storeResult(responseId, {
                id: responseId,
                type: "fetch",
                timestamp: Date.now(),
                urls: fetchResults as never[],
            });

            if (urlList.length === 1) {
                const result = fetchResults[0];
                if (!result) {
                    return {
                        content: [{ type: "text" as const, text: "Error: No result returned." }],
                        details: { error: "No result" },
                    };
                }
                if (result.error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
                        details: { error: result.error, url: urlList[0] },
                    };
                }

                const parts: Array<{
                    type: "text" | "image";
                    text?: string;
                    data?: string;
                    mimeType?: string;
                }> = [];
                parts.push({ type: "text" as const, text: result.content });

                if (result.thumbnail) {
                    parts.push({
                        type: "image" as const,
                        data: result.thumbnail.data,
                        mimeType: result.thumbnail.mimeType,
                    });
                }

                return {
                    content: parts,
                    details: {
                        urls: urlList,
                        urlCount: 1,
                        successful: 1,
                        totalChars,
                        title: result.title,
                        hasImage: !!result.thumbnail,
                    },
                };
            }

            // Multiple URLs
            const summary = fetchResults
                .map(
                    (r, i) =>
                        `${i + 1}. ${r.title || urlList[i]} — ${r.error ? `Error: ${r.error}` : `${r.content.length} chars`}`,
                )
                .join("\n");

            return {
                content: [{ type: "text" as const, text: summary }],
                details: {
                    urls: urlList,
                    urlCount: urlList.length,
                    successful,
                    totalChars,
                },
            };
        },
    });

    // ── Tool: get_search_content ──────────────────
    pi.registerTool({
        name: "get_search_content",
        label: "Get Search Content",
        description:
            "Retrieve stored content from previous searches or fetches. " +
            "Use responseId, url, or query to find the content.",
        promptSnippet: "Use to retrieve previously fetched content.",
        parameters: Type.Object({
            responseId: Type.Optional(
                Type.String({
                    description: "The response ID from a previous search or fetch",
                }),
            ),
            query: Type.Optional(Type.String({ description: "The original search query" })),
            url: Type.Optional(Type.String({ description: "The original URL" })),
        }),

        async execute(_toolCallId, params) {
            // Try by responseId
            if (params.responseId) {
                const data = getResult(params.responseId);
                if (!data) {
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: `No results found for ID: ${params.responseId}`,
                            },
                        ],
                        details: { error: "Not found", responseId: params.responseId },
                    };
                }

                if (data.type === "search" && data.queries) {
                    const text = data.queries
                        .map(
                            (q) =>
                                `## ${q.query}\n${q.error ? `Error: ${q.error}` : `${q.answer}\n\nSources:\n${q.results.map((r) => `- [${r.title}](${r.url})`).join("\n")}`}`,
                        )
                        .join("\n\n---\n\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        details: {
                            responseId: params.responseId,
                            queryCount: data.queries.length,
                        },
                    };
                }

                if (data.type === "fetch" && data.urls) {
                    const text = data.urls
                        .map((u) => `## ${u.title}\n${u.error ? `Error: ${u.error}` : u.content}`)
                        .join("\n\n---\n\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        details: {
                            responseId: params.responseId,
                            urlCount: data.urls.length,
                        },
                    };
                }
            }

            // Try by URL
            if (params.url) {
                const allResults = getAllResults();
                for (const data of allResults) {
                    if (data.type === "fetch" && data.urls) {
                        const match = data.urls.find((u) => u.url === params.url);
                        if (match) {
                            return {
                                content: [{ type: "text" as const, text: match.content }],
                                details: {
                                    url: match.url,
                                    title: match.title,
                                    contentLength: match.content.length,
                                },
                            };
                        }
                    }
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `No results found for URL: ${params.url}`,
                        },
                    ],
                    details: { error: "Not found", url: params.url },
                };
            }

            // Try by query
            if (params.query) {
                const allResults = getAllResults();
                for (const data of allResults) {
                    if (data.type === "search" && data.queries) {
                        const match = data.queries.find((q) =>
                            q.query.toLowerCase().includes((params.query ?? "").toLowerCase()),
                        );
                        if (match) {
                            return {
                                content: [
                                    {
                                        type: "text" as const,
                                        text: `${match.answer}\n\nSources:\n${match.results.map((r) => `- [${r.title}](${r.url})`).join("\n")}`,
                                    },
                                ],
                                details: {
                                    query: match.query,
                                    resultCount: match.results.length,
                                },
                            };
                        }
                    }
                }
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `No results found for query: ${params.query}`,
                        },
                    ],
                    details: { error: "Not found", query: params.query },
                };
            }

            // List all available results
            const allResults = getAllResults();
            if (allResults.length === 0) {
                return {
                    content: [{ type: "text" as const, text: "No stored results available." }],
                    details: { error: "Empty" },
                };
            }

            const text = allResults
                .map(
                    (r) =>
                        `- [${r.id}] ${r.type === "search" ? `${r.queries?.length ?? 0} queries` : `${r.urls?.length ?? 0} URLs`} (${new Date(r.timestamp).toISOString()})`,
                )
                .join("\n");

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `## Stored Results\n\n${text}\n\nUse \`responseId\` to retrieve full content.`,
                    },
                ],
                details: { resultCount: allResults.length },
            };
        },
    });
}
