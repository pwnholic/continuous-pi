/**
 * ──────────────────────────────────────────────
 *  Exa.ai Search Provider
 * ──────────────────────────────────────────────
 * Searches via Exa's Answer API, Search API, or
 * Exa MCP (free tier, no API key required).
 *
 * Monthly budget: 1 000 requests/month (free tier).
 * Usage is persisted to ~/.pi/exa-usage.json.
 *
 * @module providers/exa
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
    ISearchResult,
    ISearchResponse,
    ISearchOptions,
    IFullSearchOptions,
} from "../types/search.js";
import type { IExtractedContent } from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";
import { activityMonitor } from "../activity.js";
import { toErrorMessage, isAbortError } from "../utils.js";

// ── Constants ──────────────────────────────────

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

const USAGE_FILE = "exa-usage.json";
const MONTHLY_LIMIT = 1_000;
const WARNING_THRESHOLD = 800;

// ── Usage types ────────────────────────────────

interface ExaUsage {
    month: string; // "YYYY-MM"
    count: number;
}

// ── API response types ─────────────────────────

interface ExaAnswerResponse {
    answer?: string;
    citations?: Array<{
        url?: string;
        title?: string;
        text?: string;
        publishedDate?: string;
    }>;
}

interface ExaSearchResponse {
    results?: Array<{
        title?: string;
        url?: string;
        publishedDate?: string;
        author?: string;
        text?: string;
        highlights?: unknown;
        highlightScores?: number[];
    }>;
}

interface ExaMcpRpcResponse {
    result?: {
        content?: Array<{ type?: string; text?: string }>;
        isError?: boolean;
    };
    error?: { code?: number; message?: string };
}

interface McpParsedResult {
    title: string;
    url: string;
    content: string;
}

// ── Exhausted sentinel ─────────────────────────

export type ExaSearchResult = ISearchResponse | { readonly exhausted: true } | null;

// ── In-memory warning state ────────────────────

let warnedMonth: string | null = null;

// ── Usage helpers ──────────────────────────────

function getCurrentMonth(): string {
    return new Date().toISOString().slice(0, 7);
}

function usageFilePath(): string {
    return join(homedir(), ".pi", USAGE_FILE);
}

function readUsage(): ExaUsage {
    const path = usageFilePath();
    const month = getCurrentMonth();

    if (!existsSync(path)) {
        return { month, count: 0 };
    }

    try {
        const raw = JSON.parse(readFileSync(path, "utf-8")) as {
            month?: string;
            count?: number;
        };
        if (raw.month !== month) {
            return { month, count: 0 };
        }
        const count =
            typeof raw.count === "number" && Number.isFinite(raw.count)
                ? Math.max(0, Math.floor(raw.count))
                : 0;
        return { month, count };
    } catch {
        return { month, count: 0 };
    }
}

function writeUsage(usage: ExaUsage): void {
    const dir = join(homedir(), ".pi");
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(usageFilePath(), `${JSON.stringify(usage, null, 2)}\n`);
}

function reserveRequestBudget(): { exhausted: true } | null {
    const usage = readUsage();
    if (usage.count >= MONTHLY_LIMIT) {
        return { exhausted: true };
    }

    const next = usage.count + 1;
    if (next >= WARNING_THRESHOLD && warnedMonth !== usage.month) {
        warnedMonth = usage.month;
        console.error(`Exa usage warning: ${next}/${MONTHLY_LIMIT} monthly requests used.`);
    }

    writeUsage({ month: usage.month, count: next });
    return null;
}

// ── Query helpers ──────────────────────────────

function recencyToStartDate(filter: string): string {
    const offsets: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
    };
    const days = offsets[filter] ?? 0;
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

function mapDomainFilter(domains: readonly string[] | undefined): {
    includeDomains?: string[];
    excludeDomains?: string[];
} {
    if (!domains?.length) {
        return {};
    }
    const include: string[] = [];
    const exclude: string[] = [];
    for (const d of domains) {
        if (d.startsWith("-")) {
            const trimmed = d.slice(1).trim();
            if (trimmed) {
                exclude.push(trimmed);
            }
        } else {
            const trimmed = d.trim();
            if (trimmed) {
                include.push(trimmed);
            }
        }
    }
    return {
        ...(include.length ? { includeDomains: include } : {}),
        ...(exclude.length ? { excludeDomains: exclude } : {}),
    };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(60_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// ── Response mappers ───────────────────────────

function normalizeHighlights(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
}

function buildAnswerFromSearchResults(results: ExaSearchResponse["results"]): string {
    if (!results?.length) {
        return "";
    }
    const parts: string[] = [];
    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        if (!item?.url) {
            continue;
        }
        const highlights = normalizeHighlights(item.highlights);
        const content =
            highlights.length > 0
                ? highlights.join(" ")
                : typeof item.text === "string"
                  ? item.text.trim().slice(0, 1000)
                  : "";
        if (!content) {
            continue;
        }
        parts.push(`${content}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`);
    }
    return parts.join("\n\n");
}

function mapResults(
    results: ExaSearchResponse["results"] | ExaAnswerResponse["citations"],
): ISearchResult[] {
    if (!Array.isArray(results)) {
        return [];
    }
    return results
        .filter((r): r is NonNullable<typeof r> & { url: string } => !!r?.url)
        .map((r, i) => ({
            title: r.title || `Source ${i + 1}`,
            url: r.url,
            snippet: "",
        }));
}

function mapInlineContent(results: ExaSearchResponse["results"]): IExtractedContent[] {
    if (!results?.length) {
        return [];
    }
    return results
        .filter(
            (
                r,
            ): r is NonNullable<(typeof results)[number]> & {
                url: string;
                text: string;
            } => !!r?.url && typeof r.text === "string" && r.text.length > 0,
        )
        .map((r) => ({
            url: r.url,
            title: r.title || "",
            content: r.text,
            error: null,
        }));
}

// ── MCP helpers ────────────────────────────────

function buildMcpQuery(
    query: string,
    options: ISearchOptions & { includeContent?: boolean },
): string {
    const parts = [query];
    if (options.domainFilter?.length) {
        for (const d of options.domainFilter) {
            parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
        }
    }
    if (options.recencyFilter) {
        switch (options.recencyFilter) {
            case "day":
                parts.push("past 24 hours");
                break;
            case "week":
                parts.push("past week");
                break;
            case "month":
                parts.push(new Date().toLocaleString("en", { month: "long", year: "numeric" }));
                break;
            case "year":
                parts.push(String(new Date().getFullYear()));
                break;
        }
    }
    return parts.join(" ");
}

function parseMcpResults(text: string): McpParsedResult[] | null {
    const blocks = text.split(/(?=^Title: )/m).filter((b) => b.trim().length > 0);
    const parsed = blocks
        .map((block) => {
            const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
            const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
            let content = "";
            const textStart = block.indexOf("\nText: ");
            if (textStart >= 0) {
                content = block.slice(textStart + 7).trim();
            } else {
                const hlMatch = block.match(/\nHighlights:\s*\n/);
                if (hlMatch?.index != null) {
                    content = block.slice(hlMatch.index + hlMatch[0].length).trim();
                }
            }
            content = content.replace(/\n---\s*$/, "").trim();
            return { title, url, content };
        })
        .filter((r) => r.url.length > 0);
    return parsed.length > 0 ? parsed : null;
}

function buildAnswerFromMcpResults(results: McpParsedResult[]): string {
    if (results.length === 0) {
        return "";
    }
    return results
        .map(
            (r, i) =>
                `${r.content.replace(/\s+/g, " ").trim().slice(0, 500)}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})`,
        )
        .join("\n\n");
}

function mapMcpInlineContent(results: McpParsedResult[]): IExtractedContent[] {
    return results
        .filter((r) => r.content.length > 0)
        .map((r) => ({
            url: r.url,
            title: r.title,
            content: r.content,
            error: null,
        }));
}

// ── Public API: MCP call ───────────────────────

export async function callExaMcp(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<string> {
    const response = await fetch(EXA_MCP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: toolName, arguments: args },
        }),
        signal: requestSignal(signal),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Exa MCP error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const body = await response.text();
    const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));

    let parsed: ExaMcpRpcResponse | null = null;
    for (const line of dataLines) {
        const payload = line.slice(5).trim();
        if (!payload) {
            continue;
        }
        try {
            const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
            if (candidate?.result || candidate?.error) {
                parsed = candidate;
                break;
            }
        } catch {
            // skip malformed SSE frames
        }
    }

    if (!parsed) {
        try {
            const candidate = JSON.parse(body) as ExaMcpRpcResponse;
            if (candidate?.result || candidate?.error) {
                parsed = candidate;
            }
        } catch {
            // ignore
        }
    }

    if (!parsed) {
        throw new Error("Exa MCP returned an empty response");
    }

    if (parsed.error) {
        const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
        throw new Error(`Exa MCP error${code}: ${parsed.error.message || "Unknown error"}`);
    }

    if (parsed.result?.isError) {
        const msg =
            parsed.result.content
                ?.find((item) => item.type === "text" && typeof item.text === "string")
                ?.text?.trim() ?? "Exa MCP returned an error";
        throw new Error(msg);
    }

    const text =
        parsed.result?.content
            ?.find(
                (item) =>
                    item.type === "text" &&
                    typeof item.text === "string" &&
                    item.text.trim().length > 0,
            )
            ?.text?.trim() ?? null;

    if (!text) {
        throw new Error("Exa MCP returned empty content");
    }
    return text;
}

// ── MCP-backed search (no API key needed) ──────

async function searchWithExaMcp(
    query: string,
    options: IFullSearchOptions = {},
): Promise<ISearchResponse | null> {
    const enrichedQuery = buildMcpQuery(query, options);
    const activityId = activityMonitor.logStart({
        type: "api",
        query: enrichedQuery,
    });

    try {
        const text = await callExaMcp(
            "web_search_exa",
            {
                query: enrichedQuery,
                numResults: options.numResults ?? 5,
                livecrawl: "fallback",
                type: "auto",
                contextMaxCharacters: options.includeContent ? 50_000 : 3_000,
            },
            options.signal,
        );
        activityMonitor.logComplete(activityId, 200);

        const parsedResults = parseMcpResults(text);
        if (!parsedResults) {
            return null;
        }

        const response: ISearchResponse = {
            answer: buildAnswerFromMcpResults(parsedResults),
            results: parsedResults.map((r, i) => ({
                title: r.title || `Source ${i + 1}`,
                url: r.url,
                snippet: "",
            })),
        };

        if (options.includeContent) {
            const inline = mapMcpInlineContent(parsedResults);
            if (inline.length > 0) {
                response.inlineContent = inline;
            }
        }

        return response;
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        throw err;
    }
}

// ── Public API: availability ───────────────────

export function isExaAvailable(configLoader: IConfigLoader): boolean {
    if (configLoader.exaApiKey) {
        const usage = readUsage();
        return usage.count < MONTHLY_LIMIT;
    }
    // No API key => MCP fallback, always available
    return true;
}

export function hasExaApiKey(configLoader: IConfigLoader): boolean {
    return configLoader.exaApiKey !== null;
}

// ── Public API: search ─────────────────────────

export async function searchWithExa(
    query: string,
    configLoader: IConfigLoader,
    options: IFullSearchOptions = {},
): Promise<ExaSearchResult> {
    const apiKey = configLoader.exaApiKey;

    // No API key → use free MCP path
    if (!apiKey) {
        return searchWithExaMcp(query, options);
    }

    // API key available → use direct API (budget-tracked)
    const budget = reserveRequestBudget();
    if (budget) {
        return budget;
    }

    const useSearch =
        options.includeContent ||
        !!options.recencyFilter ||
        !!options.domainFilter?.length ||
        !!(options.numResults && options.numResults !== 5);

    const activityId = activityMonitor.logStart({ type: "api", query });

    try {
        if (!useSearch) {
            // ── Answer API (simpler, no filter support) ──
            const response = await fetch(EXA_ANSWER_URL, {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, text: true }),
                signal: requestSignal(options.signal),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Exa API error ${response.status}: ${errText.slice(0, 300)}`);
            }

            const data = (await response.json()) as ExaAnswerResponse;
            activityMonitor.logComplete(activityId, response.status);
            return {
                answer: data.answer || "",
                results: mapResults(data.citations),
            } satisfies ISearchResponse;
        }

        // ── Search API (supports filters, highlights, inline content) ──
        const startDate = options.recencyFilter ? recencyToStartDate(options.recencyFilter) : null;
        const domainFilters = mapDomainFilter(options.domainFilter);

        const response = await fetch(EXA_SEARCH_URL, {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query,
                type: "auto",
                numResults: options.numResults ?? 5,
                ...domainFilters,
                ...(startDate ? { startPublishedDate: startDate } : {}),
                contents: {
                    text: options.includeContent ? true : { maxCharacters: 3_000 },
                    highlights: true,
                },
            }),
            signal: requestSignal(options.signal),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Exa API error ${response.status}: ${errText.slice(0, 300)}`);
        }

        const data = (await response.json()) as ExaSearchResponse;
        activityMonitor.logComplete(activityId, response.status);

        const mapped: ISearchResponse = {
            answer: buildAnswerFromSearchResults(data.results),
            results: mapResults(data.results),
        };

        if (options.includeContent) {
            const inline = mapInlineContent(data.results);
            if (inline.length > 0) {
                mapped.inlineContent = inline;
            }
        }

        return mapped;
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
        } else {
            activityMonitor.logError(activityId, toErrorMessage(err));
        }
        throw err;
    }
}
