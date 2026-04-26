continuous-pi/DESIGN.md

```markdown
# continuous-pi — Design & Implementation Plan

> **Pi Web Access v2 → Continuum Pi**
>
> Transform the existing Pi extension (web search + content extraction) into a
> comprehensive Pi package with autonomous SDLC pipeline, knowledge loop, deep
> research oracle, code health tools, and session handoff system.
>
> Everything is implemented in TypeScript within `src/`, using only Pi's native
> APIs (`pi.registerTool()`, `pi.registerCommand()`, events, SDK, Task tool)
> and external CLI tools (bloks, tldr, fastedit) called via `child_process`.

---

## Table of Contents

- [1. Architecture Overview](#1-architecture-overview)
- [2. Pi Extension Entry (`index.ts`)](#2-pi-extension-entry-indexts)
- [3. Tools Layer (`src/tools/`)](#3-tools-layer-srctools)
- [4. Pipeline Layer (`src/pipeline/`)](#4-pipeline-layer-srcpipeline)
- [5. Shared Modules](#5-shared-modules)
- [6. Skills Layer (`skills/`)](#6-skills-layer-skills)
- [7. Types](#7-types)
- [8. Module Reference Index](#8-module-reference-index)
- [9. Implementation Order](#9-implementation-order)

---

## 1. Architecture Overview

### 1.1 Layer Diagram
```

┌─────────────────────────────────────────────────────────────┐
│ Pi Runtime (pi) │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ index.ts (Extension Entry) │ │
│ │ ┌───────────────────────────────────────────────────┐ │ │
│ │ │ Command Handlers │ Tool Definitions │ │ │
│ │ │ /bootup │ web_search, fetch_content │ │ │
│ │ │ /autonomous │ deep_research, code_health │ │ │
│ │ │ /research │ bloks_learn, bloks_context │ │ │
│ │ │ /handoff │ spawn_worker, create_handoff│ │ │
│ │ │ /review │ resume_handoff, fast_edit │ │ │
│ │ └───────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ src/tools/ (Per-tool handler modules) │ │
│ │ web-search.ts fetch-content.ts deep-research.ts │ │
│ │ code-health.ts bloks.ts handoff.ts worker.ts │ │
│ └─────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ src/pipeline/ (Autonomous SDLC phases) │ │
│ │ assess → plan → premortem → prepare → execute → │ │
│ │ validate → evolve │ │
│ └─────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ src/ (Shared modules) │ │
│ │ readiness.ts contract.ts knowledge-loop.ts │ │
│ │ providers/ extractors/ config/ types/ activity.ts │ │
│ │ storage.ts utils.ts │ │
│ └─────────────────────────────────────────────────────────┘ │
│ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ skills/ (Agent Skills — SKILL.md) │ │
│ │ bootup autonomous research premortem review handoff│ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

External CLI Tools (on PATH): bloks, tldr, fastedit

```

### 1.2 Data Flow

```

User: "/bootup"
→ pi registers it as a command → handler() runs
→ src/readiness.ts reads project health via tldr
→ User picks a mode: autonomous / research / review
→ Delegates to the corresponding skill

User: "/autonomous implement auth"
→ pipeline/assess.ts classifies complexity
→ pipeline/plan.ts creates contract.json
→ pipeline/premortem.ts runs failure analysis
→ pipeline/prepare.ts gathers context (bloks + tldr)
→ pipeline/execute.ts spawns workers via Task tool
→ pipeline/validate.ts runs tests + typecheck
→ pipeline/evolve.ts writes to bloks (knowledge loop)

User via LLM: "deep_research('JWT vs OAuth')"
→ src/tools/deep-research.ts
→ Decomposes question → parallel searches (Exa/Perplexity)
→ Fetches top results → synthesizes → saves to bloks

````

### 1.3 Key Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Everything in TypeScript** | No shell scripts — all logic in `src/` |
| **Pi-native APIs only** | Use `pi.registerTool()`, events, SDK — not Claude Code patterns |
| **Modular tools** | Each tool in its own file under `src/tools/` |
| **Pipelines orchestrate** | Pipeline phases call tools, never implement directly |
| **Skills guide** | SKILL.md files instruct the LLM on workflow; extensions provide the tools |
| **Knowledge loop** | Every task writes discoveries to bloks; every task reads existing cards |
| **Activity monitor** | All operations logged via existing `activityMonitor` |

---

## 2. Pi Extension Entry (`index.ts`)

### 2.1 Current State

