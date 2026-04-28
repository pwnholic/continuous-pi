import { activityMonitor } from "../activity/monitor.js";
import { callExaMcp } from "../providers/exa.js";

/**
 * Execute a code search query using Exa MCP (get_code_context_exa tool).
 */
export async function executeCodeSearch(
    query: string,
    maxTokens = 5000,
    signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
    const trimmed = query.trim();
    if (!trimmed) {
        return {
            content: [{ type: "text", text: "Error: No query provided." }],
            details: { error: "No query provided" },
        };
    }

    const activityId = activityMonitor.logStart({ type: "api", query: trimmed });

    try {
        const text = await callExaMcp("get_code_context_exa", { query: trimmed, tokensNum: maxTokens }, signal);
        activityMonitor.logComplete(activityId, 200);
        return {
            content: [{ type: "text", text }],
            details: { query: trimmed, maxTokens },
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
            throw err;
        }
        activityMonitor.logError(activityId, message);
        return {
            content: [{ type: "text", text: `Error: ${message}` }],
            details: { query: trimmed, maxTokens, error: message },
        };
    }
}
