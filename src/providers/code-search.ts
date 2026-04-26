/**
 * ──────────────────────────────────────────────
 *  Code Search Provider
 * ──────────────────────────────────────────────
 * Searches for code examples, documentation, and
 * API references via the Exa MCP endpoint.
 *
 * No API key required — uses the free Exa MCP tier.
 *
 * @module providers/code-search
 */

import { callExaMcp } from "./exa.js";
import { activityMonitor } from "../activity.js";
import { toErrorMessage, isAbortError } from "../utils.js";

// ── Public API ─────────────────────────────────

export interface CodeSearchParams {
    /** Programming question, API, library, or debugging topic. */
    query: string;
    /** Maximum tokens of context to return (default: 5000, max: 50000). */
    maxTokens?: number;
}

export interface CodeSearchResult {
    content: Array<{ type: "text"; text: string }>;
    details: {
        query: string;
        maxTokens: number;
        error?: string;
    };
}

/**
 * Search for code / documentation context using the Exa MCP
 * `get_code_context_exa` tool.
 *
 * @param params - Search query and optional token limit.
 * @param signal - Optional abort signal.
 * @returns The code context result with text content.
 */
export async function executeCodeSearch(
    _toolCallId: string,
    params: CodeSearchParams,
    signal?: AbortSignal,
): Promise<CodeSearchResult> {
    const query = params.query.trim();
    if (!query) {
        return {
            content: [{ type: "text", text: "Error: No query provided." }],
            details: {
                query: "",
                maxTokens: params.maxTokens ?? 5000,
                error: "No query provided",
            },
        };
    }

    const maxTokens = params.maxTokens ?? 5000;
    const activityId = activityMonitor.logStart({ type: "api", query });

    try {
        const text = await callExaMcp(
            "get_code_context_exa",
            {
                query,
                tokensNum: maxTokens,
            },
            signal,
        );

        activityMonitor.logComplete(activityId, 200);

        return {
            content: [{ type: "text", text }],
            details: { query, maxTokens },
        };
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
            throw err;
        }

        const message = toErrorMessage(err);
        activityMonitor.logError(activityId, message);

        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            details: { query, maxTokens, error: message },
        };
    }
}
