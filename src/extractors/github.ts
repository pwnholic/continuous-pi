/**
 * ──────────────────────────────────────────────
 *  GitHub Clone Extractor
 * ──────────────────────────────────────────────
 * Clones GitHub repositories locally and returns
 * real file contents with a local path for the
 * agent to explore further.
 *
 * GitHub URLs are cloned (not scraped), giving the
 * agent access to the actual file system.  Clones
 * are cached per session and wiped on session
 * change.
 *
 * Repos over the size threshold (default 350 MB)
 * get a lightweight API-based view instead.
 *
 * @module extractors/github
 */

import { execFileSync } from "node:child_process";
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
    rmSync,
    openSync,
    readSync,
    closeSync,
} from "node:fs";
import { join, relative, extname } from "node:path";

import type { IExtractedContent } from "../types/content.js";
import type { IConfigLoader } from "../config/index.js";
import { activityMonitor } from "../activity.js";
import { toErrorMessage, isAbortError } from "../utils.js";
import { checkRepoSize, showGhHint, fetchViaApi } from "./github-api.js";

// ── Constants ──────────────────────────────────

const BINARY_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".webp",
    ".bmp",
    ".tiff",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".flac",
    ".webm",
    ".avi",
    ".mov",
    ".mkv",
    ".zip",
    ".tar",
    ".gz",
    ".bz2",
    ".xz",
    ".rar",
    ".7z",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".deb",
    ".rpm",
    ".o",
    ".a",
    ".lib",
    ".obj",
    ".class",
    ".jar",
    ".war",
    ".pyc",
    ".pyo",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
    ".ico",
    ".icns",
]);

const NOISE_DIRS = new Set([
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    ".next",
    ".nuxt",
    "__pycache__",
    ".cache",
    ".yarn",
    ".pnp",
    ".tox",
    ".eggs",
    " eggs",
    "dist",
    "build",
    ".output",
    ".turbo",
]);

const MAX_INLINE_FILE_CHARS = 100_000;
const MAX_TREE_ENTRIES = 200;

// ── URL types ──────────────────────────────────

interface GitHubUrlInfo {
    readonly owner: string;
    readonly repo: string;
    readonly type: "root" | "tree" | "blob";
    readonly ref?: string;
    readonly path?: string;
    readonly refIsFullSha?: boolean;
}

interface CachedClone {
    dirPath: string;
    key: string;
    content: IExtractedContent | null;
    error: string | null;
}

// ── Clone cache ────────────────────────────────

const cloneCache = new Map<string, CachedClone>();

// ── URL parsing ────────────────────────────────

const NON_CODE_SEGMENTS = new Set([
    "issues",
    "pull",
    "pulls",
    "discussions",
    "wiki",
    "projects",
    "actions",
    "releases",
    "settings",
    "security",
    "insights",
    "notifications",
    "stars",
    "watchers",
]);

/**
 * Parse a GitHub URL into structured components.
 *
 * Supports:
 * - `https://github.com/owner/repo`           → root
 * - `https://github.com/owner/repo/tree/ref`  → tree
 * - `https://github.com/owner/repo/blob/ref/path` → blob
 * - `https://github.com/owner/repo/commit/sha` → blob (via API)
 */
export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();

        if (host !== "github.com" && !host.endsWith(".github.com")) {
            return null;
        }

        const segments = parsed.pathname.split("/").filter(Boolean);

        // Must have at least owner/repo
        if (segments.length < 2) {
            return null;
        }

        const owner = segments[0]!;
        const repo = segments[1]!.replace(/\.git$/i, "");

        if (segments.length === 2) {
            return { owner, repo, type: "root" };
        }

        const action = segments[2]!;

        // Non-code pages → fall through to normal web fetch
        if (NON_CODE_SEGMENTS.has(action)) {
            return null;
        }

        if (action === "tree" && segments.length >= 4) {
            const ref = segments[3]!;
            const path = segments.slice(4).join("/") || undefined;
            return { owner, repo, type: "tree", ref, path };
        }

        if (action === "blob" && segments.length >= 4) {
            const ref = segments[3]!;
            const path = segments.slice(4).join("/") || undefined;
            const refIsFullSha = /^[0-9a-f]{40}$/i.test(ref);
            return { owner, repo, type: "blob", ref, path, refIsFullSha };
        }

        if (action === "commit" && segments.length >= 4) {
            const sha = segments[3]!;
            return {
                owner,
                repo,
                type: "tree",
                ref: sha,
                refIsFullSha: /^[0-9a-f]{40}$/i.test(sha),
            };
        }

        if (action === "tree" && segments.length === 3) {
            return { owner, repo, type: "root" };
        }

        // Default: treat as tree
        return { owner, repo, type: "root" };
    } catch {
        return null;
    }
}

// ── Cache key ──────────────────────────────────