```typescript
// index.ts (existing — entry point for Pi)
import main from "./src/index.js";
export default main;
````

The entry delegates to `src/index.ts` which registers all tools and commands.

### 2.2 Required Changes

Add new imports and registrations for all new tools and commands.

**Tools to register** (via `pi.registerTool()` — see [pi-docs/extensions.md#piregistertooldefinition](pi-docs/extensions.md#L1183-1234)):

| Tool Name                      | Handler File                 | Description                        |
| ------------------------------ | ---------------------------- | ---------------------------------- |
| `web_search` (existing)        | `src/tools/web-search.ts`    | Search via Exa/Perplexity/Gemini   |
| `fetch_content` (existing)     | `src/tools/fetch-content.ts` | Extract content from URLs          |
| `search_results` (existing)    | —                            | View stored search results         |
| `fetch_results` (existing)     | —                            | View stored fetch results          |
| `web_search_curate` (existing) | —                            | Multi-query search with curator UI |
| `code_search` (existing)       | —                            | Search code via Exa                |
| `deep_research`                | `src/tools/deep-research.ts` | Structured multi-query research    |
| `code_health`                  | `src/tools/code-health.ts`   | tldr-powered analysis dashboard    |
| `bloks_learn`                  | `src/tools/bloks.ts`         | Save knowledge to bloks            |
| `bloks_context`                | `src/tools/bloks.ts`         | Get relevant knowledge cards       |
| `spawn_worker`                 | `src/tools/worker.ts`        | Delegate task to sub-agent         |
| `create_handoff`               | `src/tools/handoff.ts`       | Serialize session state            |
| `resume_handoff`               | `src/tools/handoff.ts`       | Resume from handoff                |

**Commands to register** (via `pi.registerCommand()` — see [pi-docs/extensions.md#piregistercommandname-options](pi-docs/extensions.md#L1338-1373)):

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `/bootup`         | Assess project readiness & route to workflow |
| `/autonomous`     | Full SDLC pipeline                           |
| `/research`       | Deep research oracle                         |
| `/premortem`      | Failure analysis gate                        |
| `/review`         | Code review workflow                         |
| `/handoff`        | Create session handoff                       |
| `/resume-handoff` | Resume from handoff document                 |

**Events to subscribe** (via `pi.on()` — see [pi-docs/extensions.md#pionevent-handler](pi-docs/extensions.md#L1179-1183)):

| Event              | Purpose                                          | Reference                                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `session_start`    | Restore session data, check for pending handoffs | [pi-docs/extensions.md#session_start](pi-docs/extensions.md#L355-367)    |
| `session_shutdown` | Cleanup, save state                              | [pi-docs/extensions.md#session_shutdown](pi-docs/extensions.md#L447-459) |
| `tool_call`        | Log activity, block dangerous operations         | [pi-docs/extensions.md#tool_call](pi-docs/extensions.md#L640-681)        |

### 2.3 Extension Context API Usage

All tool handlers receive `ctx: ExtensionContext` ([pi-docs/extensions.md#extensioncontext](pi-docs/extensions.md#L818-940)):

```typescript
interface ExtensionContext {
    readonly ui: {
        // UI methods
        notify(msg: string, level: "info" | "warn" | "error"): void;
        confirm(title: string, msg: string): Promise<boolean>;
        select<T>(title: string, items: T[]): Promise<T | undefined>;
        setStatus(id: string, text: string): void;
        setWidget(id: string, lines: string[], placement?: "editor" | "status"): void;
    };
    readonly hasUI: boolean;
    readonly cwd: string;
    readonly sessionManager: SessionManager; // [pi-docs/session.md]
    readonly signal?: AbortSignal;
    isIdle(): boolean;
    abort(): void;
    hasPendingMessages(): boolean;
    shutdown(): void;
    getContextUsage(): { tokens: number } | undefined;
    compact(options?: { customInstructions?: string; onComplete?: Function; onError?: Function }): void;
    getSystemPrompt(): string;
}
```

Command handlers receive `ExtensionCommandContext` ([pi-docs/extensions.md#extensioncommandcontext](pi-docs/extensions.md#L940-1177)) which adds:

```typescript
interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
    newSession(options: {
        parentSession?: string;
        setup?: (sm: SessionManager) => Promise<void>;
        withSession: (ctx: ReplacedSessionContext) => Promise<void>;
    }): Promise<{ cancelled: boolean }>;
    fork(
        entryId: string,
        options?: {
            position?: "before" | "at";
            withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
        },
    ): Promise<{ cancelled: boolean }>;
    navigateTree(
        targetId: string,
        options?: {
            summarize?: boolean;
            customInstructions?: string;
            replaceInstructions?: boolean;
            label?: string;
        },
    ): Promise<unknown>;
    switchSession(
        sessionPath: string,
        options?: {
            withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
        },
    ): Promise<{ cancelled: boolean }>;
    reload(): Promise<void>;
}
```

---

## 3. Tools Layer (`src/tools/`)

### 3.1 `deep-research.ts` — Structured Research Oracle

**Purpose:** Decompose a research question into sub-questions, run parallel searches, fetch content, synthesize findings, and save to bloks.

**Input:** Question, depth ("quick" | "deep")
**Output:** Structured research report with summaries, sources, confidence levels

**Algorithm:**

```
1. Decompose question → sub-questions (via LLM call or deterministic splitting)
2. For each sub-question:
   a. web_search(query, { numResults: 5, includeContent: true })
   b. Store results
3. Aggregate all results → remove duplicates
4. Synthesize findings via deterministic summarization
5. Save discoveries to bloks: bloks learn {library} "{finding}"
6. Return structured report
```

**Pi APIs used:**

- `pi.registerTool()` — tool registration [pi-docs/extensions.md#L1183-1234]
- `Type.Object()` — TypeBox parameter schema
- `activityMonitor.logStart/Complete/Error` — activity tracking

**External CLI:** `bloks learn` for knowledge persistence

**Key interfaces:**

```typescript
interface IResearchResult {
    readonly question: string;
    readonly summary: string;
    readonly subQuestions: ReadonlyArray<{
        readonly question: string;
        readonly answer: string;
        readonly confidence: "high" | "medium" | "low";
        readonly sources: ReadonlyArray<{ title: string; url: string }>;
    }>;
    readonly assumptions: ReadonlyArray<{
        readonly assumption: string;
        readonly status: "verified" | "unverified" | "false";
    }>;
    readonly recommendations: ReadonlyArray<string>;
    readonly unansweredQuestions: ReadonlyArray<string>;
}
```

### 3.2 `code-health.ts` — tldr-Powered Analysis Dashboard

**Purpose:** Run multiple tldr analyses on the codebase and produce a readable health report.

**Input:** Path (default: ".")
**Output:** Formatted health dashboard

**Commands executed:**

```typescript
import { execSync } from "node:child_process";

const health = JSON.parse(execSync(`tldr health ${path} --format json`, { encoding: "utf-8" }));
const dead = JSON.parse(execSync(`tldr dead ${path} --format json`, { encoding: "utf-8" }));
const smells = JSON.parse(execSync(`tldr smells ${path} --format json`, { encoding: "utf-8" }));
const deps = JSON.parse(execSync(`tldr deps ${path} --format json`, { encoding: "utf-8" }));
const loc = JSON.parse(execSync(`tldr loc ${path} --format json`, { encoding: "utf-8" }));
```

**Output format:**

```
# Code Health — {path}

