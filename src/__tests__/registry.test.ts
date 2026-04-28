import { describe, expect, it } from "vitest";
import { resolveProvider } from "../providers/registry.js";

const allAvailable = { perplexity: true, exa: true, gemini: true };

describe("provider registry", () => {
    it("resolves 'auto' to first available provider", () => {
        const result = resolveProvider("auto", allAvailable);
        expect(["perplexity", "exa", "gemini"]).toContain(result);
    });

    it("resolves 'exa' provider when available", () => {
        const result = resolveProvider("exa", allAvailable);
        expect(result).toBe("exa");
    });

    it("resolves 'perplexity' when available", () => {
        const result = resolveProvider("perplexity", allAvailable);
        expect(result).toBe("perplexity");
    });

    it("resolves 'gemini' when available", () => {
        const result = resolveProvider("gemini", allAvailable);
        expect(result).toBe("gemini");
    });

    it("falls back when exa is unavailable", () => {
        const result = resolveProvider("exa", { ...allAvailable, exa: false });
        expect(result).not.toBe("exa");
        expect(["perplexity", "gemini"]).toContain(result);
    });

    it("falls back to gemini when exa and perplexity unavailable", () => {
        const result = resolveProvider("auto", { perplexity: false, exa: false, gemini: true });
        expect(result).toBe("gemini");
    });

    it("handles undefined by using auto", () => {
        const result = resolveProvider(undefined, allAvailable);
        expect(["perplexity", "exa", "gemini"]).toContain(result);
    });

    it("handles unknown provider by defaulting to auto", () => {
        const result = resolveProvider("unknown-provider", allAvailable);
        expect(["perplexity", "exa", "gemini"]).toContain(result);
    });
});
