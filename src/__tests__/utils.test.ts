import { describe, expect, it } from "vitest";
import {
    extractHeadingTitle,
    extractTitleFromUrl,
    formatSeconds,
    isTimeoutError,
    mapFfmpegError,
    readExecError,
    trimErrorText,
} from "../utils.js";

describe("formatSeconds", () => {
    it("formats seconds only", () => {
        expect(formatSeconds(0)).toBe("0:00");
        expect(formatSeconds(30)).toBe("0:30");
        expect(formatSeconds(59)).toBe("0:59");
    });

    it("formats minutes and seconds", () => {
        expect(formatSeconds(60)).toBe("1:00");
        expect(formatSeconds(90)).toBe("1:30");
        expect(formatSeconds(3600)).toBe("1:00:00");
    });

    it("formats hours, minutes, seconds", () => {
        expect(formatSeconds(3661)).toBe("1:01:01");
        expect(formatSeconds(7322)).toBe("2:02:02");
    });
});

describe("readExecError", () => {
    it("handles null/undefined", () => {
        expect(readExecError(null)).toEqual({ code: undefined, stderr: "", message: "null" });
        expect(readExecError(undefined)).toEqual({ code: undefined, stderr: "", message: "undefined" });
    });

    it("extracts error properties", () => {
        const err = { code: "ENOENT", message: "not found", stderr: Buffer.from("error details") };
        const result = readExecError(err);
        expect(result.code).toBe("ENOENT");
        expect(result.message).toBe("not found");
        expect(result.stderr).toBe("error details");
    });

    it("handles non-object errors", () => {
        expect(readExecError("string error")).toEqual({
            code: undefined,
            stderr: "",
            message: "string error",
        });
    });
});

describe("isTimeoutError", () => {
    it("detects AbortError", () => {
        expect(isTimeoutError({ name: "AbortError" })).toBe(true);
    });

    it("detects ETIMEDOUT", () => {
        expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
    });

    it("detects killed processes", () => {
        expect(isTimeoutError({ killed: true })).toBe(true);
    });

    it("detects timeout messages", () => {
        expect(isTimeoutError(new Error("Operation timed out"))).toBe(true);
        expect(isTimeoutError(new Error("timeout after 30s"))).toBe(true);
    });

    it("returns false for normal errors", () => {
        expect(isTimeoutError({ code: "EACCES" })).toBe(false);
        expect(isTimeoutError(null)).toBe(false);
    });
});

describe("trimErrorText", () => {
    it("trims and limits to 200 chars", () => {
        const long = "a".repeat(300);
        expect(trimErrorText(long).length).toBe(200);
    });

    it("normalizes whitespace", () => {
        expect(trimErrorText("  hello   world ")).toBe("hello world");
    });
});

describe("mapFfmpegError", () => {
    it("detects missing ffmpeg", () => {
        expect(mapFfmpegError({ code: "ENOENT" })).toContain("ffmpeg is not installed");
    });

    it("detects timeouts", () => {
        expect(mapFfmpegError({ killed: true })).toContain("timed out");
    });

    it("detects 403", () => {
        expect(mapFfmpegError({ stderr: "HTTP error 403" })).toContain("403");
    });

    it("handles unknown errors", () => {
        expect(mapFfmpegError({})).toContain("ffmpeg failed");
    });
});

describe("extractHeadingTitle", () => {
    it("extracts H1", () => {
        expect(extractHeadingTitle("# Hello World")).toBe("Hello World");
        expect(extractHeadingTitle("# Hello **World**")).toBe("Hello World");
    });

    it("extracts H2", () => {
        expect(extractHeadingTitle("## Subtitle")).toBe("Subtitle");
    });

    it("returns null for no heading", () => {
        expect(extractHeadingTitle("Plain text")).toBeNull();
        expect(extractHeadingTitle("")).toBeNull();
    });
});

describe("extractTitleFromUrl", () => {
    it("extracts from path", () => {
        expect(extractTitleFromUrl("https://example.com/my-page")).toBe("my-page");
    });

    it("falls back to hostname when path is empty", () => {
        expect(extractTitleFromUrl("https://example.com")).toBe("example.com");
    });

    it("handles invalid urls", () => {
        expect(extractTitleFromUrl("not-a-url")).toBe("not-a-url");
    });
});