## Complexity
- Average cyclomatic: {avg}
- Hotspots: {N} ({top 3 names})
- Cognitive complexity: {avg}

## Dead Code
- Dead functions: {N}
- Possibly dead: {N}
- Dead percentage: {pct}%

## Code Smells
- Long methods: {N}
- Deep nesting: {N}
- Long parameter lists: {N}

## Dependencies
- Total files: {N}
- Internal deps: {N}
- Cycles: {N}

## Lines of Code
- Total: {N}
- Code: {N} ({pct}%)
- Comments: {N} ({pct}%)
```

**Pi APIs used:**

- `pi.registerTool()` — tool registration
- `Type.Object()` — parameter schema

**External CLI:** `tldr` (health, dead, smells, deps, loc)

### 3.3 `bloks.ts` — Knowledge Card Integration

**Purpose:** Bridge between Pi and bloks knowledge card system.

**Functions exported:**

```typescript
// Learn a new finding
export async function bloksLearn(library: string, finding: string, tags?: string[]): Promise<void>;

// Get context cards for current project
export async function bloksContext(): Promise<string>;

// Get specific card
export async function bloksCard(library: string, symbol?: string): Promise<string>;

// Ack a card (mark as helpful)
export async function bloksAck(cardId: string): Promise<void>;

// Nack a card (mark as wrong/outdated)
export async function bloksNack(cardId: string, reason: string): Promise<void>;

// Report a correction
export async function bloksReport(library: string, errorType: string, description: string): Promise<void>;
```

**Tools registered:**

| Tool Name       | Description                                 |
| --------------- | ------------------------------------------- |
| `bloks_learn`   | Save a discovery to knowledge cards         |
| `bloks_context` | Get relevant cards for current task context |
| `bloks_ack`     | Mark a card as helpful                      |
| `bloks_nack`    | Report an incorrect card                    |

**External CLI:** `bloks` CLI commands

### 3.4 `handoff.ts` — Session Serialization & Resume

**Purpose:** Serialize session state for transfer between sessions, and resume from handoff documents.

**Key functions:**

```typescript
// Create handoff from current session
export async function createHandoff(
    ctx: ExtensionCommandContext,
    params: {
        goal: string;
        next: string;
        mental_model: string;
        codebase_state: {
            branch: string;
            dirty_files: string[];
            tests_passing: string;
        };
        findings: {
            critical: string[];
            useful: string[];
        };
        decisions: Array<{
            name: string;
            chose: string;
            over: string[];
            because: string;
        }>;
        next_session_prompt: string;
    },
): Promise<string>; // Returns path to handoff file

// Resume from handoff
export async function resumeHandoff(ctx: ExtensionCommandContext, handoffPath: string): Promise<void>;
```

**Handoff file format:**

```yaml
# Saved as .continuum/handoffs/{session-name}/{date}_{time}.yaml

session: { session-name }
date: { iso-date }
status: complete|partial|blocked
goal: { what was accomplished }
now: { what to do next }
mental_model: |
    {how the system actually works}

codebase_state:
    branch: main
    tests_passing: "45/47"
    dirty_files: [src/auth.ts]

findings:
    critical:
        - "Auth middleware runs before rate limiter"
    useful:
        - "Use `createClient()` for test instances"

decisions:
    - name: "Auth library"
      chose: "Passport"
      over: ["next-auth", "auth.js"]
      because: "Simpler API for token-based auth"

next_session_prompt: |
    Continue implementing the refresh token flow...
```

**Pi APIs used:**

- `ctx.sessionManager.getBranch()` — get current branch entries [pi-docs/session.md]
- `ctx.sessionManager.getSessionFile()` — get session file path [pi-docs/session.md]
- `ctx.newSession()` — create new session with context [pi-docs/extensions.md#L957-990]
- `ctx.switchSession()` — switch to another session [pi-docs/extensions.md#L1035-1078]
- `pi.registerTool()` — tool registration
- `pi.registerCommand()` — command registration

### 3.5 `worker.ts` — Sub-Agent Spawning

**Purpose:** Delegate atomic tasks to worker sub-agents via Pi's Task tool.

**Key function:**

```typescript
export async function spawnWorker(
    ctx: ExtensionCommandContext,
    params: {
        role: "implement" | "research" | "review" | "evolve";
        assertion: { id: string; text: string };
        context: {
            bloks_cards: string; // Verbatim bloks context output
            conventions: string; // Project conventions
            structure: string; // tldr structure output
            prior_report?: string; // Previous worker's report
        };
        bounds: {
            files: string[];
            test_command?: string;
            tdd: boolean;
            commit_after: boolean;
        };
    },
): Promise<{
    result: "success" | "partial" | "blocked";
    report: IWorkerReport;
}>;
```

**Worker spawn pattern using `ctx.sessionManager.newSession()`** ([pi-docs/extensions.md#L957-990]):

```typescript
const result = await ctx.newSession({
    setup: async (sm) => {
        sm.appendMessage({
            role: "user",
            content: [{ type: "text", text: buildWorkerPrompt(params) }],
            timestamp: Date.now(),
        });
    },
    withSession: async (workerCtx) => {
        // Worker sub-session runs with full tool access
        await workerCtx.sendUserMessage(buildWorkerPrompt(params));
        // The worker executes, we wait for completion
    },
});
```

**Worker report format:**

```typescript
interface IWorkerReport {
    readonly task: string;
    readonly assertion: string;
    readonly result: "success" | "partial" | "blocked";
    readonly implemented: string;
    readonly remaining: string;
    readonly tests: {
        readonly added: ReadonlyArray<{ file: string; name: string; verifies: string }>;
        readonly command: string;
        readonly exit_code: number;
    };
    readonly checks: ReadonlyArray<{ command: string; exit_code: number }>;
    readonly bloks_used: ReadonlyArray<{ card: string; helpful: boolean; reason?: string }>;
    readonly corrections: ReadonlyArray<{ block: string; issue: string }>;
    readonly discoveries: ReadonlyArray<{ lib: string; finding: string }>;
    readonly issues: ReadonlyArray<{ severity: string; description: string }>;
    readonly conventions: ReadonlyArray<string>;
}
```

---

## 4. Pipeline Layer (`src/pipeline/`)

### 4.1 `assess.ts` — Task Complexity Classification

**Purpose:** Read the user's task description and classify its complexity.

**Input:** Task description string
**Output:** Classification result

```typescript
export type TaskComplexity = "patch" | "feature" | "multi-feature" | "greenfield";

