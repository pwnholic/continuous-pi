/**
 * ──────────────────────────────────────────────
 *  PDF Content Extractor
 * ──────────────────────────────────────────────
 * Extracts text from PDF documents and saves the
 * result as a Markdown file in the user's Downloads
 * directory.
 *
 * Text-based extraction only — scanned documents
 * (images) are not supported.
 *
 * @module extractors/pdf
 */

import { getDocumentProxy } from "unpdf";
import { writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// ── Exported types ─────────────────────────────

export interface IPDFExtractResult {
    readonly title: string;
    readonly pages: number;
    readonly chars: number;
    readonly outputPath: string;
}

export interface IPDFExtractOptions {
    readonly maxPages?: number;
    readonly outputDir?: string;
    readonly filename?: string;
}

// ── Defaults ───────────────────────────────────

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_OUTPUT_DIR = join(homedir(), "Downloads");

// ── Public API ─────────────────────────────────

/**
 * Extract text from a PDF buffer and save the result as a Markdown
 * file in the configured output directory.
 *
 * @param buffer  - Raw PDF bytes as an `ArrayBuffer`.
 * @param url     - The source URL (used for metadata and fallback naming).
 * @param options - Optional settings (page limit, custom output dir, filename).
 * @returns Metadata about the extracted document.
 */
export async function extractPDFToMarkdown(
    buffer: ArrayBuffer,
    url: string,
    options: IPDFExtractOptions = {},
): Promise<IPDFExtractResult> {
    const { maxPages = DEFAULT_MAX_PAGES, outputDir = DEFAULT_OUTPUT_DIR, filename } = options;

    const safeMaxPages = Number.isFinite(maxPages)
        ? Math.max(1, Math.floor(maxPages))
        : DEFAULT_MAX_PAGES;

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const metadata = await pdf.getMetadata();
    const metadataInfo =
        metadata.info && typeof metadata.info === "object"
            ? (metadata.info as Record<string, unknown>)
            : null;

    // ── Extract title from metadata or URL ─────
    const metaTitle = typeof metadataInfo?.Title === "string" ? metadataInfo.Title : undefined;
    const metaAuthor = typeof metadataInfo?.Author === "string" ? metadataInfo.Author : undefined;
    const urlTitle = extractTitleFromURL(url);
    const title = metaTitle?.trim() || urlTitle;

    // ── Determine page range ────────────────────
    const pagesToExtract = Math.min(pdf.numPages, safeMaxPages);
    const truncated = pdf.numPages > safeMaxPages;

    // ── Extract text page by page ───────────────
    const pages: Array<{ pageNum: number; text: string }> = [];
    for (let i = 1; i <= pagesToExtract; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = (textContent.items as Array<{ str?: string }>)
            .map((item) => item.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        if (pageText) {
            pages.push({ pageNum: i, text: pageText });
        }
    }

    // ── Build Markdown content ──────────────────
    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`> Source: ${url}`);
    lines.push(
        `> Pages: ${pdf.numPages}${truncated ? ` (extracted first ${pagesToExtract})` : ""}`,
    );
    if (metaAuthor) {
        lines.push(`> Author: ${metaAuthor}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    for (let i = 0; i < pages.length; i++) {
        if (i > 0) {
            lines.push("");
            lines.push(`<!-- Page ${pages[i].pageNum} -->`);
            lines.push("");
        }
        lines.push(pages[i].text);
    }

    if (truncated) {
        lines.push("");
        lines.push("---");
        lines.push("");
        lines.push(
            `*[Truncated: Only first ${pagesToExtract} of ${pdf.numPages} pages extracted]*`,
        );
    }

    const content = lines.join("\n");

    // ── Output path ─────────────────────────────
    const outputFilename = filename ?? `${sanitizeFilename(title)}.md`;
    const outputPath = join(outputDir, outputFilename);

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, content, "utf-8");

    return {
        title,
        pages: pdf.numPages,
        chars: content.length,
        outputPath,
    };
}

// ── Helpers ────────────────────────────────────

/**
 * Extract a descriptive title from a PDF URL.
 */
function extractTitleFromURL(url: string): string {
    try {
        const urlObj = new URL(url);
        let filename = basename(urlObj.pathname, ".pdf");

        // Handle arxiv URLs: /pdf/1706.03762 → "arxiv-1706.03762"
        if (urlObj.hostname.includes("arxiv.org")) {
            const match = urlObj.pathname.match(/\/(?:pdf|abs)\/(\d+\.\d+)/);
            if (match) {
                filename = `arxiv-${match[1]}`;
            }
        }

        filename = filename.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
        return filename || "document";
    } catch {
        return "document";
    }
}

/**
 * Sanitize a string for use as a filename.
 */
function sanitizeFilename(name: string): string {
    const cleaned = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 100)
        .replace(/^-|-$/g, "");
    return cleaned || "document";
}

/**
 * Check whether a URL or Content-Type header indicates a PDF.
 */
export function isPDF(url: string, contentType?: string): boolean {
    // Check content-type first
    if (contentType?.includes("application/pdf")) {
        return true;
    }

    // Fall back to URL extension check
    try {
        const urlObj = new URL(url);
        return urlObj.pathname.toLowerCase().endsWith(".pdf");
    } catch {
        return false;
    }
}
