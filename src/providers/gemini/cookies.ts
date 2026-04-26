/**
 * ──────────────────────────────────────────────
 *  Chrome / Chromium Cookie Extraction
 * ──────────────────────────────────────────────
 * Extracts Google authentication cookies from
 * supported Chromium-based browsers (Chrome, Arc,
 * Helium on macOS; Chromium, Chrome on Linux).
 *
 * The cookies are needed by the Gemini Web provider
 * to authenticate requests.
 *
 * @module providers/gemini/cookies
 */

import { execFile } from "node:child_process";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir, platform } from "node:os";
import { join } from "node:path";

// ── Exported types ─────────────────────────────

/** Map of cookie name → value. */
export type CookieMap = Record<string, string>;

/** Result of a cookie-extraction attempt. */
export interface CookieExtractResult {
    readonly cookies: CookieMap;
    readonly warnings: readonly string[];
}

// ── Internal types ─────────────────────────────

interface BrowserConfig {
    name: string;
    baseDir: string;
    keychainService?: string;
    keychainAccount?: string;
    secretToolApp?: string;
}

interface GetCookiesOptions {
    /** Chrome profile directory (e.g. `"Profile 2"`, `"Default"`). */
    profile?: string;
    /** Only return results if all these cookie names are present. */
    requiredCookies?: string[];
}

// ── Cookie names we care about ──────────────────

const GOOGLE_ORIGINS = [
    "https://gemini.google.com",
    "https://accounts.google.com",
    "https://www.google.com",
];

const ALL_COOKIE_NAMES = new Set([
    "__Secure-1PSID",
    "__Secure-1PSIDTS",
    "__Secure-1PSIDCC",
    "__Secure-1PAPISID",
    "NID",
    "AEC",
    "SOCS",
    "__Secure-BUCKET",
    "__Secure-ENID",
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "__Secure-3PSID",
    "__Secure-3PSIDTS",
    "__Secure-3PAPISID",
    "SIDCC",
]);

const REQUIRED_COOKIES_DEFAULT = ["__Secure-1PSID", "__Secure-1PSIDTS"];

// ── Browser configs by platform ────────────────

const MACOS_BROWSER_CONFIGS: BrowserConfig[] = [
    {
        name: "Helium",
        baseDir: "Library/Application Support/net.imput.helium",
        keychainService: "Helium Storage Key",
        keychainAccount: "Helium",
    },
    {
        name: "Chrome",
        baseDir: "Library/Application Support/Google/Chrome",
        keychainService: "Chrome Safe Storage",
        keychainAccount: "Chrome",
    },
    {
        name: "Arc",
        baseDir: "Library/Application Support/Arc/User Data",
        keychainService: "Arc Safe Storage",
        keychainAccount: "Arc",
    },
];

const LINUX_BROWSER_CONFIGS: BrowserConfig[] = [
    { name: "Chromium", baseDir: ".config/chromium", secretToolApp: "chromium" },
    { name: "Chrome", baseDir: ".config/google-chrome", secretToolApp: "chrome" },
];

// ── Public API ─────────────────────────────────

/**
 * Attempt to extract Google cookies from installed Chromium-based
 * browsers.  Tries supported browsers in order and returns the
 * first successful result.
 *
 * @param options - Extraction options (profile override, required cookies).
 * @returns Cookie map + warnings, or `null` if no browser had usable cookies.
 */
