import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Smoke Tests — memverifikasi bahwa semua komponen kritis berfungsi
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. Webclaw Binary ────────────────────────────────────────────────────────

async function findWebclawBinary(): Promise<string | null> {
    const candidates = ["webclaw", "/home/pwnholic/.local/bin/webclaw"];
    for (const bin of candidates) {
        try {
            const cp = await import("node:child_process");
            const result = cp.execFileSync(bin, ["--version"], {
                encoding: "utf-8" as const,
                timeout: 5000,
                stdio: ["pipe", "pipe", "pipe"],
            });
            if (result.trim().length > 0) return bin;
        } catch {}
    }
    return null;
}

describe("smoke: webclaw binary", () => {
    let webclawPath: string | null;

    beforeAll(async () => {
        webclawPath = await findWebclawBinary();
    });

    it("webclaw can extract from a URL", async () => {
        if (!webclawPath) return;
        const result = execFileSync(webclawPath, ["https://example.com", "-f", "llm"], {
            encoding: "utf-8" as const,
            timeout: 15000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(50);
        expect(result).toMatch(/Example|example|Domain/i);
    }, 20000);
});

// ── 2. Module Imports ─────────────────────────────────────────────────────────

describe("smoke: module imports", () => {
    it("config module loads", async () => {
        const config = await import("../config.js");
        expect(typeof config.loadConfig).toBe("function");
        expect(typeof config.saveConfig).toBe("function");
        expect(typeof config.getWebclawConfig).toBe("function");
    });

    it("types module loads", async () => {
        const types = await import("../types.js");
        expect(types).toBeDefined();
    });

    it("utils module loads", async () => {
        const utils = await import("../utils.js");
        expect(typeof utils.formatSeconds).toBe("function");
        expect(typeof utils.extractHeadingTitle).toBe("function");
        expect(typeof utils.mapFfmpegError).toBe("function");
    });

    it("storage module loads", async () => {
        const storage = await import("../storage/index.js");
        expect(typeof storage.storeResult).toBe("function");
        expect(typeof storage.getResult).toBe("function");
        expect(typeof storage.generateId).toBe("function");
    });

    it("activity monitor loads", async () => {
        const monitor = await import("../activity/monitor.js");
        expect(monitor.activityMonitor).toBeDefined();
        expect(typeof monitor.activityMonitor.logStart).toBe("function");
    });

    it("youtube extractor loads", async () => {
        const youtube = await import("../extractors/youtube.js");
        expect(typeof youtube.isYouTubeURL).toBe("function");
    });

    it("video extractor loads", async () => {
        const video = await import("../extractors/video.js");
        expect(typeof video.isVideoFile).toBe("function");
    });

    it("summary-review loads", async () => {
        const sr = await import("../summary-review.js");
        expect(typeof sr.buildSummaryPrompt).toBe("function");
        expect(typeof sr.buildDeterministicSummary).toBe("function");
    });

    it("providers all load", async () => {
        const registry = await import("../providers/registry.js");
        expect(typeof registry.resolveProvider).toBe("function");
    });
});

// ── 3. Storage CRUD ──────────────────────────────────────────────────────────

describe("smoke: storage operations", () => {
    it("full CRUD cycle works", async () => {
        const storage = await import("../storage/index.js");
        storage.clearResults();

        const id = storage.generateId();
        const data = {
            id,
            type: "fetch" as const,
            timestamp: Date.now(),
            urls: [{ url: "https://test.com", title: "Test", content: "test content", error: null }],
        };
        storage.storeResult(id, data);

        const retrieved = storage.getResult(id);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.urls?.[0]?.url).toBe("https://test.com");

        const all = storage.getAllResults();
        expect(all.length).toBeGreaterThanOrEqual(1);

        storage.clearResults();
        expect(storage.getAllResults().length).toBe(0);
    });
});

// ── 4. URL-based functionality ────────────────────────────────────────────────

describe("smoke: URL handling", () => {
    it("isYouTubeURL correctly identifies video IDs", async () => {
        const { isYouTubeURL } = await import("../extractors/youtube.js");
        expect(isYouTubeURL("https://youtu.be/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
        expect(isYouTubeURL("https://example.com").isYouTube).toBe(false);
    });
});

// ── 5. Summary generation ─────────────────────────────────────────────────────

describe("smoke: deterministic summary", () => {
    it("generates summary from query results", async () => {
        const { buildDeterministicSummary } = await import("../summary-review.js");
        const result = buildDeterministicSummary([
            {
                query: "test query",
                answer: "test answer",
                provider: "exa",
                results: [{ title: "Result 1", url: "https://example.com" }],
                error: null,
                timestamp: Date.now(),
            },
        ]);
        expect(result.summary).toContain("test query");
        expect(result.meta.fallbackUsed).toBe(true);
    });
});