export interface IAssessResult {
    readonly complexity: TaskComplexity;
    readonly summary: string;
    readonly language?: string;
    readonly framework?: string;
    readonly tldrHealth?: { avgCyclomatic: number; hotspotCount: number };
}
```

**Logic:**

1. Run `tldr health .` to get baseline metrics
2. Parse task description for key terms
3. Determine complexity based on scope indicators
4. Return classification

### 4.2 `plan.ts` — Contract Generation

**Purpose:** Create `contract.json` with assertions and milestones.

**Input:** Task description + complexity classification
**Output:** Path to contract.json

```typescript
export interface IAssertion {
    readonly id: string;
    readonly type: "invariant" | "behavioral" | "contract" | "approval";
    readonly text: string;
    readonly milestone: string;
    readonly status: "pending";
    readonly depends: readonly string[];
    readonly worker: null;
    readonly evidence: null;
}

export interface IMilestone {
    readonly name: string;
    readonly status: "pending";
    readonly assertions: readonly string[];
}

export interface IContract {
    readonly task: string;
    readonly complexity: TaskComplexity;
    readonly milestones: readonly IMilestone[];
    readonly assertions: readonly IAssertion[];
}
```

**Storage:** `.continuum/autonomous/{task-id}/contract.json`

### 4.3 `premortem.ts` — Failure Analysis

**Purpose:** Run premortem analysis on the plan before implementation.

**Input:** Contract + plan
**Output:** Risk assessment with tiger/paper tiger/elephant classification

```typescript
export interface IRisk {
    readonly risk: string;
    readonly evidence: string;
    readonly rootCause: string;
    readonly bias: string;
    readonly falsifiableTest: string;
    readonly mitigation: string;
}

export interface IPremortemResult {
    readonly status: "BLOCK" | "WARN" | "PASS";
    readonly tigers: readonly IRisk[];
    readonly paperTigers: readonly IRisk[];
    readonly elephants: readonly IRisk[];
}
```

### 4.4 `prepare.ts` — Context Front-Loading

**Purpose:** Gather all context needed by workers before they start.

```typescript
export interface IPreparedContext {
    readonly bloksContext: string; // Output of bloks context .
    readonly tldrStructure: string; // Output of tldr structure {path}
    readonly conventions: string; // From AGENTS.md / CLAUDE.md
    readonly priorReports: readonly string[]; // From previous workers
}
```

**Commands:**

```typescript
const bloksCtx = execSync("bloks context .", { encoding: "utf-8", timeout: 10000 });
const structure = execSync(`tldr structure ${affectedPath} --format text`, { encoding: "utf-8", timeout: 10000 });
```

### 4.5 `execute.ts` — Worker Delegation

**Purpose:** Delegate assertions to worker sub-agents, respecting dependency graph.

```typescript
export async function executePipeline(
    ctx: ExtensionCommandContext,
    contract: IContract,
    preparedContext: IPreparedContext,
    signal?: AbortSignal,
): Promise<void> {
    // 1. Sort assertions by dependency order
    // 2. For each assertion, spawn worker via Task tool
    // 3. Track results in contract.json
    // 4. Handle failures with max 2 fix rounds
}
```

**Dependency resolution:**

- Assertions with `depends: []` run first
- Dependents wait for their dependencies to complete
- Independent assertions with disjoint file sets can run in parallel

### 4.6 `validate.ts` — Milestone Validation

**Purpose:** Validate each milestone with automated checks.

```typescript
export interface IValidationResult {
    readonly milestone: string;
    readonly passed: boolean;
    readonly testResults: { command: string; exitCode: number; output: string };
    readonly typecheckResults: { command: string; exitCode: number; output: string };
    readonly lintResults: { command: string; exitCode: number; output: string };
    readonly assertionResults: ReadonlyArray<{
        id: string;
        status: "passed" | "failed";
        evidence: string;
    }>;
}
```

### 4.7 `evolve.ts` — Knowledge Aggregation

**Purpose:** Aggregate worker reports, write to bloks, enforce conventions.

```typescript
export async function evolve(reports: readonly IWorkerReport[]): Promise<{
    corrections: number;
    newCards: number;
    conventionsEnforced: number;
}> {
    // 1. Aggregate corrections from all reports
    // 2. For each correction → bloks report
    // 3. For each discovery → bloks learn
    // 4. For each used card → bloks ack/nack
    // 5. For each convention → suggest enforcement tier
}
```

---

## 5. Shared Modules

### 5.1 `src/readiness.ts` — Project Health Assessment

**Purpose:** Assess project readiness using tldr analysis. Runs 27 criteria across categories.

```typescript
export interface IReadinessReport {
    readonly level: 1 | 2 | 3 | 4 | 5;
    readonly passRate: number;
    readonly categories: ReadonlyArray<{
        readonly name: string;
        readonly score: number;
        readonly criteria: ReadonlyArray<{
            readonly name: string;
            readonly passed: boolean;
            readonly message: string;
        }>;
    }>;
    readonly errorSurface: string;
    readonly failingCriteria: readonly string[];
}
```

**Assessment categories:**

1. **Build System** — package.json, tsconfig, build scripts
2. **Code Quality** — tldr health, complexity, dead code
3. **Testing** — test framework, test files, coverage
4. **Linting** — ESLint config, Prettier config
5. **Type Checking** — TypeScript strict mode
6. **Documentation** — README, AGENTS.md, JSDoc coverage
7. **Git** — .gitignore, git hooks

**Implementation:** Each criterion is a TypeScript check (e.g., `existsSync("tsconfig.json")`), not a shell script.

### 5.2 `src/contract.ts` — Assertion Lifecycle Manager

**Purpose:** Manage contract.json — create, read, update, validate.

```typescript
export class ContractManager {
    constructor(taskId: string);