export async function getGoogleCookies(
    options?: GetCookiesOptions,
): Promise<CookieExtractResult | null> {
    const currentPlatform = platform();
    const configs: BrowserConfig[] =
        currentPlatform === "darwin"
            ? MACOS_BROWSER_CONFIGS
            : currentPlatform === "linux"
              ? LINUX_BROWSER_CONFIGS
              : [];

    if (configs.length === 0) {
        return null;
    }

    const warnings: string[] = [];
    const profile = options?.profile ?? "Default";
    const required = options?.requiredCookies ?? REQUIRED_COOKIES_DEFAULT;
    const hosts = GOOGLE_ORIGINS.map((origin) => new URL(origin).hostname);

    for (const config of configs) {
        const cookiesPath = join(homedir(), config.baseDir, profile, "Cookies");
        if (!existsSync(cookiesPath)) {
            continue;
        }

        const password = await readBrowserPassword(config, currentPlatform);
        if (!password) {
            warnings.push(`Could not read ${config.name} cookie encryption password`);
            continue;
        }

        const key = pbkdf2Sync(
            password,
            "saltysalt",
            currentPlatform === "darwin" ? 1003 : 1,
            16,
            "sha1",
        );

        const tempDir = mkdtempSync(join(tmpdir(), "pi-chrome-cookies-"));

        try {
            const tempDb = join(tempDir, "Cookies");
            copyFileSync(cookiesPath, tempDb);
            copySidecar(cookiesPath, tempDb, "-wal");
            copySidecar(cookiesPath, tempDb, "-shm");

            const metaVersion = await readMetaVersion(tempDb);
            const stripHash = metaVersion >= 24;
            const rows = await queryCookieRows(tempDb, hosts);

            if (!rows) {
                warnings.push(`Failed to query ${config.name} cookie database`);
                continue;
            }

            const cookies: CookieMap = {};
            for (const row of rows) {
                const name = String(row.name ?? "");
                if (!ALL_COOKIE_NAMES.has(name)) {
                    continue;
                }
                if (cookies[name]) {
                    continue;
                }

                let value: string | null =
                    typeof row.value === "string" && row.value.length > 0 ? row.value : null;

                if (!value) {
                    const encrypted = row.encrypted_value;
                    if (encrypted instanceof Uint8Array) {
                        value = decryptCookieValue(encrypted, key, stripHash);
                    }
                }

                if (value) {
                    cookies[name] = value;
                }
            }

            // Check required cookies
            if (!required.every((name) => name in cookies)) {
                continue;
            }

            return { cookies, warnings };
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    }

    return null;
}

// ── Cookie decryption ──────────────────────────

/**
 * Decrypt an AES-128-CBC encrypted cookie value.
 *
 * Chromium encrypts cookies using AES-128-CBC with a key derived
 * from the OS-level password (Keychain on macOS, secret-tool on
 * Linux, or the hardcoded "peanuts" fallback).
 */
function decryptCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {
    const buf = Buffer.from(encrypted);
    if (buf.length < 3) {
        return null;
    }

    // Expect "v10", "v11", etc. prefix
    const prefix = buf.subarray(0, 3).toString("utf8");
    if (!/^v\d\d$/.test(prefix)) {
        return null;
    }

    const ciphertext = buf.subarray(3);
    if (ciphertext.length === 0) {
        return "";
    }

    try {
        const iv = Buffer.alloc(16, 0x20);
        const decipher = createDecipheriv("aes-128-cbc", key, iv);
        decipher.setAutoPadding(false);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const unpadded = removePkcs7Padding(plaintext);
        // In newer Chrome versions (meta >= 24), the first 32 bytes are a hash
        const bytes = stripHash && unpadded.length >= 32 ? unpadded.subarray(32) : unpadded;
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        // Strip leading control characters
        let i = 0;
        while (i < decoded.length && decoded.charCodeAt(i) < 0x20) {
            i++;
        }
        return decoded.slice(i);
    } catch {
        return null;
    }
}

function removePkcs7Padding(buf: Buffer): Buffer {
    if (buf.length === 0) {
        return buf;
    }
    const padding = buf[buf.length - 1];
    if (!padding || padding > 16) {
        return buf;
    }
    return buf.subarray(0, buf.length - padding);
}

// ── OS-level password retrieval ────────────────

function readBrowserPassword(
    config: BrowserConfig,
    currentPlatform: string,
): Promise<string | null> {
    if (currentPlatform === "darwin") {
        if (!config.keychainAccount || !config.keychainService) {
            return Promise.resolve(null);
        }
        return readKeychainPassword(config.keychainAccount, config.keychainService);
    }
    if (currentPlatform === "linux") {
        return readLinuxPassword(config.secretToolApp);
    }
    return Promise.resolve(null);
}

function readKeychainPassword(account: string, service: string): Promise<string | null> {
    return new Promise((resolve) => {
        execFile(
            "security",
            ["find-generic-password", "-w", "-a", account, "-s", service],
            { timeout: 5000 },
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

function readLinuxPassword(secretToolApp: string | undefined): Promise<string> {
    if (!secretToolApp) {
        return Promise.resolve("peanuts");
    }

    return new Promise((resolve) => {
        execFile(
            "secret-tool",
            ["lookup", "application", secretToolApp],
            { timeout: 5000 },
            (err, stdout) => {
                if (err) {
                    // KDE Wallet users fall through to "peanuts" intentionally.
                    resolve("peanuts");
                    return;
                }
                resolve(stdout.trim() || "peanuts");
            },
        );
    });
}

// ── SQLite operations ──────────────────────────

let sqliteModule: typeof import("node:sqlite") | null = null; // eslint-disable-line @typescript-eslint/consistent-type-imports

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
async function importSqlite(): Promise<typeof import("node:sqlite") | null> {
    if (sqliteModule) {
        return sqliteModule;
    }

    // Suppress the experimental warning
    const origEmitWarning = process.emitWarning.bind(process);
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
        const msg = typeof warning === "string" ? warning : (warning?.message ?? "");
        if (msg.includes("SQLite is an experimental feature")) {
            return;
        }
        return (origEmitWarning as Function)(warning, ...args);
    }) as typeof process.emitWarning;

    try {
        sqliteModule = await import("node:sqlite");
        return sqliteModule;
    } catch {
        return null;
    } finally {
        process.emitWarning = origEmitWarning;
    }
}

function supportsReadBigInts(): boolean {
    const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
    if (major > 24) {
        return true;
    }
    if (major < 24) {
        return false;
    }
    return minor >= 4;
}

async function readMetaVersion(dbPath: string): Promise<number> {
    const sqlite = await importSqlite();
    if (!sqlite) {
        return 0;
    }

    const opts: Record<string, unknown> = { readOnly: true };
    if (supportsReadBigInts()) {
        opts.readBigInts = true;
    }

    const db = new sqlite.DatabaseSync(dbPath, opts);
    try {
        const rows = db.prepare("SELECT value FROM meta WHERE key = 'version'").all() as Array<
            Record<string, unknown>
        >;

        const val = rows[0]?.value;
        if (typeof val === "number") {
            return Math.floor(val);
        }
        if (typeof val === "bigint") {
            return Number(val);
        }
        if (typeof val === "string") {
            return parseInt(val, 10) || 0;
        }
        return 0;
    } catch {
        return 0;
    } finally {
        db.close();
    }
}

async function queryCookieRows(
    dbPath: string,
    hosts: string[],
): Promise<Array<Record<string, unknown>> | null> {
    const sqlite = await importSqlite();
    if (!sqlite) {
        return null;
    }

    // Build WHERE clause matching all variations of the target hosts
    const clauses: string[] = [];
    for (const host of hosts) {
        for (const candidate of expandHosts(host)) {
            const esc = candidate.replaceAll("'", "''");
            clauses.push(`host_key = '${esc}'`);
            clauses.push(`host_key = '.${esc}'`);
            clauses.push(`host_key LIKE '%.${esc}'`);
        }
    }
    const where = clauses.join(" OR ");

    const opts: Record<string, unknown> = { readOnly: true };
    if (supportsReadBigInts()) {
        opts.readBigInts = true;
    }

    const db = new sqlite.DatabaseSync(dbPath, opts);
    try {
        return db
            .prepare(
                `SELECT name, value, host_key, encrypted_value FROM cookies WHERE (${where}) ORDER BY expires_utc DESC`,
            )
            .all() as Array<Record<string, unknown>>;
    } catch {
        return null;
    } finally {
        db.close();
    }
}

function expandHosts(host: string): string[] {
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 1) {
        return [host];
    }

    const candidates = new Set<string>();
    candidates.add(host);
    for (let i = 1; i <= parts.length - 2; i++) {
        const c = parts.slice(i).join(".");
        if (c) {
            candidates.add(c);
        }
    }

    return Array.from(candidates);
}

// ── File helpers ───────────────────────────────

function copySidecar(srcDb: string, targetDb: string, suffix: string): void {
    const sidecar = `${srcDb}${suffix}`;
    if (!existsSync(sidecar)) {
        return;
    }
    try {
        copyFileSync(sidecar, `${targetDb}${suffix}`);
    } catch {
        // Best-effort copy
    }
}
