import { type ExecFileException, execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getWebclawConfig } from "../config.js";
import type { ExtractedContent, WebclawBrowser, WebclawFormat, WebclawOptions, WebclawResult } from "../types.js";

// ─── Binary Detection ─────────────────────────────────────────────────────────

let _webclawPath: string | null | undefined = undefined;

/**
 * Find the webclaw binary.
 * Checks (in order):
 *   1. Config path (webclaw.path)
 *   2. PATH via `which webclaw`
 *   3. Common install locations
 */
export function findWebclawBinary(): string | null {
    if (_webclawPath !== undefined) return _webclawPath;

    // 1. Config path
    const cfg = getWebclawConfig();
    if (cfg.path) {
        if (existsSync(cfg.path)) {
            _webclawPath = cfg.path;
            return _webclawPath;
        }
        console.warn(`[pi-web-access] webclaw path configured but not found: ${cfg.path}`);
    }

    // 2. PATH lookup
    try {
        const result = execFileSync("which", ["webclaw"], {
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const path = result.trim();
        if (path && existsSync(path)) {
            _webclawPath = path;
            return _webclawPath;
        }
    } catch {
        // not in PATH
    }

    // 3. Common locations
    const commonPaths = [
        "/usr/local/bin/webclaw",
        "/home/linuxbrew/.linuxbrew/bin/webclaw",
        `${process.env.HOME}/.local/bin/webclaw`,
        `${process.env.HOME}/.webclaw/webclaw`,
    ];
    for (const p of commonPaths) {
        if (existsSync(p)) {
            _webclawPath = p;
            return _webclawPath;
        }
    }

    _webclawPath = null;
    return null;
}

/** Check if webclaw is installed and available */
export function isWebclawAvailable(): boolean {
    return findWebclawBinary() !== null;
}

/** Get webclaw version string */
export function getWebclawVersion(): string | null {
    const binary = findWebclawBinary();
    if (!binary) return null;

    try {
        const result = execFileSync(binary, ["--version"], {
            encoding: "utf-8",
            timeout: 5000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return result.trim();
    } catch {
        return null;
    }
}

// ─── Core Extraction ──────────────────────────────────────────────────────────

function buildArgs(url: string, options?: WebclawOptions): string[] {
    const args: string[] = [];
    const format = options?.format ?? "llm";
    const cfg = getWebclawConfig();

    args.push("-f", format);

    // Browser fingerprint
    const browser = options?.browser ?? cfg.browser ?? "chrome";
    if (browser) args.push("-b", browser);

    // Proxy
    const proxy = options?.proxy ?? cfg.proxy;
    if (proxy) args.push("-p", proxy);

    // Timeout
    if (options?.timeout) args.push("-t", String(options.timeout));

    // CSS selectors
    if (options?.include) args.push("--include", options.include);
    if (options?.exclude) args.push("--exclude", options.exclude);
    if (options?.onlyMainContent) args.push("--only-main-content");

    // Metadata
    if (options?.metadata || format === "json") args.push("--metadata");

    // PDF mode: auto-detect .pdf URLs
    if (url.match(/\.pdf(\?|#|$)/i)) {
        args.push("--pdf-mode", "fast");
    }

    args.push(url);
    return args;
}

function parseResult(url: string, stdout: string, format: WebclawFormat): WebclawResult {
    if (format === "json") {
        try {
            const data = JSON.parse(stdout) as {
                title?: string;
                content?: string;
                metadata?: { language?: string; wordCount?: number };
            };
            return {
                url,
                title: data.title ?? extractTitle(data.content ?? "", url),
                content: data.content ?? stdout,
                metadata: data.metadata,
            };
        } catch {
            // Fall through to text parsing
        }
    }

    // For markdown/llm/text format, parse title from first heading
    return {
        url,
        title: extractTitle(stdout, url),
        content: stdout,
    };
}

/**
 * Extract content from a URL using webclaw CLI.
 * Returns null if webclaw is not installed or fails.
 */
export async function extractWithWebclaw(url: string, options?: WebclawOptions): Promise<ExtractedContent | null> {
    const binary = findWebclawBinary();
    if (!binary) return null;

    if (options?.signal?.aborted) {
        return { url, title: "", content: "", error: "Aborted" };
    }

    const format = options?.format ?? "llm";
    const args = buildArgs(url, options);

    try {
        const { stdout, stderr } = await new Promise<{
            stdout: string;
            stderr: string;
        }>((resolve, reject) => {
            const child = execFile(
                binary,
                args,
                {
                    timeout: (options?.timeout ?? 30) * 1000,
                    maxBuffer: 10 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err: ExecFileException | null, stdout: string, stderr: string) => {
                    if (err) {
                        // webclaw returns exit code 1 for some HTTP errors but still produces output
                        if (stdout && stdout.length > 50) {
                            resolve({ stdout, stderr });
                            return;
                        }
                        reject(err);
                        return;
                    }
                    resolve({ stdout, stderr });
                },
            );

            if (options?.signal) {
                const onAbort = () => {
                    child.kill();
                };
                options.signal.addEventListener("abort", onAbort, { once: true });
                child.on("exit", () => options.signal?.removeEventListener("abort", onAbort));
            }
        });

        if (!stdout || stdout.trim().length === 0) {
            const errorMsg = stderr?.trim() || "webclaw returned empty output";
            return { url, title: "", content: "", error: errorMsg };
        }

        const result = parseResult(url, stdout, format);

        // Check for error indicators from stderr
        const hasError = stderr?.toLowerCase().includes("error") ?? false;

        return {
            url: result.url,
            title: result.title,
            content: result.content,
            error: hasError ? stderr?.trim() || null : null,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("abort") || message === "Aborted") {
            return { url, title: "", content: "", error: "Aborted" };
        }
        // Don't return error for "not found" — let caller fallback
        if (message.includes("ENOENT")) return null;
        return { url, title: "", content: "", error: message };
    }
}

/**
 * Extract content synchronously using webclaw (for simple cases).
 */
export function extractWithWebclawSync(url: string, options?: WebclawOptions): ExtractedContent | null {
    const binary = findWebclawBinary();
    if (!binary) return null;

    const args = buildArgs(url, options);

    try {
        const stdout = execFileSync(binary, args, {
            timeout: (options?.timeout ?? 30) * 1000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });

        if (!stdout || stdout.trim().length === 0) return null;

        const result = parseResult(url, stdout, options?.format ?? "llm");
        return {
            url: result.url,
            title: result.title,
            content: result.content,
            error: null,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT")) return null;
        return { url, title: "", content: "", error: message };
    }
}

// ─── Batch Extraction ─────────────────────────────────────────────────────────

/**
 * Extract multiple URLs using webclaw batch mode.
 * Falls back to individual calls if batch mode unavailable.
 */
export async function batchExtract(urls: string[], options?: WebclawOptions): Promise<ExtractedContent[]> {
    if (urls.length === 0) return [];
    if (options?.signal?.aborted)
        return urls.map((url) => ({
            url,
            title: "",
            content: "",
            error: "Aborted",
        }));

    const binary = findWebclawBinary();
    if (!binary) return [];

    // webclaw supports multiple URLs directly
    const firstUrl = urls[0];
    if (!firstUrl) return [];
    const args = buildArgs(firstUrl, options);
    // Remove the single url, add all urls
    args.pop();
    for (const url of urls) {
        args.push(url);
    }

    try {
        if (options?.format === "json") {
            // For JSON output, we can parse structured results
            const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
                execFile(
                    binary,
                    args,
                    {
                        timeout: (options?.timeout ?? 60) * 1000,
                        maxBuffer: 50 * 1024 * 1024,
                        encoding: "utf-8" as const,
                    },
                    (err, stdout) => {
                        if (err && (!stdout || stdout.length === 0)) {
                            reject(err);
                            return;
                        }
                        resolve({ stdout: stdout ?? "" });
                    },
                );
            });

            if (!stdout.trim()) {
                return urls.map((url) => ({
                    url,
                    title: "",
                    content: "",
                    error: "Empty response",
                }));
            }

            const lines = stdout.trim().split("\n");
            return lines.map((line, i) => {
                try {
                    const data = JSON.parse(line) as { title?: string; content?: string };
                    return {
                        url: urls[i] ?? `unknown:${i}`,
                        title: data.title ?? "",
                        content: data.content ?? "",
                        error: null,
                    };
                } catch {
                    return {
                        url: urls[i] ?? `unknown:${i}`,
                        title: "",
                        content: line,
                        error: null,
                    };
                }
            });
        }

        // Non-JSON: treat entire output as one block per URL
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            execFile(
                binary,
                args,
                {
                    timeout: (options?.timeout ?? 60) * 1000,
                    maxBuffer: 50 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err, stdout) => {
                    if (err && (!stdout || stdout.length === 0)) {
                        reject(err);
                        return;
                    }
                    resolve({ stdout: stdout ?? "" });
                },
            );
        });

        // Split output by URL markers if available
        const blocks = stdout.split(/(?=^# )|(?=^URL: )/m).filter(Boolean);
        return urls.map((url, i) => ({
            url,
            title: "",
            content: blocks[i] ?? stdout,
            error: null,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT")) return [];

        // Fall back to individual calls
        const fallbackResults = await Promise.all(urls.map((url) => extractWithWebclaw(url, options)));
        return fallbackResults.filter((r): r is ExtractedContent => r !== null);
    }
}

// ─── Vertical Extractors ──────────────────────────────────────────────────────

/**
 * Extract structured data from a supported site using webclaw's vertical extractors.
 * Returns typed JSON for the specific site (e.g. GitHub repo info, YouTube metadata).
 */
export async function extractVertical(
    extractorName: string,
    url: string,
    signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
    const binary = findWebclawBinary();
    if (!binary) return null;

    try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            const child = execFile(
                binary,
                ["vertical", extractorName, url, "-f", "json"],
                {
                    timeout: 15000,
                    maxBuffer: 5 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err, stdout) => {
                    if (err && (!stdout || stdout.length === 0)) {
                        reject(err);
                        return;
                    }
                    resolve({ stdout: stdout ?? "" });
                },
            );

            if (signal) {
                const onAbort = () => child.kill();
                signal.addEventListener("abort", onAbort, { once: true });
                child.on("exit", () => signal.removeEventListener("abort", onAbort));
            }
        });

        return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
        return null;
    }
}

// ─── Brand Extraction ─────────────────────────────────────────────────────────

/**
 * Extract brand identity from a URL (colors, fonts, logos).
 */
export async function extractBrand(url: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const binary = findWebclawBinary();
    if (!binary) return null;

    try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            const child = execFile(
                binary,
                [url, "--brand", "-f", "json"],
                {
                    timeout: 15000,
                    maxBuffer: 5 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err, stdout) => {
                    if (err && (!stdout || stdout.length === 0)) {
                        reject(err);
                        return;
                    }
                    resolve({ stdout: stdout ?? "" });
                },
            );

            if (signal) {
                const onAbort = () => child.kill();
                signal.addEventListener("abort", onAbort, { once: true });
                child.on("exit", () => signal.removeEventListener("abort", onAbort));
            }
        });

        return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
        return null;
    }
}

// ─── Crawl ────────────────────────────────────────────────────────────────────

export interface CrawlOptions extends WebclawOptions {
    depth?: number;
    maxPages?: number;
    concurrency?: number;
    delay?: number;
    pathPrefix?: string;
    sitemap?: boolean;
    includePaths?: string;
    excludePaths?: string;
    outputDir?: string;
}

/**
 * Crawl a website recursively using webclaw.
 * Returns array of extracted content per page.
 */
export async function crawlSite(url: string, options?: CrawlOptions): Promise<ExtractedContent[]> {
    const binary = findWebclawBinary();
    if (!binary) return [];

    const args = buildArgs(url, options);
    args.push("--crawl");

    if (options?.depth) args.push("--depth", String(options.depth));
    if (options?.maxPages) args.push("--max-pages", String(options.maxPages));
    if (options?.concurrency) args.push("--concurrency", String(options.concurrency));
    if (options?.delay) args.push("--delay", String(options.delay));
    if (options?.pathPrefix) args.push("--path-prefix", options.pathPrefix);
    if (options?.sitemap) args.push("--sitemap");
    if (options?.includePaths) args.push("--include-paths", options.includePaths);
    if (options?.excludePaths) args.push("--exclude-paths", options.excludePaths);
    if (options?.outputDir) args.push("--output-dir", options.outputDir);

    try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            execFile(
                binary,
                args,
                {
                    timeout: (options?.timeout ?? 120) * 1000,
                    maxBuffer: 50 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err, stdout) => {
                    if (err && (!stdout || stdout.length === 0)) {
                        reject(err);
                        return;
                    }
                    resolve({ stdout: stdout ?? "" });
                },
            );
        });

        if (!stdout.trim()) return [];

        // Split by page markers
        const pages = stdout.split(/(?=^# Page \d+:)/m).filter(Boolean);
        return pages.map((page) => ({
            url,
            title: "",
            content: page.trim(),
            error: null,
        }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("ENOENT")) return [];
        return [{ url, title: "", content: "", error: message }];
    }
}

// ─── Sitemap Discovery ────────────────────────────────────────────────────────

/**
 * Discover URLs from a site's sitemap.
 */
export async function mapSite(url: string, signal?: AbortSignal): Promise<string[]> {
    const binary = findWebclawBinary();
    if (!binary) return [];

    try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
            const child = execFile(
                binary,
                [url, "--map"],
                {
                    timeout: 30000,
                    maxBuffer: 5 * 1024 * 1024,
                    encoding: "utf-8" as const,
                },
                (err, stdout) => {
                    if (err && (!stdout || stdout.length === 0)) {
                        reject(err);
                        return;
                    }
                    resolve({ stdout: stdout ?? "" });
                },
            );

            if (signal) {
                const onAbort = () => child.kill();
                signal.addEventListener("abort", onAbort, { once: true });
                child.on("exit", () => signal.removeEventListener("abort", onAbort));
            }
        });

        return stdout
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && (l.startsWith("http://") || l.startsWith("https://")));
    } catch {
        return [];
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractTitle(content: string, url: string): string {
    // Try markdown H1
    const h1Match = content.match(/^#\s+(.+)/m);
    if (h1Match?.[1]) return h1Match[1].trim();

    // Try HTML title
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1]) return titleMatch[1].trim();

    // Fall back to URL
    try {
        const parsed = new URL(url);
        const pathSegments = parsed.pathname.split("/").filter(Boolean);
        return pathSegments.pop()?.replace(/[-_]/g, " ") || parsed.hostname;
    } catch {
        return url;
    }
}
