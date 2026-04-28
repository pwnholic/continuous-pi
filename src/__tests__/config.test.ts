import { describe, expect, it } from "vitest";
import { getWebclawConfig, getSummaryModels, getSummarizerModel, getVideoModel, getApiBaseUrl } from "../config.js";

describe("config - getWebclawConfig", () => {
    it("returns defaults when no webclaw config", () => {
        const cfg = getWebclawConfig({});
        expect(cfg.browser).toBe("chrome");
        expect(cfg.fallbackToReadability).toBe(true);
        expect(cfg.path).toBeUndefined();
    });

    it("merges browser setting", () => {
        const cfg = getWebclawConfig({ webclaw: { browser: "firefox" } });
        expect(cfg.browser).toBe("firefox");
    });

    it("merges custom path", () => {
        const cfg = getWebclawConfig({ webclaw: { path: "/custom/webclaw" } });
        expect(cfg.path).toBe("/custom/webclaw");
    });

    it("merges proxy setting", () => {
        const cfg = getWebclawConfig({ webclaw: { proxy: "http://proxy:8080" } });
        expect(cfg.proxy).toBe("http://proxy:8080");
    });

    it("disables readability fallback", () => {
        const cfg = getWebclawConfig({ webclaw: { fallbackToReadability: false } });
        expect(cfg.fallbackToReadability).toBe(false);
    });

    it("handles full config", () => {
        const cfg = getWebclawConfig({
            webclaw: { path: "/path", browser: "safari-ios", proxy: "http://proxy", fallbackToReadability: false },
        });
        expect(cfg.path).toBe("/path");
        expect(cfg.browser).toBe("safari-ios");
    });
});

describe("config - getSummaryModels", () => {
    it("returns default models when no config", () => {
        const models = getSummaryModels();
        expect(models.length).toBeGreaterThanOrEqual(2);
        expect(models[0]).toHaveProperty("provider");
        expect(models[0]).toHaveProperty("id");
    });

    it("returns configured models", () => {
        const models = getSummaryModels({ models: { preferred: [{ provider: "test", id: "model-1" }] } });
        // This test works because when passed directly it uses the argument
        expect(models.length).toBe(1);
        expect(models[0]?.provider).toBe("test");
    });
});

describe("config - getSummarizerModel", () => {
    it("returns default model", () => {
        const model = getSummarizerModel();
        expect(typeof model).toBe("string");
        expect(model).toContain("/");
    });
});

describe("config - getVideoModel", () => {
    it("returns default model", () => {
        const model = getVideoModel();
        expect(typeof model).toBe("string");
    });
});

describe("config - getApiBaseUrl", () => {
    it("returns known URLs for all services", () => {
        expect(getApiBaseUrl("perplexity")).toContain("perplexity.ai");
        expect(getApiBaseUrl("exa")).toContain("exa.ai");
        expect(getApiBaseUrl("gemini")).toContain("googleapis.com");
        expect(getApiBaseUrl("gemini-web")).toContain("google.com");
        expect(getApiBaseUrl("gemini-web-upload")).toContain("googleapis.com");
        expect(getApiBaseUrl("gemini-api-upload")).toContain("googleapis.com");
    });
});