function cloneDir(owner: string, repo: string): string {
    return `/tmp/pi-github-repos/${owner}/${repo}`;
}
async function cloneRepo(
    owner: string,
    repo: string,
    config: { cloneTimeoutSeconds: number },
    _signal?: AbortSignal,
): Promise<string> {
    const localPath = cloneDir(owner, repo);

    if (existsSync(localPath) && existsSync(join(localPath, ".git"))) {
        return localPath;
    }

    const timeoutMs = config.cloneTimeoutSeconds * 1000;
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;

    showGhHint();

    const args: string[] = ["clone", "--depth", "1", cloneUrl, localPath];

    try {
        execFileSync("git", args, {
            timeout: timeoutMs,
            stdio: "pipe",
            killSignal: "SIGTERM",
        });
        return localPath;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Git clone failed: ${message}`);
    }
}

function isBinaryFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
        return true;
    }

    // Check first few bytes for null bytes (binary heuristic)
    try {
        const fd = openSync(filePath, "r");
        try {
            const buf = Buffer.alloc(8192);
            const bytesRead = readSync(fd, buf, 0, 8192, 0);
            for (let i = 0; i < bytesRead; i++) {
                if (buf[i] === 0) {
                    return true;
                }
            }
            return false;
        } finally {
            closeSync(fd);
        }
    } catch {
        return false;
    }
}

// ── File size formatting ───────────────────────

function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readTextFile(filePath: string): string | null {
    try {
        return readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }
}

// ── Tree building ──────────────────────────────

function buildTree(repoPath: string): string[] {
    const entries: string[] = [];

    function walk(dir: string, depth: number) {
        if (depth > 4) {
            return;
        } // limit depth

        let items: string[];
        try {
            items = readdirSync(dir);
        } catch {
            return;
        }

        for (const item of items) {
            const rel = relative(repoPath, join(dir, item));
            const safePath = join(dir, item);

            try {
                const stat = statSync(safePath);
                if (stat.isDirectory()) {
                    if (NOISE_DIRS.has(item)) {
                        continue;
                    }
                    entries.push(`📁 ${rel}/`);
                    walk(safePath, depth + 1);
                } else if (stat.isFile()) {
                    if (isBinaryFile(safePath)) {
                        continue;
                    }
                    const size = stat.size > 0 ? ` (${formatFileSize(stat.size)})` : "";
                    entries.push(`📄 ${rel}${size}`);
                }
            } catch {
                // permission denied, skip
            }

            if (entries.length >= MAX_TREE_ENTRIES) {
                break;
            }
        }
    }

    walk(repoPath, 0);
    return entries;
}

// ── Directory listing ──────────────────────────

function buildDirListing(repoPath: string, subPath: string): string[] {
    const targetPath = join(repoPath, subPath);
    const lines: string[] = [`## Directory: ${subPath || "/"}`, ""];

    let items: string[];
    try {
        items = readdirSync(targetPath);
    } catch {
        return [`Error: Could not read directory: ${subPath}`];
    }

    items.sort();
    for (const item of items) {
        const rel = join(subPath, item);
        const safePath = join(targetPath, item);

        try {
            const stat = statSync(safePath);
            if (stat.isDirectory() && !NOISE_DIRS.has(item)) {
                lines.push(`📁 ${rel}/`);
            } else if (stat.isFile() && !isBinaryFile(safePath)) {
                const size = stat.size > 0 ? ` (${formatFileSize(stat.size)})` : "";
                lines.push(`📄 ${rel}${size}`);
            }
        } catch {
            // skip
        }
    }

    return lines;
}

// ── README reading ─────────────────────────────

function readReadme(repoPath: string): string | null {
    const candidates = [
        "README.md",
        "README",
        "Readme.md",
        "readme.md",
        "README.txt",
        "README.rst",
    ];

    for (const candidate of candidates) {
        const readmePath = join(repoPath, candidate);
        if (existsSync(readmePath)) {
            return readTextFile(readmePath) ?? null;
        }
    }

    return null;
}

// ── Content generation ─────────────────────────

function generateContent(
    repoPath: string,
    info: GitHubUrlInfo,
    sizeNote?: string,
): { content: string; title: string } {
    const lines: string[] = [];

    if (sizeNote) {
        lines.push(sizeNote);
        lines.push("");
    }

    if (info.type === "root") {
        // Show tree + README
        const tree = buildTree(repoPath);
        if (tree.length > 0) {
            lines.push("## Repository Structure");
            lines.push("");
            lines.push(...tree);
            lines.push("");
        }

        const readme = readReadme(repoPath);
        if (readme) {
            lines.push("## README.md");
            lines.push("");
            lines.push(readme);
        }

        lines.push("");
        lines.push(`Clone path: \`${repoPath}\` — use \`read\` or \`bash\` to explore further.`);

        return {
            content: lines.join("\n"),
            title: `${info.owner}/${info.repo}`,
        };
    }

    if (info.type === "tree" && info.path) {
        const listing = buildDirListing(repoPath, info.path);
        lines.push(...listing);
        lines.push("");
        lines.push(
            `Clone path: \`${join(repoPath, info.path)}\` — use \`read\` or \`bash\` to explore further.`,
        );
        return {
            content: lines.join("\n"),
            title: `${info.owner}/${info.repo} - ${info.path}`,
        };
    }

    if (info.type === "blob" && info.path) {
        const fullPath = join(repoPath, info.path);
        if (!existsSync(fullPath)) {
            return {
                content: `Error: File not found at ${info.path}`,
                title: `${info.owner}/${info.repo} - ${info.path}`,
            };
        }

        const fileStat = statSync(fullPath);
        if (fileStat.size > MAX_INLINE_FILE_CHARS) {
            return {
                content: `File \`${info.path}\` is ${formatFileSize(fileStat.size)}. Use \`read\` to view it.`,
                title: `${info.owner}/${info.repo} - ${info.path}`,
            };
        }

        if (isBinaryFile(fullPath)) {
            return {
                content: `File \`${info.path}\` appears to be a binary file and cannot be displayed inline.`,
                title: `${info.owner}/${info.repo} - ${info.path}`,
            };
        }

        const content = readTextFile(fullPath);
        if (content === null) {
            return {
                content: `Error: Could not read file: ${info.path}`,
                title: `${info.owner}/${info.repo} - ${info.path}`,
            };
        }

        const ext = extname(info.path).toLowerCase();
        const lang = ext.slice(1) || "";
        lines.push(`## ${info.path}\n`);
        lines.push(`\`\`\`${lang}`);
        lines.push(content);
        lines.push("```");
        lines.push("");
        lines.push(`Full path: \`${fullPath}\` — use \`read\` or \`bash\` for more context.`);

        return {
            content: lines.join("\n"),
            title: `${info.owner}/${info.repo} - ${info.path}`,
        };
    }

    // Fallback: show tree
    const tree = buildTree(repoPath);
    if (tree.length > 0) {
        lines.push("## Repository Structure");
        lines.push(...tree);
    }
    lines.push("");
    lines.push(`Clone path: \`${repoPath}\` — use \`read\` or \`bash\` to explore further.`);
    return {
        content: lines.join("\n"),
        title: `${info.owner}/${info.repo}`,
    };
}

// ── Public API ─────────────────────────────────

/**
 * Extract content from a GitHub URL.
 *
 * Clones the repository (or uses the API for large repos / commit SHAs)
 * and returns file tree, README, and/or specific file contents.
 */
export async function extractGitHubContent(
    url: string,
    configLoader: IConfigLoader,
    signal?: AbortSignal,
    forceClone = false,
): Promise<IExtractedContent | null> {
    const info = parseGitHubUrl(url);
    if (!info) {
        return null;
    }

    const ghConfig = {
        enabled: configLoader.githubClone.enabled,
        maxRepoSizeMB: configLoader.githubClone.maxRepoSizeMB,
        cloneTimeoutSeconds: configLoader.githubClone.cloneTimeoutSeconds,
        clonePath: configLoader.githubClone.clonePath,
    };
    if (!ghConfig.enabled) {
        return null;
    }

    const { owner, repo } = info;

    // Commit SHA URLs → use API
    if (info.refIsFullSha) {
        showGhHint();
        const apiResult = await fetchViaApi(url, owner, repo, info);
        return apiResult;
    }

    const activityId = activityMonitor.logStart({
        type: "fetch",
        url: `github.com/${owner}/${repo}`,
    });

    try {
        // Check size first
        if (!forceClone && ghConfig.maxRepoSizeMB > 0) {
            try {
                const sizeKB = await checkRepoSize(owner, repo);
                if (sizeKB !== null) {
                    const sizeMB = sizeKB / 1024;
                    if (sizeMB > ghConfig.maxRepoSizeMB) {
                        const sizeNote = `⚠️  Repository is ${sizeMB.toFixed(0)} MB (limit: ${ghConfig.maxRepoSizeMB} MB). Showing API-based summary. Use \`forceClone: true\` to override.`;
                        const apiResult = await fetchViaApi(url, owner, repo, info, sizeNote);
                        if (apiResult) {
                            activityMonitor.logComplete(activityId, 200);
                            return apiResult;
                        }
                    }
                }
            } catch {
                // size check failed — proceed with clone
            }
        }

        // Clone and generate content
        const localPath = await cloneRepo(owner, repo, ghConfig, signal);
        const generated = generateContent(localPath, info);

        activityMonitor.logComplete(activityId, 200);

        return {
            url,
            title: generated.title,
            content: generated.content,
            error: null,
        };
    } catch (err) {
        if (isAbortError(err)) {
            activityMonitor.logComplete(activityId, 0);
            return null;
        }

        const message = toErrorMessage(err);
        activityMonitor.logError(activityId, message);

        // Try API fallback
        try {
            showGhHint();
            const apiResult = await fetchViaApi(url, owner, repo, info);
            if (apiResult) {
                activityMonitor.logComplete(activityId, 200);
                return apiResult;
            }
        } catch {
            // API fallback also failed
        }

        return {
            url,
            title: `${owner}/${repo}`,
            content: "",
            error: message,
        };
    }
}

/**
 * Clear all cached clones. Called on session shutdown / change.
 */
export function clearCloneCache(): void {
    for (const [, entry] of cloneCache) {
        if (entry.dirPath && existsSync(entry.dirPath)) {
            try {
                rmSync(entry.dirPath, { recursive: true, force: true });
            } catch {
                // best-effort
            }
        }
    }
    cloneCache.clear();
}