    create(contract: IContract): Promise<void>;
    read(): Promise<IContract>;
    updateAssertion(id: string, update: Partial<IAssertion>): Promise<void>;
    updateMilestone(name: string, update: Partial<IMilestone>): Promise<void>;
    getPendingAssertions(): Promise<IAssertion[]>;
    getPendingMilestones(): Promise<IMilestone[]>;
    isComplete(): Promise<boolean>;
}
```

### 5.3 `src/knowledge-loop.ts` — Bloks Orchestration

**Purpose:** Orchestrate the knowledge feedback loop between bloks, workers, and evolve.

```typescript
export class KnowledgeLoop {
    // Called in PREPARE phase
    async gatherContext(libraries: string[]): Promise<IPreparedContext>;

    // Called in EXECUTE phase (by workers)
    async reportUsage(bloksUsed: ReadonlyArray<{ card: string; helpful: boolean; reason?: string }>): Promise<void>;

    // Called in EVOLVE phase
    async finalize(reports: readonly IWorkerReport[]): Promise<{
        acks: number;
        nacks: number;
        newCards: number;
        corrections: number;
    }>;
}
```

---

## 6. Skills Layer (`skills/`)

Each skill follows the [Agent Skills standard](pi-docs/skills.md) with frontmatter and markdown instructions.

### 6.1 `skills/bootup/SKILL.md`

**Purpose:** Entry point — assess project readiness and route to workflow.

```markdown
---
name: bootup
description: Assess project readiness and route to autonomous/research/review workflow
user-invocable: true
allowed-tools: [AskUserQuestion, Task, Bash]
---

# Bootup

You are a dispatcher. NEVER implement — delegate everything to tools and workers.

## Flow

1. Run `code_health` tool to assess project health
2. Present readiness level to user
3. Ask: Research (explore), Autonomous (build), or Review (audit)?
4. Route to the corresponding skill
```

### 6.2 `skills/autonomous/SKILL.md`

**Purpose:** Full SDLC pipeline — assess, plan, premortem, prepare, execute, validate, evolve.

```markdown
---
name: autonomous
description: Full SDLC pipeline — plan, execute, validate, evolve
user-invocable: true
allowed-tools: [AskUserQuestion, Task, Bash, Read, Write, Edit]
---

# Autonomous Pipeline

Orchestrate. Never implement. Workers build; you plan, delegate, validate.

## Pipeline

### ASSESS

Run `code_health` to get baseline. Classify complexity: patch/feature/multi-feature/greenfield.

### PLAN

Create contract.json with assertions and milestones. One assertion per atomic task.
Save to `.continuum/autonomous/{task-id}/contract.json`.

### PREMORTEM

Run failure analysis. Identify tigers (BLOCK), paper tigers (WARN), elephants.
Present to user. Get approval before proceeding.

### PREPARE

Run `bloks_context` to gather knowledge cards.
Run `tldr structure` on affected modules.
Inject verbatim into worker prompts.

### EXECUTE

Use `spawn_worker` tool for each assertion.
Respect dependency order. Max 2 fix rounds per assertion.

### VALIDATE

Run tests, typecheck, lint for each milestone.
Update contract.json with results.

### EVOLVE

Aggregate worker reports. Run `bloks_learn` for discoveries.
Run `bloks_ack`/`bloks_nack` for used cards.
Surface recommendations to user.
```

### 6.3 `skills/research/SKILL.md`

**Purpose:** Deep research oracle — decompose, search, synthesize.

```markdown
---
name: research
description: Deep research — decompose questions, search, synthesize findings
user-invocable: true
allowed-tools: [AskUserQuestion, Task, Bash]
---

# Research

Use the `deep_research` tool for structured multi-query investigation.

## Workflow

1. Decompose the question into sub-questions using `deep_research`
2. For each sub-question, review findings
3. Save important discoveries: `bloks_learn`
4. Produce a structured research report
```

### 6.4 `skills/premortem/SKILL.md`

**Purpose:** Pre-implementation failure analysis.

```markdown
---
name: premortem
description: Pre-implementation failure analysis — identify risks before building
user-invocable: true
allowed-tools: [Read, AskUserQuestion]
---

# Premortem

Failure-state projection before implementation.

## Risk Categories

- **Tiger**: Clear threat requiring mitigation — BLOCK
- **Paper Tiger**: Appears threatening but bounded — WARN
- **Elephant**: Avoided systemic issue — WARN

## Analysis Lenses

1. Base assumptions that could lead astray
2. Shortcuts that could become permanent
3. Weak implementations or untested edge cases
4. Missing evaluations
5. Nth-order effects and cascading failures
```

### 6.5 `skills/review/SKILL.md`

**Purpose:** Structural + semantic code review.

```markdown
---
name: review
description: Structural and semantic code review
user-invocable: true
allowed-tools: [Read, Bash, Grep, Glob]
---

# Review

Use `code_health` for structural analysis, then review semantically.

## Process

