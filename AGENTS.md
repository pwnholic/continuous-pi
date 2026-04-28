# AGENTS.md

## Code Analysis Tool: `tldr`

You have access to `tldr` — a token-efficient code analysis CLI for LLMs.  
**Always use `tldr` instead of reading raw source files.** It produces structured JSON output at ~95% fewer tokens than dumping file contents.

---

## Setup (if not already running)

```bash
# Check if daemon is running
tldr daemon status

# Start daemon for fast cached queries (35x speedup)
tldr daemon start
tldr warm src/   # pre-warm cache for the project
```

---

## MANDATORY: Use `tldr` for ALL code exploration tasks

Never use `cat`, `grep`, or raw file reading when `tldr` can answer the question. Always prefer `tldr` first.

---

## Command Reference

### 🔍 Explore Structure (start here)

```bash
tldr tree src/                         # File tree overview
tldr structure src/                    # Functions, classes, imports
tldr extract src/auth.py               # Complete module info for one file
tldr imports src/auth.py               # What does this file import?
tldr importers src/utils.py            # What files import this module?
```

### 🔗 Call Graph & Dependencies

```bash
tldr calls src/                        # Cross-file call graph
tldr impact process_data src/          # Who calls this function? (reverse call graph)
tldr dead src/                         # Find dead/unreachable code
tldr hubs src/                         # Most-called hub functions (centrality)
tldr whatbreaks parse_config src/      # What breaks if this function changes?
```

### 🔎 Search & Context

```bash
tldr search "process_data" src/        # BM25 keyword search with structural context
tldr semantic "validate JWT tokens" .  # Natural language search (requires --features semantic)
tldr similar src/auth.py src/          # Find similar code fragments
tldr context login --project .         # LLM-ready summary from entry point (best for context)
tldr definition MyClass src/           # Go-to-definition
tldr explain process_user_input src/   # Comprehensive function analysis
```

### 🌊 Data Flow Analysis

```bash
tldr reaching-defs src/auth.py login   # Reaching definitions
tldr available src/auth.py login       # Available expressions (CSE detection)
tldr dead-stores src/auth.py login     # Dead store detection (SSA-based)
tldr slice src/auth.py login 42        # Backward slice: what affects line 42?
tldr chop src/auth.py login 42         # Forward + backward intersection slice
tldr taint src/auth.py process_input   # Taint flow analysis (injection, XSS)
```

### 🛡️ Security Analysis

```bash
tldr secure src/                       # Full security dashboard
tldr taint src/process.py handle_req   # Taint flows from untrusted input
tldr vuln src/                         # Vulnerability scanning
tldr api-check src/                    # API misuse patterns
tldr resources src/                    # Resource leak detection
```

### 📊 Quality & Metrics

```bash
tldr health src/                       # Full health dashboard (start here)
tldr smells src/                       # Code smells
tldr complexity src/auth.py login      # Cyclomatic complexity
tldr cognitive src/auth.py login       # Cognitive complexity
tldr halstead src/auth.py             # Halstead metrics
tldr loc src/                          # Lines of code
tldr churn src/                        # Git churn analysis
tldr debt src/                         # Technical debt (SQALE)
tldr hotspots src/                     # Churn × complexity (highest-risk files)
tldr clones src/                       # Code clone detection
tldr cohesion src/                     # LCOM4 cohesion metric
tldr coupling src/                     # Afferent/efferent coupling
```

### 🏗️ Architecture & Patterns

```bash
tldr patterns src/                     # Design pattern detection
tldr inheritance src/                  # Class hierarchies
tldr surface src/                      # Public API surface extraction
tldr arch src/                         # Detect architectural layers
```

### ✅ Contracts & Verification

```bash
tldr contracts src/auth.py login       # Pre/postcondition inference
tldr specs src/                        # Extract test specs
tldr invariants src/                   # Infer invariants from tests
tldr verify src/                       # Verification dashboard
tldr interface src/auth.py MyClass     # Interface contracts
```

### 🔧 Aggregated & Utilities

```bash
tldr todo src/                         # Improvement suggestions
tldr diff src/auth.py src/auth_new.py  # AST-aware structural diff
tldr fix src/                          # Diagnose and auto-fix errors
tldr bugbot src/                       # Automated bug detection on changes
tldr change-impact src/                # Which tests need to run after changes?
tldr diagnostics src/                  # Environment and config diagnostics
tldr doctor                            # Check tool environment health
```

---

## Output Formats

```bash
--format json      # Default — structured, machine-readable (use for parsing)
--format text      # Human-readable with colors
--format compact   # Minified JSON for piping
--format sarif     # GitHub / VS Code integration
--format dot       # Graphviz graph visualization
```

---

## Decision Guide: Which Command to Use?

