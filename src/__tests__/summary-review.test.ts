import { describe, expect, it } from "vitest";
import { buildDeterministicSummary, buildSummaryPrompt } from "../summary-review.js";
import type { QueryResultData } from "../types.js";

describe("summary-review", () => {
    const mockResults: QueryResultData[] = [
        {
            query: "React 19 features",
            answer: "React 19 introduces Actions, new hooks, and improved performance.",
            provider: "exa",
            results: [
                { title: "React Blog", url: "https://react.dev/blog/19", domain: "react.dev" },
                { title: "React 19 Release", url: "https://github.com/facebook/react/releases", domain: "github.com" },
            ],
            error: null,
            timestamp: Date.now(),
        },
        {
            query: "TypeScript 6",
            answer: "TypeScript 6 brings better type inference.",
            provider: "perplexity",
            results: [{ title: "TS 6 Docs", url: "https://typescriptlang.org/docs/6", domain: "typescriptlang.org" }],
            error: null,
            timestamp: Date.now(),
        },
    ];

    describe("buildSummaryPrompt", () => {
        it("includes search results in prompt", () => {
            const prompt = buildSummaryPrompt(mockResults);
            expect(prompt).toContain("React 19 features");
            expect(prompt).toContain("TypeScript 6");
            expect(prompt).toContain("react.dev");
            expect(prompt).toContain("search_results");
        });

        it("includes feedback when provided", () => {
            const prompt = buildSummaryPrompt(mockResults, "Focus on breaking changes");
            expect(prompt).toContain("user_feedback");
            expect(prompt).toContain("Focus on breaking changes");
        });

        it("handles empty results", () => {
            const prompt = buildSummaryPrompt([]);
            expect(prompt).toContain("search_results");
        });
    });

    describe("buildDeterministicSummary", () => {
        it("generates summary from results", () => {
            const { summary, meta } = buildDeterministicSummary(mockResults);
            expect(summary).toContain("React 19");
            expect(summary).toContain("TypeScript 6");
            expect(summary).toContain("Sources");
            expect(meta.fallbackUsed).toBe(true);
            expect(meta.model).toBeNull();
        });

        it("handles empty results", () => {
            const { summary } = buildDeterministicSummary([]);
            expect(summary).toContain("No completed search results");
        });

        it("includes error results", () => {
            const withError: QueryResultData[] = [
                {
                    query: "broken query",
                    answer: "",
                    provider: "exa",
                    results: [],
                    error: "API rate limit exceeded",
                    timestamp: Date.now(),
                },
            ];
            const { summary } = buildDeterministicSummary(withError);
            expect(summary).toContain("broken query");
            expect(summary).toContain("API rate limit");
        });
    });
});
