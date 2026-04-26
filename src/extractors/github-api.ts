/**
 * ──────────────────────────────────────────────
 *  GitHub API Extractor
 * ──────────────────────────────────────────────
 * Fetches repository metadata, file trees, and
 * file contents via the GitHub API (`gh` CLI).
 *
 * Used as a fallback when a repository is too large
 * to clone (default threshold: 350 MB) or when the
 * URL points to a specific commit SHA.
 *
 * @module extractors/github-api
 */

import { execFile } from "node:child_process";
import type { IExtractedContent } from "../types/content.js";

const MAX_TREE_ENTRIES = 200;
const MAX_INLINE_FILE_CHARS = 100_000;

/**
 * Shape returned by `parseGitHubUrl` (shared with the clone
 * extractor but duplicated here to avoid a circular import).
 */
interface GitHubUrlInfo {
    readonly owner: string;
    readonly repo: string;
    readonly type: "root" | "tree" | "blob";
    readonly ref?: string;
    readonly path?: string;
    readonly refIsFullSha?: boolean;
}

// CLI state

let ghAvailable: boolean | null = null;
let ghHintShown = false;

// Helpers

/**
 * Check whether the `gh` CLI is installed and usable.
 */
export async function checkGhAvailable(): Promise<boolean> {
    if (ghAvailable !== null) {
        return ghAvailable;
    }

    return new Promise((resolve) => {
        execFile("gh", ["--version"], { timeout: 5000 }, (err) => {
            ghAvailable = !err;
            resolve(ghAvailable);
        });
    });
}

/**
 * Show a one-time hint suggesting the user install `gh`.
 */
export function showGhHint(): void {
    if (!ghHintShown) {
        ghHintShown = true;
        console.error(
            "[pi-web-access] Install `gh` CLI for better GitHub repo access including private repos.",
        );
    }
}

/**
 * Check the size of a GitHub repository via the API.
 *
 * @returns The size in KB, or `null` if unavailable.
 */
export async function checkRepoSize(owner: string, repo: string): Promise<number | null> {
    if (!(await checkGhAvailable())) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(
            "gh",
            ["api", `repos/${owner}/${repo}`, "--jq", ".size"],
            { timeout: 10_000 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                const kb = parseInt(stdout.trim(), 10);
                resolve(Number.isNaN(kb) ? null : kb);
            },
        );
    });
}

/**
 * Get the default branch name for a repository.
 */
async function getDefaultBranch(owner: string, repo: string): Promise<string | null> {
    if (!(await checkGhAvailable())) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(
            "gh",
            ["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"],
            { timeout: 10_000 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                resolve(stdout.trim() || null);
            },
        );
    });
}

/**
 * Fetch the recursive file tree for a given ref.
 */
async function fetchTreeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
    if (!(await checkGhAvailable())) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(
            "gh",
            ["api", `repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "--jq", ".tree[].path"],
            { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                const paths = stdout.trim().split("\n").filter(Boolean);
                if (paths.length === 0) {
                    resolve(null);
                    return;
                }
                const truncated = paths.length > MAX_TREE_ENTRIES;
                const display = paths.slice(0, MAX_TREE_ENTRIES).join("\n");
                resolve(truncated ? `${display}\n... (${paths.length} total entries)` : display);
            },
        );
    });
}

/**
 * Fetch the repository README via the API.
 */
async function fetchReadmeViaApi(owner: string, repo: string, ref: string): Promise<string | null> {
    if (!(await checkGhAvailable())) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(
            "gh",
            ["api", `repos/${owner}/${repo}/readme?ref=${ref}`, "--jq", ".content"],
            { timeout: 10_000 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                try {
                    const decoded = Buffer.from(stdout.trim(), "base64").toString("utf-8");
                    resolve(
                        decoded.length > 8192
                            ? `${decoded.slice(0, 8192)}\n\n[README truncated at 8K chars]`
                            : decoded,
                    );
                } catch {
                    resolve(null);
                }
            },
        );
    });
}

/**
 * Fetch a single file from a repository via the API.
 */
async function fetchFileViaApi(
    owner: string,
    repo: string,
    path: string,
    ref: string,
): Promise<string | null> {
    if (!(await checkGhAvailable())) {
        return null;
    }

    return new Promise((resolve) => {
        execFile(
            "gh",
            ["api", `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"],
            { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                try {
                    resolve(Buffer.from(stdout.trim(), "base64").toString("utf-8"));
                } catch {
                    resolve(null);
                }
            },
        );
    });
}

// ── Public API ─────────────────────────────────

/**
 * Fetch repository content via the GitHub API as a fallback
 * when cloning is not possible (repo too large, commit SHA URL).
 *
 * @param url      - The original GitHub URL.
 * @param owner    - Repository owner.
 * @param repo     - Repository name.
 * @param info     - Parsed URL info (type, ref, path).
 * @param sizeNote - Optional size warning to prepend.
 * @returns Extracted content with title and markdown body, or `null`.
 */
export async function fetchViaApi(
    url: string,
    owner: string,
    repo: string,
    info: GitHubUrlInfo,
    sizeNote?: string,
): Promise<IExtractedContent | null> {
    const ref = info.ref || (await getDefaultBranch(owner, repo));
    if (!ref) {
        return null;
    }

    const lines: string[] = [];
    if (sizeNote) {
        lines.push(sizeNote);
        lines.push("");
    }

    // ── Single file (blob) ────────────────────────
    if (info.type === "blob" && info.path) {
        const content = await fetchFileViaApi(owner, repo, info.path, ref);
        if (!content) {
            return null;
        }

        lines.push(`## ${info.path}`);
        if (content.length > MAX_INLINE_FILE_CHARS) {
            lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
            lines.push("\n[File truncated at 100K chars]");
        } else {
            lines.push(content);
        }

        return {
            url,
            title: `${owner}/${repo} - ${info.path}`,
            content: lines.join("\n"),
            error: null,
        };
    }

    // ── Tree / root view ──────────────────────────
    const [tree, readme] = await Promise.all([
        fetchTreeViaApi(owner, repo, ref),
        fetchReadmeViaApi(owner, repo, ref),
    ]);

    if (!tree && !readme) {
        return null;
    }

    if (tree) {
        lines.push("## Structure");
        lines.push(tree);
        lines.push("");
    }

    if (readme) {
        lines.push("## README.md");
        lines.push(readme);
        lines.push("");
    }

    lines.push(
        "This is an API-only view. Clone the repo or use `read`/`bash` for deeper exploration.",
    );

    const title = info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`;

    return {
        url,
        title,
        content: lines.join("\n"),
        error: null,
    };
}