| Task                             | Command                            |
| -------------------------------- | ---------------------------------- |
| "What's in this codebase?"       | `tldr structure src/`              |
| "Understand a specific function" | `tldr explain <function> src/`     |
| "Who calls this function?"       | `tldr impact <function> src/`      |
| "What does this function call?"  | `tldr calls src/`                  |
| "Where is X defined/used?"       | `tldr search "X" src/`             |
| "What affects line N?"           | `tldr slice <file> <func> N`       |
| "Is this code safe?"             | `tldr secure src/`                 |
| "Where are the bugs?"            | `tldr bugbot src/`                 |
| "What's the riskiest code?"      | `tldr hotspots src/`               |
| "What's unused?"                 | `tldr dead src/`                   |
| "Get context for LLM prompt"     | `tldr context <entry> --project .` |
| "Find by behavior, not name"     | `tldr semantic "description" .`    |

---

## Workflow Examples

### Before editing a function

```bash
tldr context my_function --project .   # Get full context
tldr impact my_function src/           # See who calls it
tldr slice src/file.py my_function 42  # Understand data flow to line 42
```

### Before a refactor

```bash
tldr calls src/                        # Map call graph
tldr whatbreaks target_function src/   # Assess blast radius
tldr dead src/                         # Identify safe-to-remove code
```

### Security review

```bash
tldr secure src/                       # Dashboard
tldr taint src/api.py handle_request   # Trace untrusted input
tldr vuln src/                         # Known vulnerability patterns
```

### Code health check

```bash
tldr health src/                       # Overall health
tldr hotspots src/                     # High-churn + high-complexity files
tldr debt src/                         # Technical debt score
```

---

## Always Use Latest Versions

### Language Versions

Always use the **latest stable version** of the project's language. Never suggest or write code targeting an older version unless the project explicitly pins one with a documented reason.

| Language             | How to check latest stable                             |
| -------------------- | ------------------------------------------------------ |
| Python               | `python3 --version` — target **3.13+**                 |
| Node.js / TypeScript | `node --version` — target **LTS (22+)**, TS **5.x**    |
| Rust                 | `rustup update stable` — always use **stable channel** |
| Go                   | `go version` — target **1.23+**                        |
| Java                 | target **Java 21+** (LTS)                              |
| Kotlin               | target **2.x**                                         |
| Swift                | target **Swift 6+**                                    |
| C#                   | target **.NET 9+**                                     |
| Ruby                 | target **3.3+**                                        |
| PHP                  | target **8.3+**                                        |
| Scala                | target **3.x**                                         |
| Elixir               | target **1.17+**                                       |

If the project's runtime/toolchain version is **lower than latest stable**, flag it as a finding and suggest an upgrade path.

### Package / Dependency Versions

- **Never pin to outdated versions.** When adding or updating dependencies, always use the latest stable release.
- **Check for latest before writing any version number** — do not guess or use versions from training data, as they may be stale.

```bash
# Python
pip index versions <package>          # list all versions
pip install <package>==<latest>

# Node.js
npm view <package> version            # latest stable
npm install <package>@latest

# Rust
cargo search <crate>                  # shows latest version
# Use `cargo add <crate>` — it pins to latest automatically

# Go
go get <module>@latest

# Java / Kotlin (Maven)
# Check https://search.maven.org for latest coordinates

# Ruby
gem search <gem> --remote
```

- When writing `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or similar files, **always resolve and insert the actual latest version number** — never write `*`, `latest`, or leave it blank.
- Prefer **exact or tightly-bounded versions** (`^1.2.3` in npm, `~=2.1` in pip, `"1.2.3"` in Cargo) over open ranges.
- After adding a dependency, verify there are **no known CVEs** using `tldr vuln src/` or the package registry's security advisories.

### Version Upgrade Checklist

When touching existing dependencies:

1. Run `tldr smells src/` and `tldr debt src/` — note baseline.
2. Upgrade the dependency.
3. Re-run `tldr vuln src/` — confirm CVE count did not increase.
4. Re-run `tldr health src/` — confirm no quality regression.

---

## Rules

1. **Always run `tldr structure src/` or `tldr tree src/` before exploring an unfamiliar codebase.**
2. **Never read entire files with `cat` when `tldr extract <file>` or `tldr context <entry>` suffices.**
3. **Use `tldr context <entry> --project .` when building context for code generation — it saves the most tokens.**
4. **Use `--format json` when parsing output programmatically.**
5. **Start the daemon (`tldr daemon start`) for any session involving multiple queries on the same codebase.**
6. **When unsure where to start, run `tldr health src/` for a full picture.**
7. **Always use the latest stable language version for the project's ecosystem.**
8. **Always resolve the actual latest package version before writing any dependency file — never guess version numbers.**
9. **Flag any dependency or runtime that is behind the latest stable release as a finding.**