1. Run `code_health` for baseline metrics
2. Review against contract assertions
3. Check for: regressions, implicit assumptions, security issues
4. Report findings with file:line references
```

### 6.6 `skills/handoff/SKILL.md`

**Purpose:** Create and resume session handoffs.

```markdown
---
name: handoff
description: Create and resume session handoffs for context transfer
user-invocable: true
allowed-tools: [Read, Write, Bash]
---

# Handoff

## Create Handoff

Use `create_handoff` tool to serialize current session state.
Include: mental model, codebase state, findings, next steps.

## Resume Handoff

Use `resume_handoff` tool to read and verify handoff state.
Present synthesis to user, then continue from where it left off.
```

---

## 7. Types

### 7.1 `src/types/pipeline.ts` — Pipeline Types (NEW)

```typescript
/**
 * ──────────────────────────────────────────────
 *  Pipeline Types
 * ──────────────────────────────────────────────
 * Types for the autonomous SDLC pipeline phases,
 * contract system, and worker coordination.
 *
 * @module types/pipeline
 */

// ── Task Classification ────────────────────────

export type TaskComplexity = "patch" | "feature" | "multi-feature" | "greenfield";

export interface IAssessResult {
    readonly complexity: TaskComplexity;
    readonly summary: string;
    readonly language?: string;
    readonly framework?: string;
    readonly baselineHealth?: {
        readonly avgCyclomatic: number;
        readonly hotspotCount: number;
        readonly deadPercentage: number;
        readonly locCode: number;
    };
}

// ── Assertion & Contract ───────────────────────

export type AssertionType = "invariant" | "behavioral" | "contract" | "approval";
export type AssertionStatus = "pending" | "in_progress" | "passed" | "failed";
export type MilestoneStatus = "pending" | "in_progress" | "validated" | "failed";

export interface IAssertion {
    readonly id: string;
    readonly type: AssertionType;
    readonly text: string;
    readonly milestone: string;
    readonly status: AssertionStatus;
    readonly depends: readonly string[];
    readonly worker: string | null;
    readonly evidence: string | null;
}

export interface IMilestone {
    readonly name: string;
    readonly status: MilestoneStatus;
    readonly assertions: readonly string[];
}

export interface IContract {
    readonly task: string;
    readonly complexity: TaskComplexity;
    readonly milestones: readonly IMilestone[];
    readonly assertions: readonly IAssertion[];
    readonly createdAt: string;
    readonly updatedAt: string;
}

// ── Premortem ──────────────────────────────────

export interface IRisk {
    readonly category: "tiger" | "paper-tiger" | "elephant";
    readonly risk: string;
    readonly evidence: string;
    readonly rootCause: string;
    readonly bias: string;
    readonly falsifiableTest: string;
    readonly mitigation: string;
}

export interface IPremortemResult {
    readonly status: "BLOCK" | "WARN" | "PASS";
    readonly risks: readonly IRisk[];
    readonly summary: string;
}

// ── Worker ─────────────────────────────────────

export type WorkerRole = "implement" | "research" | "review" | "evolve";

export interface IWorkerTask {
    readonly role: WorkerRole;
    readonly assertion: { readonly id: string; readonly text: string };
    readonly context: {
        readonly bloksCards: string;
        readonly tldrStructure: string;
        readonly conventions: string;
        readonly priorReport: string | null;
    };
    readonly bounds: {
        readonly files: readonly string[];
        readonly testCommand: string | null;
        readonly tdd: boolean;
        readonly commitAfter: boolean;
    };
}

export interface IWorkerReport {
    readonly task: string;
    readonly assertion: string;
    readonly result: "success" | "partial" | "blocked";
    readonly implemented: string;
    readonly remaining: string;
    readonly tests: {
        readonly added: ReadonlyArray<{ file: string; name: string; verifies: string }>;
        readonly command: string;
        readonly exitCode: number;
    };
    readonly checks: ReadonlyArray<{ command: string; exitCode: number }>;
    readonly bloksUsed: ReadonlyArray<{ card: string; helpful: boolean; reason?: string }>;
    readonly corrections: ReadonlyArray<{ block: string; issue: string }>;
    readonly discoveries: ReadonlyArray<{ lib: string; finding: string }>;
    readonly issues: ReadonlyArray<{ severity: "blocking" | "non-blocking"; description: string }>;
    readonly conventions: readonly string[];
}

// ── Validation ─────────────────────────────────

export interface IValidationResult {
    readonly milestone: string;
    readonly passed: boolean;
    readonly automatedChecks: {
        readonly test: { command: string; exitCode: number };
        readonly typecheck: { command: string; exitCode: number };
        readonly lint: { command: string; exitCode: number };
    };
    readonly assertionResults: ReadonlyArray<{
        id: string;
        status: "passed" | "failed";
        evidence: string;
    }>;
}

// ── Evolve ─────────────────────────────────────

export interface IEvolveResult {
    readonly corrections: ReadonlyArray<{ lib: string; issue: string; action: string }>;
    readonly newCards: number;
    readonly acks: number;
    readonly nacks: number;
    readonly conventionsEnforced: ReadonlyArray<{
        pattern: string;
        tier: "lint" | "type" | "formatter" | "hook" | "ci" | "docs";
        recommendation: string;
    }>;
}
```

### 7.2 Update `src/types/index.ts`

Add barrel re-export for all pipeline types:

```typescript
export type {
    TaskComplexity,
    IAssessResult,
    AssertionType,
    AssertionStatus,
    MilestoneStatus,
    IAssertion,
    IMilestone,
    IContract,
    IRisk,
    IPremortemResult,
    WorkerRole,
    IWorkerTask,
    IWorkerReport,
    IValidationResult,
    IEvolveResult,
} from "./pipeline.js";
```

### 7.3 `src/types/handoff.ts` — Handoff Types (NEW)

```typescript
/**
 * ──────────────────────────────────────────────
 *  Handoff Types
 * ──────────────────────────────────────────────
 * Types for session handoff serialization and resume.
 *
 * @module types/handoff
 */

