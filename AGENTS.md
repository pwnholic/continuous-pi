# Pi Web Access v2 — Agent Guide

This document defines the project's architecture, conventions, and rules for AI agents
working on this codebase. Read it before making any changes.

---

## Table of Contents

- [1. Project Overview](#1-project-overview)
- [2. Architecture](#2-architecture)
- [3. Coding Standards](#3-coding-standards)
- [4. Design Patterns](#4-design-patterns)
- [5. Provider & Extractor Patterns](#5-provider--extractor-patterns)
- [6. Configuration System](#6-configuration-system)
- [7. Tool Definitions](#7-tool-definitions)
- [8. Adding New Features](#8-adding-new-features)
- [9. Quality & Tooling](#9-quality--tooling)
- [10. Common Pitfalls](#10-common-pitfalls)

---

## 1. Project Overview

**continuous-pi** is a **Pi Coding Agent extension** that gives Pi AI the ability to
search the web and extract content from URLs.

### Key Facts

| Attribute     | Value                                                        |
| ------------- | ------------------------------------------------------------ |
| Type          | Pi extension (TypeScript)                                    |
| Entry point   | `index.ts` (exports default async function)                  |
| Pi manifest   | `package.json` → `pi.extensions: ["./index.ts"]`             |
| Skill         | `skills/librarian/` — research assistant skill               |
| Runtime       | Node.js ESNext                                               |
| Module system | `"Preserve"` (tsconfig), imports use `.js` extensions        |
| Strictness    | TypeScript strict mode + noUnusedLocals + noUnusedParameters |

### Registered Tools

The extension registers these tools with the Pi runtime via `pi.registerTool()`:

| Tool                | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `web_search`        | Search the web via Exa, Perplexity, or Gemini                |
| `fetch_content`     | Extract content from URLs (web, PDF, GitHub, YouTube, video) |
| `search_results`    | View stored search results                                   |
| `fetch_results`     | View stored fetch results                                    |
| `web_search_curate` | Multi-query search with curator UI                           |
| `code_search`       | Search code via Exa                                          |

### Run Commands

```bash
# Quick test (no install)
pi -e ./index.ts

# Setup project settings
mkdir -p .pi
echo '{"extensions":["./index.ts"],"skills":["./skills"]}' > .pi/settings.json
pi
```

---

## 2. Architecture

```
continuous-pi/
├── index.ts                  # Pi extension entry — registers tools
├── src/
│   ├── index.ts              # main() — tool handler implementations
│   ├── activity.ts           # ActivityMonitor — tracks API/fetch operations
│   ├── storage.ts            # In-memory result cache with session restore
│   ├── utils.ts              # Shared utilities (error parsing, time formatting)
│   ├── config/
│   │   ├── index.ts          # ConfigLoader — reads ~/.pi/web-search.json
│   │   └── validators.ts     # Normalizer functions for config fields
│   ├── types/
│   │   ├── index.ts          # Barrel re-export of all types
│   │   ├── activity.ts       # IActivityEntry, IRateLimitInfo
│   │   ├── config.ts         # IRawConfig, IResolvedConfig, DEFAULTS, ENV_KEYS
│   │   ├── content.ts        # IExtractedContent, IVideoFrame, ContentKind
│   │   ├── curator.ts        # Curator server types
│   │   ├── provider.ts       # ISearchProvider, IContentExtractor, IFrameExtractor
│   │   ├── result.ts         # Result<T,E> discriminated union + Brand type
│   │   └── search.ts         # ISearchResult, ISearchResponse, SearchProvider
│   ├── providers/
│   │   ├── registry.ts       # Search orchestrator with fallback chain
│   │   ├── exa.ts            # Exa.ai search (MCP + REST API)
│   │   ├── perplexity.ts     # Perplexity AI search
│   │   ├── code-search.ts    # Code search via Exa
│   │   └── gemini/
│   │       ├── api.ts        # Gemini API search
│   │       ├── web.ts        # Gemini Web (cookie-based)
│   │       ├── cookies.ts    # Chrome cookie extraction
│   │       └── url-context.ts # Gemini URL context extraction
│   ├── extractors/
│   │   ├── registry.ts       # URL → extractor router with fallback
│   │   ├── http.ts           # Web page extraction (Readability + fallbacks)
│   │   ├── pdf.ts            # PDF text extraction
│   │   ├── github.ts         # GitHub repo clone + file reading
│   │   ├── github-api.ts     # GitHub API fallback
│   │   ├── video.ts          # Local video file processing
│   │   ├── youtube.ts        # YouTube content extraction
│   │   └── rsc.ts            # React Server Components parser
│   ├── curator/
│   │   ├── page.ts           # HTML page generator for curator UI
│   │   ├── server.ts         # Ephemeral HTTP/SSE server
│   │   └── summary.ts        # Summary generation with model fallback
│   └── ui/
│       ├── activity.ts       # Activity panel rendering
│       ├── search-results.ts # Search result formatters
│       └── fetch-results.ts  # Fetch result formatters
└── skills/
    └── librarian/
        └── SKILL.md          # Research assistant skill
```

### Data Flow

```
User query
  → web_search tool (index.ts)
    → providers/registry.ts (search orchestrator)
      → exa.ts | perplexity.ts | gemini/api.ts | gemini/web.ts
        → returns IAttributedSearchResponse
    → storage.ts (cache result)
    → ui/search-results.ts (format for display)

fetch_content tool (index.ts)
  → extractors/registry.ts (content router)
    → classifyURL(url) → kind
      → github.ts | youtube.ts | video.ts | http.ts
        → returns IExtractedContent
    → storage.ts (cache result)
    → ui/fetch-results.ts (format for display)
```

---

## 3. Coding Standards

### 3.1 TypeScript Configuration

- Target: `ESNext`, Module: `Preserve`
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- `verbatimModuleSyntax: true` — always use `import type` for type-only imports
- `noUnusedLocals: true`, `noUnusedParameters: true`
- Use `allowImportingTsExtensions: true` — imports use `.js` extensions

### 3.2 Naming Conventions

| Construct                    | Convention                                       | Examples                             |
| ---------------------------- | ------------------------------------------------ | ------------------------------------ |
| **Interfaces**               | PascalCase, prefix `I`                           | `ISearchProvider`, `IConfigLoader`   |
| **Types**                    | PascalCase                                       | `SearchProvider`, `ContentKind`      |
| **Type parameters**          | PascalCase, single letter or `T`/`K`/`V`/`E`/`R` | `T`, `E`, `TData`                    |
| **Functions**                | camelCase                                        | `extractContent`, `classifyURL`      |
| **Methods (public)**         | camelCase                                        | `logStart()`, `getEntries()`         |
| **Methods (private)**        | camelCase with `#` prefix                        | `#readAndResolve()`, `#notify()`     |
| **Variables**                | camelCase                                        | `result`, `configLoader`             |
| **Constants (module-level)** | UPPER_SNAKE_CASE or camelCase                    | `DEFAULT_TIMEOUT_MS`, `CACHE_TTL_MS` |
| **Files**                    | kebab-case                                       | `code-search.ts`, `github-api.ts`    |

### 3.3 Import Rules

1. **Use `.js` extensions** in all relative imports (tsconfig `verbatimModuleSyntax`)
2. **Group imports** with blank lines between groups:
    ```
    // 1. Node builtins
    // 2. External packages
    // 3. Internal types (from ../types/ or ./types/)
    // 4. Internal modules
    ```
3. **Use `import type`** for type-only imports — never use inline `type` imports
4. **Prefer `typebox`** (`@sinclair/typebox`) for tool parameter schemas (`Type.Object`, `Type.String`, etc.)
5. **No barrel imports** from `../types/index.js` in internal code — import from the specific type file

Example:

```typescript
import { readFileSync, existsSync } from "node:fs"; // builtin
import { Readability } from "@mozilla/readability"; // external
import type { IExtractedContent } from "../types/content.js"; // type
import { activityMonitor } from "../activity.js"; // internal
```

### 3.4 JSDoc Conventions

Every module must have a header docblock:

```typescript
/**
 * ──────────────────────────────────────────────
 *  Module Name
 * ──────────────────────────────────────────────
 * One-paragraph description of what this module does.
 *
 * @module module-name
 */
```

Public functions/interfaces must have JSDoc:

```typescript
/**
 * Description of what this function does.
 *
 * @param paramName - Description of the parameter.
 * @returns Description of the return value.
 * @throws {Error} When and why it throws.
 */
```

Internal/private functions may have inline comments instead of full JSDoc.

### 3.5 TypeScript Rules

- **Prefer `interface`** over `type` for object types (`@typescript-eslint/consistent-type-definitions: warn`)
- **All interface properties must be `readonly`** — always annotate with `readonly`
- **Use `ReadonlyArray<T>`** instead of `T[]` for immutable arrays in interfaces
- **Use `as const`** for literal constants and enum-like objects
- **Use `satisfies`** for type-checking literal objects
- **Use `#` private fields** (ES2022) instead of `private` keyword
- **No `any`** — use `unknown` and narrow with type guards
- **No `null`** in internal code — use `undefined` where possible
- **Result<T, E> type** for fallible operations (see `src/types/result.ts`)

### 3.6 Error Handling

- Use `toErrorMessage(err)` from `utils.ts` to safely convert errors to strings
- Use `isAbortError(err)` to check for abort signals
- Use `readExecError(err)` for exec/spawn error details
- Catch blocks should always handle the error (not silently swallow)
- Only throw for unrecoverable configuration errors — return error objects for transient failures

---

## 4. Design Patterns

### 4.1 Singleton + Interface Pattern

Providers and extractors use **singleton instances** behind **read-only interfaces**.

```typescript
// config/index.ts
export interface IConfigLoader {
    readonly exaApiKey: string | null;
    readonly defaultProvider: string;
    // ... readonly accessors
}

export class ConfigLoader {
    #cached: IResolvedConfig | null = null;

    load(): IResolvedConfig {
        /* ... */
    }
    get exaApiKey(): string | null {
        return this.load().exaApiKey;
    }
}
```

### 4.2 Module Docstring Pattern

Every file starts with a `@module` JSDoc and separator comment:

```typescript
/**
 * ──────────────────────────────────────────────
 *  Module Name
 * ──────────────────────────────────────────────
 * Description...
 *
 * @module path/module
 */
```

### 4.3 Activity Monitor Pattern

All external API calls and fetch operations are logged via the singleton `activityMonitor`:

```typescript
import { activityMonitor } from "../activity.js";

const id = activityMonitor.logStart({ type: "api", query });
try {
    const result = await doApiCall();
    activityMonitor.logComplete(id, 200);
    return result;
} catch (err) {
    activityMonitor.logError(id, toErrorMessage(err));
    throw err;
}
```

### 4.4 Storage Pattern

Search/fetch results are cached in memory with TTL-based expiry and session restore:

```typescript
import { generateId, storeResult, getResult } from "../storage.js";

const id = generateId();
storeResult(id, { id, type: "search", timestamp: Date.now(), queries });
const data = getResult(id);
```

### 4.5 Result Type Pattern

Use the `Result<T, E>` discriminated union for operations where the caller
must handle failure:

```typescript
import { ok, err, type Result } from "../types/result.js";

function divide(a: number, b: number): Result<number, string> {
    if (b === 0) return err("division by zero");
    return ok(a / b);
}
```

---

## 5. Provider & Extractor Patterns

### 5.1 Search Provider Pattern

Every search provider module exports:

- A `searchWithXxx()` async function
- An `isXxxAvailable()` / `hasXxxApiKey()` check function

```typescript
export async function searchWithExa(
    query: string,
    configLoader: IConfigLoader,
    options?: IFullSearchOptions,
): Promise<IAttributedSearchResponse>;

export function isExaAvailable(): Promise<boolean>;
export function hasExaApiKey(configLoader: IConfigLoader): boolean;
```

The **provider registry** (`providers/registry.ts`) implements the fallback chain:

1. Exa (if API key → direct API, else → MCP)
2. Perplexity (requires API key)
3. Gemini API (requires API key)
4. Gemini Web (requires cookie auth)

### 5.2 Content Extractor Pattern

Every extractor module exports an `extractXxxContent()` async function.

The **extractor registry** (`extractors/registry.ts`) classifies URLs and routes them:

```
URL → classifyURL(url)
  ├─ "github"     → extractGitHubContent()
  ├─ "youtube"    → extractYouTubeContent()
  ├─ "local-video" → extractVideoFileContent()
  ├─ "pdf"        → extractViaHttp() (detected inside http.ts)
  └─ "web"        → extractViaHttp() with fallback chain
```

### 5.3 HTTP Fallback Chain

`extractors/http.ts` implements a multi-stage fallback for web pages:

1. **Readability** — fast local extraction (works for most sites)
2. **RSC parser** — Next.js flight data extraction
3. **Jina Reader** — server-side JS rendering (r.jina.ai)
4. **Gemini URL Context** — needs `GEMINI_API_KEY`
5. **Gemini Web** — needs cookie auth

### 5.4 Provider Registry Interface

Defined in `types/provider.ts`:

```typescript
export interface ISearchProvider {
    readonly name: string;
    isAvailable(): Promise<boolean>;
    search(query: string, options: ISearchOptions): Promise<ISearchResponse>;
    fetchInlineContent?(results: readonly ISearchResult[], signal?: AbortSignal): Promise<readonly IExtractedContent[]>;
}

export interface IContentExtractor {
    readonly name: string;
    readonly priority: number;
    canHandle(url: string): boolean;
    extract(url: string, options: IExtractOptions): Promise<IExtractedContent | null>;
}
```

---

## 6. Configuration System

### 6.1 Config File

- Path: `~/.pi/web-search.json`
- Loaded by `ConfigLoader` in `config/index.ts`
- Environment variables override file values

### 6.2 Environment Variables

| Variable             | Overrides                    |
| -------------------- | ---------------------------- |
| `EXA_API_KEY`        | `exaApiKey` in config        |
| `PERPLEXITY_API_KEY` | `perplexityApiKey` in config |
| `GEMINI_API_KEY`     | `geminiApiKey` in config     |

### 6.3 Config Shape (`IResolvedConfig`)

```typescript
interface IResolvedConfig {
    readonly exaApiKey: string | null;
    readonly perplexityApiKey: string | null;
    readonly geminiApiKey: string | null;
    readonly defaultProvider: SearchProvider; // "auto" | "exa" | "perplexity" | "gemini"
    readonly searchModel: string | undefined;
    readonly workflow: SearchWorkflow; // "none" | "summary-review"
    readonly curatorTimeoutSeconds: number; // default: 20
    readonly chromeProfile: string | undefined;
    readonly githubClone: IResolvedGitHubCloneConfig;
    readonly youtube: IResolvedYouTubeConfig;
    readonly video: IResolvedVideoConfig;
    readonly shortcuts: IShortcutConfig;
}
```

### 6.4 Config Validators

All validators in `config/validators.ts` follow the same signature pattern:

```typescript
function normalizeXxx(value: unknown, fallback?: T): T;
```

They handle `null`, `undefined`, type mismatches, and invalid values gracefully.

---

## 7. Tool Definitions

Tools are registered in `index.ts` (the Pi extension entry) using `pi.registerTool()`.

Each tool definition has:

```typescript
pi.registerTool({
    name: "tool_name",                    // snake_case, matched by LLM
    label: "Tool Label",                  // Display name
    description: "What this tool does…",  // Long description for LLM
    promptSnippet: "Short hint…",         // Optional — concise usage hint
    promptGuidelines: "Rules…",           // Optional — when/how to use
    parameters: Type.Object({ … }),       // TypeBox schema
    async execute(toolCallId, params, signal, onUpdate, ctx) {
        // … implementation …
        return {
            content: [{ type: "text", text: result }],
            details: {},
        };
    },
});
```

### Tool Parameter Schemas

Use `@sinclair/typebox` for parameter schemas:

```typescript
import { Type } from "@sinclair/typebox";

const params = Type.Object({
    query: Type.String({ description: "Search query" }),
    numResults: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 5 })),
    provider: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("exa"), Type.Literal("perplexity")])),
});
```

### Tool Output Format

Return `content` as an array of `{ type, text }` objects.
Use `details` for structured metadata (not displayed to user, available for agent context).

---

## 8. Adding New Features

### 8.1 Adding a New Search Provider

1. Create `src/providers/new-provider.ts`
2. Export `searchWithNewProvider()`, `isNewProviderAvailable()`
3. Add its type to `SearchProvider` in `types/search.ts`
4. Add its config key to `IRawConfig`/`IResolvedConfig` in `types/config.ts`
5. Add validator in `config/validators.ts`
6. Add to fallback chain in `providers/registry.ts`
7. Add env var key to `ENV_KEYS` and `DEFAULTS` in `types/config.ts`

### 8.2 Adding a New Content Extractor

1. Create `src/extractors/new-extractor.ts`
2. Export `extractNewContent()` function
3. Add a new `ContentKind` value in `types/content.ts`
4. Add classification logic in `classifyURL()` in `extractors/registry.ts`
5. Add routing in `extractContent()` in `extractors/registry.ts`
6. Optionally implement `IContentExtractor` interface from `types/provider.ts`

### 8.3 Adding a New Tool

1. Add tool definition in `src/index.ts` (the extension entry, around L40-120)
2. Add handler logic in `src/index.ts` (the `main()` function)
3. Use TypeBox for parameter schema
4. Use `activityMonitor` to log operations
5. Use `storage.ts` to persist results
6. Use UI formatters in `src/ui/` for display

### 8.4 Adding Types

1. Add to the appropriate file in `src/types/`
2. Export from `src/types/index.ts` (barrel re-export)
3. Always use `readonly` on interface properties
4. Favor `interface` over `type` for object shapes
5. Use discriminated unions for variant types

---

## 9. Quality & Tooling

### 9.1 Code Quality Tools

```bash
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run lint:quiet     # ESLint (errors only)
npm run format         # Prettier format
npm run format:check   # Prettier check
```

### 9.2 TLDR (Analysis Tool)

The project uses `tldr` for code analysis. It's installed locally.

```bash
tldr tree src/              # File tree
tldr structure src/         # Code structure
tldr deps src/              # Module dependencies
tldr calls src/             # Call graph
tldr health src/            # Code health dashboard
tldr dead src/              # Dead code detection
tldr smells src/            # Code smells
tldr complexity src/        # Cyclomatic complexity
tldr patterns src/          # Design patterns
tldr todo src/              # Improvement suggestions
```

### 9.3 Pre-commit Checklist

- [ ] No dead code (`tldr dead src/` — should be 0)
- [ ] No lingering code smells for new/modified code
- [ ] eslint passes (`npm run lint`)
- [ ] Prettier formatting (`npm run format`)
- [ ] All imports use `.js` extensions
- [ ] All new interfaces use `readonly` properties
- [ ] All new functions have JSDoc or inline comments
- [ ] Activity monitor calls for API/fetch operations

---

## 10. Common Pitfalls

### ❌ Wrong import style

```typescript
// BAD — missing .js extension
import { foo } from "./bar";

// GOOD
import { foo } from "./bar.js";
```

### ❌ Non-readonly interface

```typescript
// BAD
interface IResult {
    id: string;
}

// GOOD
interface IResult {
    readonly id: string;
}
```

### ❌ Inline type import

```typescript
// BAD — use inline-type-imports style
import { type Foo, bar } from "./foo.js";

// GOOD — separate type import
import type { Foo } from "./foo.js";
import { bar } from "./foo.js";
```

### ❌ Mutating parameters

```typescript
// BAD
function process(obj: Record<string, unknown>): void {
    obj.modified = true;
}

// GOOD — return new object
function process(obj: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return { ...obj, modified: true };
}
```

### ❌ Using `private` keyword instead of `#`

```typescript
// BAD
class Foo {
    private bar: string;
}

// GOOD
class Foo {
    #bar: string;
}
```

### ❌ Throwing for transient errors

```typescript
// BAD — throw for something the caller might want to handle
async function extract(url: string): Promise<IExtractedContent> {
    if (!canHandle(url)) throw new Error("Cannot handle URL");
}

// GOOD — return error in result object
async function extract(url: string): Promise<IExtractedContent> {
    if (!canHandle(url)) {
        return { url, title: "", content: "", error: "Cannot handle URL" };
    }
}
```

### ❌ Forgetting activity monitor

```typescript
// BAD — no tracking
async function doApiCall() {
    /* ... */
}

// GOOD — log the operation
const id = activityMonitor.logStart({ type: "api", query });
try {
    return await doApiCall();
} catch (err) {
    activityMonitor.logError(id, toErrorMessage(err));
    throw err;
}
```

---

## Appendix: Quick Reference

### Key Dependencies

| Package                | Purpose                        |
| ---------------------- | ------------------------------ |
| `@sinclair/typebox`    | Tool parameter schemas         |
| `@mozilla/readability` | Web page content extraction    |
| `linkedom`             | HTML parsing (lightweight DOM) |
| `turndown`             | HTML → Markdown conversion     |
| `unpdf`                | PDF text extraction            |
| `p-limit`              | Concurrency limiting           |

### Key Artifacts

| Artifact      | Path                        | Purpose                |
| ------------- | --------------------------- | ---------------------- |
| Config file   | `~/.pi/web-search.json`     | User configuration     |
| Exa usage     | `~/.pi/exa-usage.json`      | Monthly usage tracking |
| GitHub clones | `/tmp/pi-github-repos/`     | Cloned repos           |
| Curator port  | Random (server returns URL) | Curator HTTP server    |
