/**
 * ──────────────────────────────────────────────
 *  Curator — Summary Generation
 * ──────────────────────────────────────────────
 * Builds summarisation prompts from search results,
 * generates drafts via the configured AI model,
 * and provides a deterministic fallback summary
 * when the model is unavailable.
 *
 * @module curator/summary
 */

import type { ISummaryMeta, ISummaryGenerationContext } from "../types/curator.js";

// ── Query result data shape ────────────────────

export interface IQueryResultData {
    readonly query: string;
    readonly answer: string;
    readonly results: readonly { title: string; url: string; snippet: string }[];
    readonly error: string | null;
    readonly provider?: string;
}

// ── Preferred summary models (tried in order) ──

const PREFERRED_SUMMARY_MODELS = [
    { provider: "anthropic", id: "claude-haiku-4-5" },
    { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
] as const;

// ── Token estimation ───────────────────────────

function estimateTokens(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return 0;
    }
    return Math.max(1, Math.ceil(trimmed.length / 4));
}

// ── Query-result serialisation ─────────────────

function summarizeQueryResult(result: IQueryResultData): string {
    if (result.error) {
        return `Query: ${result.query}\nStatus: Error\nError: ${result.error}`;
    }

    const lines = [
        `Query: ${result.query}`,
        `Provider: ${result.provider ?? "unknown"}`,
        `Answer: ${result.answer || "(no answer text returned)"}`,
    ];

    if (result.results.length === 0) {
        lines.push("Sources: none");
        return lines.join("\n");
    }

    lines.push("Sources:");
    for (let i = 0; i < result.results.length; i++) {
        const source = result.results[i]!;
        lines.push(`${i + 1}. ${source.title} — ${source.url}`);
    }

    return lines.join("\n");
}

// ── Prompt building ────────────────────────────

export function buildSummaryPrompt(
    results: readonly IQueryResultData[],
    feedback?: string,
): string {
    const sections = [
        "You are writing the final web search summary for a coding assistant.",
        "Write a concise, factual summary using only the provided search results.",
        "Requirements:",
        "- Keep it readable and skimmable.",
        "- Include key findings and caveats.",
        "- Do not invent sources or claims.",
        "- If evidence is weak or conflicting, say so explicitly.",
        '- End with a short "Sources" section listing the most relevant URLs.',
    ];

    if (feedback) {
        sections.push("- Incorporate the user feedback provided below into the summary.");
    }

    sections.push("");
    sections.push("<search_results>");

    for (let i = 0; i < results.length; i++) {
        sections.push(`\n[Result ${i + 1}]`);
        sections.push(summarizeQueryResult(results[i]!));
    }

    sections.push("\n</search_results>");

    if (feedback) {
        sections.push("");
        sections.push("<user_feedback>");
        sections.push(feedback);
        sections.push("</user_feedback>");
    }

    return sections.join("\n");
}

// ── Deterministic fallback helpers ─────────────

