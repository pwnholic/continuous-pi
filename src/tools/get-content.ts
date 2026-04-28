import { getAllResults, getResult } from "../storage/index.js";
import type { StoredSearchData } from "../types.js";

/**
 * Get stored search/fetch results by ID.
 * Part of the get_search_content tool.
 */
export function getSearchContent(responseId: string): { data: StoredSearchData | null; error?: string } {
    const result = getResult(responseId);
    if (!result) {
        return { data: null, error: `No results found for ID: ${responseId}` };
    }
    return { data: result };
}

/**
 * List all stored search results.
 */
export function listAllResults(): StoredSearchData[] {
    return getAllResults();
}

/**
 * Get content for a specific query within a stored result.
 */
export function getContentForQuery(
    responseId: string,
    query?: string,
    queryIndex?: number,
): { content: string; error?: string } {
    const result = getResult(responseId);
    if (!result) {
        return { content: "", error: `No results found for ID: ${responseId}` };
    }

    if (result.type === "fetch") {
        const urls = result.urls ?? [];
        if (queryIndex !== undefined && queryIndex >= 0 && queryIndex < urls.length) {
            const entry = urls[queryIndex]!;
            return { content: entry.content };
        }
        return { content: urls.map((u) => u.content).join("\n\n---\n\n") };
    }

    if (result.type === "search") {
        const queries = result.queries ?? [];

        if (query) {
            const qr = queries.find((q) => q.query.toLowerCase().includes(query.toLowerCase()));
            if (qr) {
                return {
                    content: `${qr.answer}\n\nSources:\n${qr.results.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`,
                };
            }
        }

        if (queryIndex !== undefined && queryIndex >= 0 && queryIndex < queries.length) {
            const qr = queries[queryIndex]!;
            return {
                content: `${qr.answer}\n\nSources:\n${qr.results.map((r) => `- ${r.title}: ${r.url}`).join("\n")}`,
            };
        }

        return { content: queries.map((q) => `## ${q.query}\n${q.answer || "(no answer)"}`).join("\n\n") };
    }

    return { content: "", error: "Unknown result type" };
}
