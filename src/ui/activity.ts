/**
 * ──────────────────────────────────────────────
 *  UI — Activity Monitor Widget
 * ──────────────────────────────────────────────
 * TUI widget that displays live API / fetch activity
 * in a scrollable panel.  Invoked by the extension's
 * keyboard shortcut (default Ctrl+Shift+W).
 *
 * @module ui/activity
 */

import type { IActivityEntry, IRateLimitInfo } from "../types/activity.js";

// ── Display constants ──────────────────────────

const MAX_VISIBLE_ENTRIES = 10;

// ── Helpers ────────────────────────────────────

function formatDuration(ms: number | undefined): string {
    if (ms === undefined) {
        return "…";
    }
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
}

function extractTarget(entry: IActivityEntry): string {
    if (entry.query) {
        return entry.query.length > 50 ? `${entry.query.slice(0, 47)}...` : entry.query;
    }
    if (entry.url) {
        try {
            const u = new URL(entry.url);
            return u.hostname + u.pathname.slice(0, 40);
        } catch {
            return entry.url.length > 50 ? `${entry.url.slice(0, 47)}...` : entry.url;
        }
    }
    return "(unknown)";
}

// ── Entry formatting ───────────────────────────

export function formatEntryLine(entry: IActivityEntry): {
    typeLabel: string;
    target: string;
    statusBadge: string;
    duration: string;
} {
    const typeLabel = entry.type === "api" ? "API" : "GET";
    const target = extractTarget(entry);
    const duration = formatDuration(entry.endTime ? entry.endTime - entry.startTime : undefined);

    let statusBadge: string;
    if (entry.error) {
        statusBadge = `✗ ${entry.error.slice(0, 20)}`;
    } else if (entry.status !== null) {
        statusBadge = entry.status < 400 ? `✓ ${entry.status}` : `✗ ${entry.status}`;
    } else {
        statusBadge = "⋯ pending";
    }

    return { typeLabel, target, statusBadge, duration };
}

// ── Full panel rendering ───────────────────────

export interface ActivityPanelOptions {
    entries: readonly IActivityEntry[];
    rateLimitInfo?: IRateLimitInfo;
    theme: {
        bold: (s: string) => string;
        fg: (color: string, s: string) => string;
        dim: (s: string) => string;
    };
}

/**
 * Build a plain-text representation of the activity panel
 * suitable for display in a TUI widget.
 *
 * Returns an array of strings (one per line) that the
 * caller can join and render.
 */
export function renderActivityPanel(options: ActivityPanelOptions): string[] {
    const { entries, rateLimitInfo, theme } = options;
    const lines: string[] = [];

    // ── Header ──────────────────────────────────
    lines.push(theme.fg("accent", theme.bold("─── Web Search Activity ───")));
    lines.push("");

    // ── Rate-limit info ─────────────────────────
    if (rateLimitInfo && rateLimitInfo.max > 0) {
        const used = rateLimitInfo.used;
        const max = rateLimitInfo.max;
        const ratio = used / max;
        let bar = "[";
        const barWidth = 10;
        const filled = Math.round(ratio * barWidth);
        for (let i = 0; i < barWidth; i++) {
            bar += i < filled ? "■" : "·";
        }
        bar += "]";

        const color = ratio > 0.8 ? "error" : ratio > 0.5 ? "warning" : "muted";
        lines.push(`${theme.fg(color, `Rate limit: ${used}/${max} ${bar}`)}`);
        lines.push("");
    }

    // ── Entries ─────────────────────────────────
    const visible = entries.slice(-MAX_VISIBLE_ENTRIES);

    if (visible.length === 0) {
        lines.push(theme.fg("muted", "  No recent activity."));
    } else {
        for (const entry of visible) {
            const { typeLabel, target, statusBadge, duration } = formatEntryLine(entry);

            const color = entry.error
                ? "error"
                : entry.status !== null && entry.status >= 400
                  ? "error"
                  : entry.status !== null
                    ? "success"
                    : "muted";

            // Right-align duration
            const paddedDuration = duration.padStart(8);
            const line = `${theme.fg("accent", typeLabel.padEnd(5))} ${theme.fg(color, target.padEnd(48))} ${theme.fg(color, statusBadge.padEnd(15))} ${theme.fg("dim", paddedDuration)}`;
            lines.push(`  ${line}`);
        }
    }

    // ── Footer ──────────────────────────────────
    lines.push("");
    lines.push(theme.fg("dim", "─── Ctrl+Shift+W to toggle ───"));

    return lines;
}

// ── Simple text-only rendering (no theme) ──────

export function renderActivityText(
    entries: readonly IActivityEntry[],
    rateLimitInfo?: IRateLimitInfo,
): string {
    const lines: string[] = [];
    lines.push("─── Web Search Activity ───");
    lines.push("");

    if (rateLimitInfo && rateLimitInfo.max > 0) {
        lines.push(`Rate limit: ${rateLimitInfo.used}/${rateLimitInfo.max}`);
        lines.push("");
    }

    const visible = entries.slice(-MAX_VISIBLE_ENTRIES);
    if (visible.length === 0) {
        lines.push("  No recent activity.");
    } else {
        for (const entry of visible) {
            const { typeLabel, target, statusBadge, duration } = formatEntryLine(entry);
            lines.push(
                `  ${typeLabel.padEnd(5)} ${target.padEnd(48)} ${statusBadge.padEnd(15)} ${duration.padStart(8)}`,
            );
        }
    }

    return lines.join("\n");
}