export interface IHandoffDecision {
    readonly name: string;
    readonly chose: string;
    readonly over: readonly string[];
    readonly because: string;
}

export interface IHandoffDocument {
    readonly session: string;
    readonly date: string;
    readonly status: "complete" | "partial" | "blocked";
    readonly goal: string;
    readonly now: string;
    readonly mentalModel: string;
    readonly codebaseState: {
        readonly branch: string;
        readonly testsPassing: string;
        readonly dirtyFiles: readonly string[];
    };
    readonly doneThisSession: ReadonlyArray<{
        task: string;
        files: readonly string[];
    }>;
    readonly decisions: readonly IHandoffDecision[];
    readonly findings: {
        readonly critical: readonly string[];
        readonly useful: readonly string[];
        readonly fyi: readonly string[];
    };
    readonly hypotheses: ReadonlyArray<{
        status: "active" | "confirmed" | "ruled_out";
        claim: string;
        evidence: readonly string[];
        nextTest: string;
    }>;
    readonly nextSessionPrompt: string;
}
```

---

## 8. Module Reference Index

### 8.1 Pi API References (from `pi-docs/`)

| Symbol                                 | File                    | Line             |
| -------------------------------------- | ----------------------- | ---------------- |
| `pi.registerTool()`                    | `pi-docs/extensions.md` | L1183-1234       |
| `pi.registerCommand()`                 | `pi-docs/extensions.md` | L1338-1373       |
| `pi.on()`                              | `pi-docs/extensions.md` | L1179-1183       |
| `pi.sendMessage()`                     | `pi-docs/extensions.md` | L1234-1257       |
| `pi.sendUserMessage()`                 | `pi-docs/extensions.md` | L1257-1285       |
| `pi.appendEntry()`                     | `pi-docs/extensions.md` | L1285-1302       |
| `pi.setSessionName()`                  | `pi-docs/extensions.md` | L1302-1310       |
| `pi.getCommands()`                     | `pi-docs/extensions.md` | L1373-1406       |
| `pi.setActiveTools()`                  | `pi-docs/extensions.md` | L1449-1475       |
| `ExtensionContext`                     | `pi-docs/extensions.md` | L818-940         |
| `ExtensionCommandContext`              | `pi-docs/extensions.md` | L940-1177        |
| `ctx.newSession()`                     | `pi-docs/extensions.md` | L957-990         |
| `ctx.fork()`                           | `pi-docs/extensions.md` | L990-1016        |
| `ctx.switchSession()`                  | `pi-docs/extensions.md` | L1035-1078       |
| `ctx.reload()`                         | `pi-docs/extensions.md` | L1121-1177       |
| `session_start` event                  | `pi-docs/extensions.md` | L355-367         |
| `session_shutdown` event               | `pi-docs/extensions.md` | L447-459         |
| `tool_call` event                      | `pi-docs/extensions.md` | L640-681         |
| `tool_result` event                    | `pi-docs/extensions.md` | L703-738         |
| `before_agent_start` event             | `pi-docs/extensions.md` | L461-498         |
| `resources_discover` event             | `pi-docs/extensions.md` | L334-351         |
| `SessionManager` API                   | `pi-docs/session.md`    | (entire doc)     |
| `SessionManager.newSession()`          | `pi-docs/session.md`    | Instance Methods |
| `SessionManager.getBranch()`           | `pi-docs/session.md`    | Instance Methods |
| `SessionManager.appendCustomEntry()`   | `pi-docs/session.md`    | Instance Methods |
| `SessionManager.appendMessage()`       | `pi-docs/session.md`    | Instance Methods |
| `SessionManager.buildSessionContext()` | `pi-docs/session.md`    | Instance Methods |
| Skills (SKILL.md) format               | `pi-docs/skills.md`     | (entire doc)     |
| Pi package manifest                    | `pi-docs/packages.md`   | (entire doc)     |
| Settings configuration                 | `pi-docs/settings.md`   | (entire doc)     |

### 8.2 External CLI Tools

| Tool       | Purpose           | Usage                                          |
| ---------- | ----------------- | ---------------------------------------------- |
| `bloks`    | Knowledge cards   | `execSync("bloks learn/context/ack/nack")`     |
| `tldr`     | Code analysis     | `execSync("tldr health/dead/smells/deps/loc")` |
| `fastedit` | Efficient editing | `execSync("fastedit edit/read/search")`        |

### 8.3 Existing Modules (unchanged)

| Module     | File              | Purpose                                      |
| ---------- | ----------------- | -------------------------------------------- |
| Providers  | `src/providers/`  | Exa, Perplexity, Gemini search               |
| Extractors | `src/extractors/` | HTTP, PDF, GitHub, YouTube, video extraction |
| Config     | `src/config/`     | ConfigLoader + validators                    |
| Activity   | `src/activity.ts` | ActivityMonitor singleton                    |
| Storage    | `src/storage.ts`  | Result cache with session restore            |
| Utils      | `src/utils.ts`    | Error parsing, time formatting               |
| Types      | `src/types/`      | All type definitions                         |
| Curator    | `src/curator/`    | Curator server, page, summary                |

---

## 9. Implementation Order

### Phase 1: Foundation (1-2 days)

1. Create `src/tools/bloks.ts` — bloks integration module
2. Create `src/types/pipeline.ts` — pipeline type definitions
3. Update `src/types/index.ts` — add barrel exports
4. Register `bloks_learn` and `bloks_context` tools
5. Test: `pi -e .` → `bloks_learn` works

### Phase 2: Code Health + Deep Research (2-3 days)

1. Create `src/tools/code-health.ts` — tldr wrapper
2. Create `src/tools/deep-research.ts` — research oracle
3. Create `src/tools/worker.ts` — sub-agent spawning
4. Register all new tools
5. Test: `pi -e .` → `code_health`, `deep_research` work

### Phase 3: Handoff System (1-2 days)

1. Create `src/types/handoff.ts` — handoff types
2. Create `src/tools/handoff.ts` — create + resume
3. Register `create_handoff` and `resume_handoff` tools
4. Register `/handoff` and `/resume-handoff` commands
5. Test: handoff creation and resume flow

### Phase 4: Pipeline (3-4 days)

1. Create `src/contract.ts` — assertion lifecycle manager
2. Create `src/readiness.ts` — project health assessment
3. Create `src/knowledge-loop.ts` — bloks orchestration
4. Create `src/pipeline/assess.ts`
5. Create `src/pipeline/plan.ts`
6. Create `src/pipeline/premortem.ts`
7. Create `src/pipeline/prepare.ts`
8. Create `src/pipeline/execute.ts`
9. Create `src/pipeline/validate.ts`
10. Create `src/pipeline/evolve.ts`
11. Register `/bootup`, `/autonomous`, `/research`, `/premortem`, `/review` commands
12. Test: full autonomous pipeline on a small task

### Phase 5: Skills + Polish (1-2 days)

1. Create `skills/bootup/SKILL.md`
2. Create `skills/autonomous/SKILL.md`
3. Create `skills/research/SKILL.md`
4. Create `skills/premortem/SKILL.md`
5. Create `skills/review/SKILL.md`
6. Create `skills/handoff/SKILL.md`
7. Update `package.json` with `pi` manifest
8. Update `AGENTS.md` with new architecture
9. Final testing and publish as Pi package

**Total estimated effort:** 8-13 days

---

## Appendix A: Package Manifest

After all phases are complete, `package.json` will look like:

```json
{
    "name": "continuous-pi",
    "type": "module",
    "private": true,
    "license": "MIT",
    "keywords": ["pi-package"],
    "scripts": {
        "lint": "eslint src",
        "lint:fix": "eslint src --fix",
        "format": "prettier --write .",
        "format:check": "prettier --check ."
    },
    "pi": {
        "extensions": ["./index.ts"],
        "skills": ["./skills"]
    },
    "dependencies": {
        "@mozilla/readability": "^0.5.0",
        "@sinclair/typebox": "^0.34.0",
        "linkedom": "^0.16.0",
        "p-limit": "^6.1.0",
        "turndown": "^7.2.0",
        "unpdf": "^1.4.0"
    },
    "devDependencies": {
        "@eslint/js": "^9.29.0",
        "@types/node": "^25.6.0",
        "eslint": "^9.29.0",
        "eslint-config-prettier": "^10.1.8",
        "eslint-plugin-import-x": "^4.15.0",
        "eslint-plugin-unicorn": "^58.0.0",
        "globals": "^16.2.0",
        "prettier": "^3.8.3",
        "typescript": "^5.7.0",
        "typescript-eslint": "^8.59.0"
    }
}
```

Install command:

```bash
pi install git:github.com/pwnholic/continuous-pi
```

Or for local development:

```bash
mkdir -p .pi
echo '{"extensions":["./index.ts"],"skills":["./skills"]}' > .pi/settings.json
pi
```

---

## Appendix B: Directory Structure (Final)

```
continuous-pi/
├── package.json                  # Pi manifest
├── index.ts                      # Extension entry
├── AGENTS.md                     # Agent guide
├── DESIGN.md                     # This document
├── skills/
│   ├── bootup/SKILL.md
│   ├── autonomous/SKILL.md
│   ├── research/SKILL.md
│   ├── premortem/SKILL.md
│   ├── review/SKILL.md
│   └── handoff/SKILL.md
├── src/
│   ├── index.ts                  # main() — tool handlers
│   ├── activity.ts               # ActivityMonitor
│   ├── storage.ts                # Result cache
│   ├── utils.ts                  # Utilities
│   ├── readiness.ts              # Project health
│   ├── contract.ts               # Assertion lifecycle
│   ├── knowledge-loop.ts         # Bloks orchestration
│   ├── tools/
│   │   ├── web-search.ts         # Web search (existing)
│   │   ├── fetch-content.ts      # Content fetch (existing)
│   │   ├── deep-research.ts      # Research oracle
│   │   ├── code-health.ts        # tldr dashboard
│   │   ├── bloks.ts              # Knowledge cards
│   │   ├── handoff.ts            # Session handoff
│   │   └── worker.ts             # Sub-agent spawn
│   ├── pipeline/
│   │   ├── assess.ts             # Task classification
│   │   ├── plan.ts               # Contract generation
│   │   ├── premortem.ts          # Failure analysis
│   │   ├── prepare.ts            # Context gathering
│   │   ├── execute.ts            # Worker delegation
│   │   ├── validate.ts           # Milestone validation
│   │   └── evolve.ts             # Knowledge aggregation
│   ├── providers/                # Search providers (existing)
│   ├── extractors/               # Content extractors (existing)
│   ├── config/                   # Config loader (existing)
│   ├── types/
│   │   ├── index.ts              # Barrel (updated)
│   │   ├── pipeline.ts           # Pipeline types (NEW)
│   │   ├── handoff.ts            # Handoff types (NEW)
│   │   ├── activity.ts           # Activity types (existing)
│   │   ├── config.ts             # Config types (existing)
│   │   ├── content.ts            # Content types (existing)
│   │   ├── curator.ts            # Curator types (existing)
│   │   ├── provider.ts           # Provider types (existing)
│   │   ├── result.ts             # Result types (existing)
│   │   └── search.ts             # Search types (existing)
│   └── ui/                       # UI formatters (existing)
└── pi-docs/                      # Pi documentation
```