function buildDeterministicAnswerPreview(answer: string): string {
    let text = answer.replace(/\s+/g, " ").trim();
    if (text.length === 0) {
        return "";
    }

    const sourceMarker = text.search(/\bSources?\s*:/i);
    if (sourceMarker >= 0) {
        text = text.slice(0, sourceMarker).trim();
    }
    if (text.length === 0) {
        return "";
    }

    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function buildDeterministicSummaryLines(results: readonly IQueryResultData[]): string[] {
    if (results.length === 0) {
        return [
            "No completed search results were available when the curator session finished.",
            "",
            "Sources",
            "- None",
        ];
    }

    const lines: string[] = ["Summary based on the currently selected search results.", ""];

    const sourceUrls: string[] = [];
    let successful = 0;
    let failed = 0;

    for (const result of results) {
        if (result.error) {
            failed += 1;
            lines.push(`- ${result.query}: failed (${result.error})`);
            continue;
        }

        successful += 1;
        const preview = buildDeterministicAnswerPreview(result.answer);
        if (preview.length > 0) {
            lines.push(`- ${result.query}: ${preview}`);
        } else {
            lines.push(
                `- ${result.query}: returned ${result.results.length} source${result.results.length === 1 ? "" : "s"} without answer text.`,
            );
        }

        for (const source of result.results) {
            if (!sourceUrls.includes(source.url)) {
                sourceUrls.push(source.url);
            }
        }
    }

    lines.push("");
    lines.push(`Completed queries: ${results.length}`);
    lines.push(`Successful: ${successful}`);
    lines.push(`Failed: ${failed}`);
    lines.push("");
    lines.push("Sources");

    if (sourceUrls.length === 0) {
        lines.push("- None");
    } else {
        for (const url of sourceUrls.slice(0, 12)) {
            lines.push(`- ${url}`);
        }
        if (sourceUrls.length > 12) {
            lines.push(`- ... and ${sourceUrls.length - 12} more`);
        }
    }

    return lines;
}

// ── Public API: deterministic summary ──────────

export function buildDeterministicSummary(results: readonly IQueryResultData[]): {
    summary: string;
    meta: ISummaryMeta;
} {
    const summary = buildDeterministicSummaryLines(results).join("\n").trim();
    const nonEmptySummary =
        summary.length > 0
            ? summary
            : "No completed search results were available when the curator session finished.\n\nSources\n- None";

    return {
        summary: nonEmptySummary,
        meta: {
            model: null,
            durationMs: 0,
            tokenEstimate: estimateTokens(nonEmptySummary),
            fallbackUsed: true,
            fallbackReason: "deterministic-submit-fallback",
            edited: false,
        },
    };
}

// ── Model resolution ───────────────────────────

async function resolveSummaryModel(
    ctx: ISummaryGenerationContext,
    modelOverride?: string,
): Promise<{
    model: { provider: string; id: string };
    apiKey: string;
    headers?: Record<string, string>;
}> {
    // Normalise model override: "provider/model-id"
    const normalizedOverride = typeof modelOverride === "string" ? modelOverride.trim() : "";

    if (normalizedOverride.length > 0) {
        const slashIndex = normalizedOverride.indexOf("/");
        if (slashIndex <= 0 || slashIndex >= normalizedOverride.length - 1) {
            throw new Error(`Invalid summary model: ${normalizedOverride}. Use provider/model-id.`);
        }
        const provider = normalizedOverride.slice(0, slashIndex);
        const modelId = normalizedOverride.slice(slashIndex + 1);
        const model = ctx.modelRegistry.find(provider, modelId);
        if (!model) {
            throw new Error(`Summary model not found: ${normalizedOverride}`);
        }
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth.ok || !auth.apiKey) {
            throw new Error(`No API key available for summary model ${normalizedOverride}`);
        }
        return {
            model: { provider: model.provider, id: model.id },
            apiKey: auth.apiKey,
            headers: auth.headers,
        };
    }

    // Default: try preferred models in order
    for (const { provider, id } of PREFERRED_SUMMARY_MODELS) {
        const model = ctx.modelRegistry.find(provider, id);
        if (!model) {
            continue;
        }
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (auth.ok && auth.apiKey) {
            return {
                model: { provider: model.provider, id: model.id },
                apiKey: auth.apiKey,
                headers: auth.headers,
            };
        }
    }

    throw new Error(
        `No API key available for summary models: ${PREFERRED_SUMMARY_MODELS.map((c) => `${c.provider}/${c.id}`).join(", ")}`,
    );
}

// ── Response parsing helpers ───────────────────

function getTextFromContentPart(part: unknown): string {
    if (!part || typeof part !== "object") {
        return "";
    }
    const value = part as Record<string, unknown>;
    if (typeof value.text === "string") {
        return value.text;
    }
    if (typeof value.refusal === "string") {
        return value.refusal;
    }
    return "";
}

function getContentPartType(part: unknown): string {
    if (!part || typeof part !== "object") {
        return "unknown";
    }
    const value = part as Record<string, unknown>;
    return typeof value.type === "string" ? value.type : "unknown";
}

// ── Public API: generate summary draft ─────────

export async function generateSummaryDraft(
    results: readonly IQueryResultData[],
    ctx: ISummaryGenerationContext,
    signal?: AbortSignal,
    modelOverride?: string,
    feedback?: string,
): Promise<{ summary: string; meta: ISummaryMeta }> {
    if (!ctx || !ctx.modelRegistry) {
        throw new Error("Summary generation context unavailable");
    }

    const startedAt = Date.now();
    const { apiKey, headers } = await resolveSummaryModel(ctx, modelOverride);
    const prompt = buildSummaryPrompt(results, feedback);

    const userMessage = {
        role: "user" as const,
        content: [{ type: "text" as const, text: prompt }],
        timestamp: Date.now(),
    };

    const response = await ctx.complete(
        ctx.model!,
        {
            messages: [userMessage],
        },
        { apiKey, headers, signal },
    );

    if (response.stopReason === "aborted") {
        throw new Error("Aborted");
    }

    const contentParts = Array.isArray(response.content) ? response.content : [];
    const summary = contentParts
        .map((part: unknown) => getTextFromContentPart(part))
        .filter((text: string) => text.trim().length > 0)
        .join("\n")
        .trim();

    if (summary.length === 0) {
        const partTypes = contentParts.map((part: unknown) => getContentPartType(part));
        const typesLabel = partTypes.length > 0 ? partTypes.join(", ") : "none";
        throw new Error(`Summary model returned empty response (content parts: ${typesLabel})`);
    }

    return {
        summary,
        meta: {
            model: "unknown/unknown",
            durationMs: Math.max(0, Date.now() - startedAt),
            tokenEstimate: estimateTokens(summary),
            fallbackUsed: false,
            edited: false,
        },
    };
}
