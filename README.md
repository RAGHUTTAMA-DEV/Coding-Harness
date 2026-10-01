# 🛸 Coding-Harness

An advanced, autonomous, Claude-Code-style AI agent execution loop built completely from scratch in TypeScript and running under **Bun**. 

It natively orchestrates tool-calling, multi-layered context memory, tree-structured session persistence, multi-layer security guardrails, Model Context Protocol (MCP) extensibility, non-destructive workspace snapshots, and a comprehensive agent evaluation benchmark suite without using external agent frameworks (like LangChain or LangGraph).

---

## 📹 Demo

> 🎬 **Watch Coding Harness in Action**:

<video src="https://github.com/user-attachments/assets/3f5fd0eb-9492-4636-aeab-4bb0e74cddf1" controls width="100%"></video>

[🎥 Watch Demo Video](https://github.com/user-attachments/assets/3f5fd0eb-9492-4636-aeab-4bb0e74cddf1)

---

## 📋 Table of Contents

- [📹 Demo](#-demo)
- [✨ Features](#-features)
- [🏗️ High-Level Architecture](#️-high-level-architecture)
- [🧠 Context Management Engine](#-context-management-engine)
  - [1. File Staleness Tracking & Tombstoning](#1-file-staleness-tracking--tombstoning)
  - [2. Microcompaction](#2-microcompaction)
  - [3. LLM Summarization Compaction](#3-llm-summarization-compaction)
  - [4. Ephemeral Prompt Caching](#4-ephemeral-prompt-caching)
  - [5. Workspace Project Memory (`AGENT.md`)](#5-workspace-project-memory-agentmd)
- [💾 Session Management & Tree Persistence](#-session-management--tree-persistence)
  - [1. Append-Only JSONL Tree Storage](#1-append-only-jsonl-tree-storage)
  - [2. Tree Branching & Leaf Pointer Rewinding](#2-tree-branching--leaf-pointer-rewinding)
  - [3. Path Resolution & Context Rebuilding](#3-path-resolution--context-rebuilding)
  - [4. Deferred Disk Flushing](#4-deferred-disk-flushing)
  - [5. Automatic Version Migrations](#5-automatic-version-migrations)
  - [6. Session Discovery & Resumption](#6-session-discovery--resumption)
- [🛡️ Multi-Layer Guardrails & Safety Engine](#️-multi-layer-guardrails--safety-engine)
  - [1. Decision Hierarchy (`DENY` > `ASK` > `ALLOW`)](#1-decision-hierarchy-deny--ask--allow)
  - [2. Path Confinement & Secret File Protection (`PathPolicy`)](#2-path-confinement--secret-file-protection-pathpolicy)
  - [3. Command Inspection & Auto-Approval (`CommandPolicy`)](#3-command-inspection--auto-approval-commandpolicy)
  - [4. Secret Scanner & Redaction (`SecretScanner`)](#4-secret-scanner--redaction-secretscanner)
  - [5. Resource & Payload Protection (`ResourcePolicy`)](#5-resource--payload-protection-resourcepolicy)
  - [6. Network Isolation & Exfiltration Defense (`NetworkPolicy`)](#6-network-isolation--exfiltration-defense-networkpolicy)
  - [7. Interactive Unified Diff Authorization](#7-interactive-unified-diff-authorization)
- [📸 Workspace Snapshots & Checkpoints](#-workspace-snapshots--checkpoints)
  - [1. Non-Destructive Git Plumbing State Capture](#1-non-destructive-git-plumbing-state-capture)
  - [2. File-Based Fallback for Non-Git Workspaces](#2-file-based-fallback-for-non-git-workspaces)
  - [3. Clean Rollback & Safety Snapshots](#3-clean-rollback--safety-snapshots)
  - [4. Full Runtime Checkpoints](#4-full-runtime-checkpoints)
  - [5. Snapshot CLI & REPL Integration](#5-snapshot-cli--repl-integration)
- [🔌 Model Context Protocol (MCP) Integration](#-model-context-protocol-mcp-integration)
  - [1. Dynamic Server Registry (`.mcp.json`)](#1-dynamic-server-registry-mcpjson)
  - [2. JSON-RPC over Stdio Transport](#2-json-rpc-over-stdio-transport)
  - [3. Tool Discovery & Schema Normalization](#3-tool-discovery--schema-normalization)
  - [4. Built-in DuckDuckGo Search Server](#4-built-in-duckduckgo-search-server)
  - [5. MCP Management CLI](#5-mcp-management-cli)
- [📊 Evaluation & Benchmarking Suite](#-evaluation--benchmarking-suite)
  - [1. Task Definition Schema](#1-task-definition-schema)
  - [2. Multi-Dimensional Evaluator Pipeline](#2-multi-dimensional-evaluator-pipeline)
  - [3. Performance Metrics & Structured Reports](#3-performance-metrics--structured-reports)
  - [4. Evaluation CLI](#4-evaluation-cli)
- [🛠️ Tool Ecosystem](#️-tool-ecosystem)
- [🤖 Multi-Provider LLM Support](#-multi-provider-llm-support)
- [🚀 Execution Modes](#-execution-modes)
  - [1. Interactive CLI REPL](#1-interactive-cli-repl)
  - [2. Headless Automation CLI](#2-headless-automation-cli)
  - [3. Parallel vs. Sequential Tool Execution](#3-parallel-vs-sequential-tool-execution)
  - [4. Mid-Run User Steering Intercept](#4-mid-run-user-steering-intercept)
- [⚡ Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Interactive REPL](#running-the-interactive-repl)
  - [Running Headless Automation](#running-headless-automation)
  - [Running Snapshots & Checkpoints](#running-snapshots--checkpoints)
  - [Managing MCP Servers](#managing-mcp-servers)
  - [Running Benchmark Evaluations](#running-benchmark-evaluations)
  - [Running Unit Tests](#running-unit-tests)
- [📁 Repository Structure](#-repository-structure)
- [📜 License](#-license)

---

## ✨ Features

- **💻 Dynamic Interactive CLI REPL**: Live streaming of assistant responses, formatted `💭 Thinking` blocks, tool call parameters, execution results, and runtime token dashboard.
- **⚙️ Headless Mode**: Non-interactive automation entry point that accepts `--task` and `--cwd` and outputs structured JSON results for script/CI integration.
- **🧠 Advanced Context Engineering**: Automatic file read staleness invalidation (tombstoning), tool-call microcompaction, LLM summarization compaction, and `cache_control` breakpoint injection.
- **🌳 Tree-Structured Session Storage**: Append-only JSONL event-log format supporting linear history, parent-pointer branching, leaf rewinding, and session resume capabilities.
- **🛡️ Enterprise-Grade Guardrails**: 5-tier security engine enforcing path traversal prevention, destructive command denial, regex secret scanning with redaction, payload size limits, and socket/network exfiltration defense with live unified diff authorization.
- **📸 Non-Destructive Snapshots & Checkpoints**: Git-plumbing-backed workspace snapshots (using alternate index files without touching working branch or `HEAD`), file-archive fallbacks, clean rollbacks with automatic safety snapshots, and full runtime checkpoints.
- **🔌 Model Context Protocol (MCP)**: Native MCP client support over stdio transport, dynamic `.mcp.json` server registry, schema normalization (including Gemini sanitization), and built-in servers (e.g. DuckDuckGo web search).
- **📊 Benchmarking & Evaluation Suite**: Standardized coding benchmark framework with 9 specialized evaluators (build, typecheck, lint, unit tests, diffs, file rules, security, requirements) and detailed terminal/JSON reporting.
- **🚀 Dual Tool Execution Modes**: Switch dynamically between **Parallel** execution (running independent read/write calls concurrently via `Promise.all`) and **Sequential** execution.
- **📝 Range-Targeted Editing with Drift Recovery**: Line-targeted find-and-replace (`startLine`/`endLine`) with sliding-window offset recovery (±10 lines tolerance) and mismatch diagnostics.
- **🔍 Fast Search Capabilities**: Ripgrep-backed (`rg`) recursive text pattern matching with Bun-glob fallback and wildcard glob scanning.
- **🤖 Provider Agnostic**: Seamlessly switch between local **Ollama** models (`qwen3:14b`, `qwen3:8b`, `llama3.1:8b`) and cloud **Gemini** models (`gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.5-flash`).
- **🛰️ Read-Only Sub-Agent Dispatch**: Isolated sub-agent worker context for performing background research without mutating workspace files.

---

## 🏗️ High-Level Architecture

The framework is decoupled into modular layers, separating execution control, context lifecycle, persistence, safety guardrails, MCP extensibility, snapshots, evaluation, and model connectivity:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CLI Layer                                        │
│  Interactive REPL │ Headless Runner │ MCP CLI │ Snapshot/Checkpoint CLI │ Evaluation CLI │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │   Agent Core    │
                                   │ (src/agent.ts)  │
                                   └────────┬────────┘
                                            │
        ┌────────────────────┬──────────────┼──────────────┬───────────────────┐
        │                    │              │              │                   │
┌───────▼────────┐   ┌───────▼──────┐ ┌─────▼───────┐ ┌────▼─────────────┐ ┌───▼────────────┐
│ ContextManager │   │ SessionStore │ │PolicyEngine │ │ SnapshotManager  │ │   McpManager   │
│ - History      │   │ - JSONL Tree │ │ - Path      │ │ - Git Plumbing   │ │ - Stdio Client │
│ - Tombstoning  │   │ - Branching  │ │ - Command   │ │ - Rollback Engine│ │ - Tool Adapter │
│ - Compaction   │   │ - Path Resolv│ │ - Secret    │ │ - Checkpoints    │ │ - .mcp.json Reg│
└───────┬────────┘   └──────────────┘ │ - Resource  │ └──────────────────┘ └────────┬───────┘
        │                             │ - Network   │                               │
        │                             └─────────────┘                               │
        │                                   │                                       │
        │                    ┌──────────────▼────────────────┐                      │
        ├───────────────────►│         ToolRegistry          │◄─────────────────────┘
        │                    │  - 13 Built-in Core Tools     │
        │                    │  - Dynamic MCP Tools          │
        │                    └──────────────┬────────────────┘
        │                                   │
        │                    ┌──────────────┴───────────────┐
        │                    │                              │
        │           ┌────────▼────────┐            ┌────────▼────────┐
        │           │ Sub-Agent Engine│            │ Tool Execution  │
        │           │  (Read-only)    │            │ Sequential /    │
        │           └─────────────────┘            │ Parallel        │
        │                                          └─────────────────┘
┌───────▼────────────────────────────────────────────────────────────────────────────────┐
│                               ChatModelClient Interface                                │
│                OllamaClient (Local)       │        GeminiClient (API)                  │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │   Eval Runner   │
                                   │ (9 Evaluators)  │
                                   └─────────────────┘
```

---

## 🧠 Context Management Engine

The `ContextManager` (`src/context/contextManager.ts`) handles memory representation, context limits, and message cleanup across turns.

### 1. File Staleness Tracking & Tombstoning
When a tool modifies a file (`write_file` or `edit_file`), any earlier `read_file` output for that same file path residing in message history becomes outdated and potentially misleading to the model. 

- `ContextManager.invalidateStaleReads(mutatedPath)` scans history for past `read_file` tool results matching the mutated file.
- It overwrites the old content with a tombstone message:
  ```
  [File content of <path> has been modified by a subsequent edit/write tool call. This read result is now stale and has been invalidated to save context space.]
  ```
- **Benefits**: Prevents context window bloat, eliminates stale code references, and reduces token cost.

### 2. Microcompaction
Continuous passive optimization (`microcompact()` in `src/context/compaction.ts`) runs before every turn. It scans history and deduplicates redundant tool operations (such as repeated identical file reads or superseded checks), replacing duplicated payload blocks with compact references.

### 3. LLM Summarization Compaction
When total session tokens exceed the configured threshold (default: **8,000 tokens**):
1. `compactIfNeeded()` invokes `summarizeHistory()`.
2. The LLM summarizes the oldest 50% of the message transcript into a structured system summary block.
3. The original old turns are removed from the active context window, and the summary is inserted as a system block.
4. Active tool call/result pairing structures are preserved to maintain model validation constraints.

### 4. Ephemeral Prompt Caching
`ContextManager.getPayload()` automatically attaches `cache_control: { type: "ephemeral" }` metadata to:
- The base System Prompt (containing runtime environmental rules and tool specifications).
- The `AGENT.md` Project Memory block.

This enables models supporting prompt caching (e.g. Anthropic / Gemini) to skip redundant prompt processing overhead across chat turns.

### 5. Workspace Project Memory (`AGENT.md`)
At startup, `Agent` checks for an `AGENT.md` file in the workspace root. If present, its contents are injected into system context as persistent project memory (coding conventions, architecture guidelines, forbidden files).

---

## 💾 Session Management & Tree Persistence

Session persistence (`src/session/sessionStore.ts`) uses an append-only JSONL format to guarantee crash-resilient storage and support non-linear conversation branching.

### 1. Append-Only JSONL Tree Storage
Sessions are saved in `~/.harness/agent/session/--<encoded-cwd>--/<sessionId>.jsonl`. 

Each line in the file represents a single `SessionEntry` with strict metadata:
```typescript
export interface BaseEntry {
  id: string;          // Unique entry UUID/timestamp identifier
  parentId: string | null; // Pointer to preceding entry ID
  timestamp: string;   // ISO timestamp
}
```

#### Supported Entry Types:
- `SessionMessageEntry`: User, assistant, or tool interaction messages.
- `ThinkingLevelChangeEntry`: Model thinking parameter changes.
- `ModelChangeEntry`: Model or provider switches.
- `CompactionEntry`: System summary generated during context compaction.
- `BranchSummaryEntry`: Context state preserved when creating alternative branches.
- `CustomEntry` / `CustomMessageEntry`: Metadata extensions and hook payload data.
- `LabelEntry` / `SessionInfoEntry`: User annotations and session summaries.

### 2. Tree Branching & Leaf Pointer Rewinding
Because every entry explicitly references a `parentId`, history forms a Directed Acyclic Graph (DAG) / Tree:

```
           ┌─── Entry 3 (Branch A) ─── Entry 4A
Entry 1 ── Entry 2
           └─── Entry 3 (Branch B) ─── Entry 4B  <-- leafId
```

- **`branch(branchFromId)`**: Rewinds the session's active `leafId` back to an earlier entry. Subsequent entries are appended as children of `branchFromId`, creating a side branch without altering original history.
- **`branchWithSummary(branchFromId, summary)`**: Creates a branch and records a `BranchSummaryEntry` capturing context from the abandoned branch.
- **`resetLeaf()`**: Rewinds the leaf pointer to root, allowing full conversation restarts.

### 3. Path Resolution & Context Rebuilding
When preparing messages to send to the LLM:
1. `buildSessionPath(entries, leafId)` starts at `leafId` and walks backwards via `parentId` pointers to the root. It reverses the list to reconstruct the active linear path.
2. `buildContextEntries(path)` inspects the resolved path for any `CompactionEntry`. If found, it drops raw messages prior to `firstKeptEntryId` and prefixes context with the compaction summary.
3. `sessionEntryToContextMessages()` converts the entries into standard model `Message` objects.

### 4. Deferred Disk Flushing
To prevent creating empty session files when users open and immediately close the CLI, `Session` uses deferred flushing:
- New sessions accumulate entries in memory (`flushed = false`).
- Disk creation and bulk writing (`flush()`) occur only when the **first assistant message** is generated.
- After flushing, subsequent entries are appended synchronously (`fs.appendFileSync`).

### 5. Automatic Version Migrations
Session files include a `version` header and automatically upgrade legacy formats upon loading:
- **v1 → v2**: Upgrades flat message arrays to tree nodes (`id`, `parentId`) and converts index pointers to entry IDs.
- **v2 → v3**: Normalizes legacy roles (`hookMessage` → `custom`).

### 6. Session Discovery & Resumption
- `SessionStore.getLatestSessionId()` reads `latest_id.txt` to identify the most recent session for the current workspace.
- The REPL CLI automatically detects existing sessions and prompts the user to resume or start fresh upon launch.
- Dynamic `/models` changes, `/mode` toggling, `/session list|switch|new|clear`, and `clear` commands immediately sync session state.

---

## 🛡️ Multi-Layer Guardrails & Safety Engine

The Guardrail subsystem (`src/guardrails/`) provides strict, multi-tiered safety gating for all agent actions. Rather than a basic binary prompt, it enforces granular security policies before any tool execution occurs.

### 1. Decision Hierarchy (`DENY` > `ASK` > `ALLOW`)
When a tool is invoked, `PolicyEngine` evaluates the action against all active policies concurrently:
- **`DENY` (Critical / Terminal)**: If any policy issues a `DENY`, execution is immediately aborted with an explanation. `DENY` takes absolute precedence over `ASK` and `ALLOW`, bypassing `autoConfirm`.
- **`ASK` (Interactive Prompt)**: Requires explicit user confirmation `[y/N]`. In headless mode with `autoConfirm: true`, safe `ASK` decisions are auto-approved while logging risk levels.
- **`ALLOW` (Automatic)**: Low-risk, non-destructive operations proceed without user intervention.

### 2. Path Confinement & Secret File Protection (`PathPolicy`)
- **Directory Traversal Defense**: Blocks path traversal attacks (`../`, `/etc/passwd`, root escaping) attempting to operate outside the workspace root.
- **Sensitive File Shielding**: Blocks reading or modifying critical secrets, credentials, and environment configuration:
  - `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `.aws/credentials`.

### 3. Command Inspection & Auto-Approval (`CommandPolicy`)
- **Auto-Approve Safe Read Commands**: Safe commands (`git status`, `git log`, `git diff`, `ls`, `dir`, `bun test`, `npm test`) are auto-approved.
- **Confirm Mutating Commands**: Modifications (`npm install`, `git commit`, `git push`, build commands) require confirmation.
- **Strictly Block Dangerous Commands**: Destructive system calls (`rm -rf`, `mkfs`, fork bombs, system privilege escalation) are strictly denied.

### 4. Secret Scanner & Redaction (`SecretScanner`)
- Uses regex pattern matching to detect hardcoded secrets in tool parameters, generated code, and file writes.
- Detects API keys (OpenAI, Anthropic, Gemini, GitHub tokens, AWS access keys, private RSA keys, Bearer tokens).
- Automatically redacts exposed tokens before logging or sending to models and triggers authorization warnings.

### 5. Resource & Payload Protection (`ResourcePolicy`)
- Enforces maximum payload thresholds on file writes and edits (e.g. 500 KB limit).
- Prevents buffer overflow and denial-of-service from runaway tool calls or excessively large command line inputs.

### 6. Network Isolation & Exfiltration Defense (`NetworkPolicy`)
- Detects and strictly denies reverse shell patterns (e.g. `nc -e`, `bash -i >& /dev/tcp`, `telnet`).
- Blocks credential exfiltration payloads attempting to curl or post sensitive environment variables to remote endpoints.
- Whitelists safe local network endpoints (`localhost`, `127.0.0.1`) while gating unlisted outbound hostnames.

### 7. Interactive Unified Diff Authorization
When a write or edit tool requires user approval in interactive REPL mode, the policy engine computes a line-by-line unified diff and prints a colorized preview in the terminal before prompting:
```text
⚠️  Guardrail Authorization Request [HIGH Risk]
Reason:    Mutating workspace file
Tool:      edit_file
Arguments: { "path": "src/auth.ts", ... }

--- Diff Preview ---
- const secret = "hardcoded_token";
+ const secret = process.env.AUTH_SECRET;
--------------------

Authorize this action? [y/N]:
```

---

## 📸 Workspace Snapshots & Checkpoints

The Snapshots subsystem (`src/snapshots/` and `SNAPSHOTS.md`) provides atomic, non-destructive state capture and rollback capabilities for autonomous coding agents.

### 1. Non-Destructive Git Plumbing State Capture
Rather than creating intrusive git branches or lossy stashes:
- Uses an isolated alternate index file (`GIT_INDEX_FILE`).
- Writes tree and commit objects directly to Git's object database.
- Updates snapshot references under `refs/harness/snapshots/<id>`.
- **Zero Working Tree Contamination**: Never alters the user's active branch, working index, or `HEAD`.
- Automatically excludes secrets (`.env`), build directories (`dist`, `node_modules`, `coverage`), and private keys.

### 2. File-Based Fallback for Non-Git Workspaces
For directories that are not Git repositories, `SnapshotStore` falls back to an automated tar/file archive strategy under `.harness/snapshots/` with identical metadata and rollback semantics.

### 3. Clean Rollback & Safety Snapshots
When rolling back to a previous snapshot:
1. Automatically takes a **Safety Snapshot** before modifying any files, ensuring every rollback can be undone.
2. Restores modified and deleted files to their exact previous state.
3. Automatically detects and deletes untracked files created by the agent after the snapshot.

### 4. Full Runtime Checkpoints
Checkpoints encapsulate both the workspace files and the complete agent execution state:
- Workspace file snapshot reference
- Full conversation message history
- Active task and plan
- Evaluation state and metrics

### 5. Snapshot CLI & REPL Integration
- **Standalone CLI**:
  ```bash
  bun run snapshot create "Pre-refactor checkpoint"
  bun run snapshot list
  bun run snapshot diff <snapshot-id>
  bun run snapshot restore <snapshot-id>
  ```
- **REPL Slash Commands**:
  - `/snapshot create [desc]`, `/snapshot list`, `/snapshot restore <id>`, `/snapshot diff <id>`
  - `/checkpoint create [desc]`, `/checkpoint list`, `/checkpoint restore <id>`
- **Agent Built-in Tools**:
  - `create_checkpoint`: Agent automatically creates checkpoints prior to risky refactoring.
  - `rollback_checkpoint`: Restores workspace and context if verification tests fail.
  - `list_checkpoints`: Discovers available restore points.

---

## 🔌 Model Context Protocol (MCP) Integration

The harness natively implements an MCP client (`src/mcp/`) following the standard JSON-RPC 2.0 specification over stdio transport.

### 1. Dynamic Server Registry (`.mcp.json`)
Manage external tool providers through a project-level `.mcp.json` configuration file:
```json
{
  "mcpServers": {
    "duckduckgo": {
      "command": "bun",
      "args": ["run", "src/mcp/servers/duckduckgo.ts"]
    }
  }
}
```

### 2. JSON-RPC over Stdio Transport
- Spawns subprocesses and establishes standard bidirectional stdio channels.
- Full protocol lifecycle: Handshake initialization (`initialize`), capability negotiation, tool discovery (`tools/list`), and execution (`tools/call`).
- Built-in request timeouts, automatic error classification, and connection recovery.

### 3. Tool Discovery & Schema Normalization
- Discovered MCP tools are adapted seamlessly into native harness `Tool` definitions.
- Automatic schema normalization: Cleans unsupported JSON Schema constructs and strips incompatible metadata (e.g. `x-mcp-header` for Google Gemini models).
- MCP tool execution passes through the Guardrails `PolicyEngine` before reaching the external server.

### 4. Built-in DuckDuckGo Search Server
Includes an out-of-the-box MCP server (`src/mcp/servers/duckduckgo.ts`) providing live web search results with link scraping and markdown extraction without requiring external API keys.

### 5. MCP Management CLI
```bash
# List configured servers
bun run mcp list

# Connect to servers and display discovered tools
bun run mcp tools

# Register a new MCP server
bun run mcp add <server-id> <command> [args...]

# Test connection and tool discovery
bun run mcp test <server-id>

# Remove an MCP server
bun run mcp remove <server-id>
```

---

## 📊 Evaluation & Benchmarking Suite

The Evaluation framework (`src/evals/` and `src/cli/eval.ts`) allows rigorous benchmarking and grading of autonomous agent runs across realistic engineering tasks.

### 1. Task Definition Schema
Tasks are organized in benchmark datasets (e.g. `evals/datasets/coding-harness-v1/`):
- **Categories**: `bug-fix`, `feature`, `refactor`, `debugging`, `testing`, `security`, `repo-navigation`, `multi-step`.
- **Difficulty**: Graduated difficulty tiers (`L1` to `L5`).
- **Hidden Tests & Constraints**: Optional hidden validation suites and forbidden path/command constraints.

```json
{
  "id": "BUG-001",
  "category": "bug-fix",
  "difficulty": "L1",
  "description": "Fix off-by-one error in search pagination",
  "prompt": "Fix pagination offset handling so the last page does not duplicate records.",
  "verification": {
    "testCommand": "bun test src/search.test.ts"
  }
}
```

### 2. Multi-Dimensional Evaluator Pipeline
Runs a battery of specialized evaluators against the final workspace state:
1. `build`: Verifies project build compilation.
2. `typecheck`: Runs TypeScript/language compiler checks.
3. `lint`: Ensures code adhering to linting rules.
4. `tests`: Executes unit and integration test suites.
5. `diff`: Computes file additions, modifications, and deletion ratios.
6. `files`: Enforces required and forbidden path boundaries.
7. `requirements`: Evaluates specific functional requirements.
8. `security`: Verifies that no credentials leaked and no guardrail violations occurred.

### 3. Performance Metrics & Structured Reports
Tracks granular operational metrics for each benchmark run:
- Total iterations & tool calls
- Token consumption (prompt + completion)
- Wall-clock execution duration
- Files modified
- Rollback & recovery attempts
- Guardrail blocks triggered
- Detailed console reports and `--json` machine-readable outputs

### 4. Evaluation CLI
```bash
# List benchmark tasks in dataset
bun run eval list

# Run all tasks in the benchmark suite
bun run eval run

# Run specific task or category
bun run eval run --task BUG-001
bun run eval run --category bug-fix

# Run and output machine-readable JSON results
bun run eval run --json

# View report for a previous run
bun run eval report <run-id>
```

---

## 🛠️ Tool Ecosystem

The harness provides 13 core built-in tools in `src/tools/`, plus dynamically registered MCP tools:

| Tool Name | Type | Description |
|---|---|---|
| `read_file` | Read-only | Reads text files with line numbering, offset paging, and line range slicing. |
| `write_file` | Mutating | Creates new files or overwrites existing files completely. Gated by Guardrails. |
| `edit_file` | Mutating | Range-targeted find-and-replace using `startLine`/`endLine`, with sliding-window drift recovery (±10 lines tolerance) and exact line mismatch diagnostics. |
| `run_command` | Mutating | Executes shell commands on the host machine. Gated by PolicyEngine permission checks. |
| `check_syntax` | Read-only | Validates JavaScript/TypeScript files using Bun's internal bundler compiler to report syntax errors prior to execution. |
| `glob` | Read-only | Performs fast wildcard pattern file and directory scanning across the workspace. |
| `grep` | Read-only | Executes workspace text searches using system `ripgrep` (`rg`) with a native Bun glob fallback. |
| `todo_read` | Read-only | Reads the persistent checklist file (`.todo.md`). |
| `todo_write` | Mutating | Updates and manages the project task checklist (`.todo.md`). |
| `dispatch_subagent` | Read-only | Spawns an isolated, read-only sub-agent to perform deep research tasks without file mutation access. |
| `create_checkpoint` | Mutating | Creates a snapshot and saves the full runtime context (messages, task, plan) before risky edits. |
| `rollback_checkpoint` | Mutating | Restores both workspace files and conversation history back to a previous checkpoint. |
| `list_checkpoints` | Read-only | Lists all saved checkpoints with reasons and descriptions. |
| *MCP Tools* | Dynamic | Discovered from configured MCP servers (e.g. `duckduckgo_search`). |

---

## 🤖 Multi-Provider LLM Support

The harness abstracts LLM integrations behind a unified `ChatModelClient` interface (`src/providers/types.ts`):

```typescript
export interface ChatModelClient {
  chatStream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: { content: string; thinking: string; toolCalls: ToolCall[] }) => void
  ): Promise<Message>;
}
```

### Supported Providers:
1. **Ollama (`src/providers/ollama.ts`)**:
   - Native streaming, thinking tag extraction (`<think>...</think>`), raw tool payload parsing, and token usage reporting.
   - Built-in support for `qwen3:14b`, `qwen3:8b`, and `llama3.1:8b`.
2. **Gemini (`src/providers/gemini.ts`)**:
   - Google Generative AI REST API streaming integration.
   - Handles thought signatures (`thought_signature`), structured tool declarations, and schema sanitization.
   - Built-in support for `gemini-1.5-flash`, `gemini-1.5-pro`, and `gemini-2.5-flash`.

Model switching can be done interactively during REPL sessions using the `/models` command.

---

## 🚀 Execution Modes

### 1. Interactive CLI REPL
Launch using `bun start` or `bun run src/cli/repl.ts`:
- Features colored streaming responses and thinking visualization.
- Displays live tool invocation summaries, diff previews, and execution results.
- Includes interactive command shortcuts:
  - `/models`: Interactive model selection menu.
  - `/mode`: Toggle between `parallel` and `sequential` tool execution.
  - `/session`: Session management (`/session list`, `/session switch <name>`, `/session new`, `/session clear`).
  - `/snapshot`: Workspace snapshots (`/snapshot create`, `/snapshot list`, `/snapshot restore <id>`, `/snapshot diff <id>`).
  - `/checkpoint`: Full runtime checkpoints (`/checkpoint create`, `/checkpoint list`, `/checkpoint restore <id>`).
  - `clear`: Reset history and delete current session.
  - `exit` / `quit`: Terminate the REPL.
- Displays token usage metrics and context window percentage after every turn.

### 2. Headless Automation CLI
Launch using `bun run src/cli/headless.ts`:
```bash
bun run src/cli/headless.ts --task "Fix bug in search parser" --cwd "/path/to/repo" --max-iterations 30
```
- Redirects logs to `stderr` and prints clean JSON results to `stdout`:
```json
{
  "status": "success",
  "output": "Task completed successfully...",
  "filesChanged": ["src/parser.ts"]
}
```

### 3. Parallel vs. Sequential Tool Execution
The `Agent` loop supports two tool execution modes:
- **Parallel Mode (Default)**: When the model outputs multiple tool calls in a single turn, permissions are checked sequentially, and all approved tool executions run concurrently via `Promise.all`.
- **Sequential Mode**: Executes tool calls one by one in serial order.

### 4. Mid-Run User Steering Intercept
Pressing `Ctrl+C` (`SIGINT`) while the agent is running tool cycles triggers mid-run steering:
- The agent loop pauses after the current tool execution completes.
- Prompts the user for a steering instruction: `steer instruction (or press Enter to resume)>`.
- Injects `[User Steering Instruction]: <input>` into conversation history without destroying session context.
- Pressing `Ctrl+C` a second time forces an immediate program exit.

---

## ⚡ Quick Start

### Prerequisites

1. Install **Bun** (v1.0+):
   ```bash
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
2. Install and launch **Ollama** (optional if using Gemini API key):
   ```bash
   ollama pull qwen3:14b
   ollama serve
   ```
3. (Optional) Configure Gemini API key in `src/.env` or project root `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

### Installation

```bash
git clone https://github.com/raghuttama-dev/Coding-harness.git
cd Coding-harness
bun install
```

### Running the Interactive REPL

```bash
bun start
```

### Running Headless Automation

```bash
bun run src/cli/headless.ts --task "Refactor search utility to use async/await" --cwd "."
```

### Running Snapshots & Checkpoints

```bash
# Capture workspace snapshot
bun run snapshot create "Pre-refactoring state"

# List snapshots
bun run snapshot list

# Diff workspace against snapshot
bun run snapshot diff <snapshot-id>

# Restore workspace
bun run snapshot restore <snapshot-id>
```

### Managing MCP Servers

```bash
# List configured servers
bun run mcp list

# Discover tools from active servers
bun run mcp tools

# Test server connection
bun run mcp test duckduckgo
```

### Running Benchmark Evaluations

```bash
# List benchmark tasks
bun run eval list

# Run evaluation suite
bun run eval run

# Run specific task with JSON output
bun run eval run --task BUG-001 --json
```

### Running Unit Tests

Execute the Vitest-compatible Bun test suite covering tools, context compaction, staleness tracking, session storage, guardrails, MCP, snapshots, and evals:

```bash
bun test
```

---

## 📁 Repository Structure

```
Coding-harness/
├── src/
│   ├── agent.ts                  # Core execution loop, steering, and turn orchestrator
│   ├── client.ts                 # Provider export bridge
│   ├── cli/
│   │   ├── repl.ts               # Interactive terminal REPL interface
│   │   ├── headless.ts           # Non-interactive JSON automation CLI entry point
│   │   ├── snapshot.ts           # Snapshot & Checkpoint management CLI
│   │   ├── mcp.ts                # Model Context Protocol CLI
│   │   └── eval.ts               # Benchmark evaluation runner CLI
│   ├── context/
│   │   ├── contextManager.ts     # History state, staleness tombstoning, token tracking
│   │   └── compaction.ts         # Microcompaction & LLM summarization compaction
│   ├── guardrails/
│   │   ├── index.ts              # Guardrail exports
│   │   ├── types.ts              # Guardrail context, policy, and decision contracts
│   │   ├── policyEngine.ts       # Coordinator enforcing DENY/ASK/ALLOW and diff preview
│   │   ├── pathPolicy.ts         # Directory traversal and sensitive file shielding
│   │   ├── commandPolicy.ts      # Command classification (safe / mutate / destructive)
│   │   ├── secretScanner.ts      # Regex credential detection and token redaction
│   │   ├── resourcePolicy.ts     # Payload size and argument length limits
│   │   └── networkPolicy.ts      # Reverse shell defense and socket isolation
│   ├── snapshots/
│   │   ├── index.ts              # Snapshot exports
│   │   ├── types.ts              # Snapshot & Checkpoint type definitions
│   │   ├── snapshotManager.ts    # Coordinator for snapshots, checkouts, and diffs
│   │   ├── snapshotStore.ts      # Git plumbing & file archive storage engine
│   │   ├── rollback.ts           # Clean rollback & safety snapshot generator
│   │   └── diff.ts               # Unified diff & LCS comparator
│   ├── mcp/
│   │   ├── index.ts              # MCP client exports
│   │   ├── types.ts              # JSON-RPC & MCP protocol types
│   │   ├── client.ts             # Stdio transport JSON-RPC client
│   │   ├── manager.ts            # Multi-server connection & lifecycle manager
│   │   ├── serverRegistry.ts     # .mcp.json persistent server configuration
│   │   ├── toolAdapter.ts        # Adapts MCP tools to native harness Tool contracts
│   │   └── servers/
│   │       └── duckduckgo.ts     # Built-in DuckDuckGo search MCP server
│   ├── evals/
│   │   ├── types.ts              # Benchmark task schema, metrics, and evaluator types
│   │   ├── taskLoader.ts         # Dataset task discovery and parser
│   │   ├── evalRunner.ts         # Benchmark execution orchestrator
│   │   ├── evaluatorRegistry.ts  # Registry of evaluation criteria
│   │   ├── execHelper.ts         # Isolated task execution runner
│   │   ├── evaluators/           # Evaluator implementations
│   │   │   ├── build.ts          # Project build verification
│   │   │   ├── typecheck.ts      # Type-check compiler validation
│   │   │   ├── lint.ts           # Code style linter checks
│   │   │   ├── tests.ts          # Unit and integration test verification
│   │   │   ├── diff.ts           # Patch and file change inspection
│   │   │   ├── files.ts          # Required/forbidden file constraint validation
│   │   │   ├── requirements.ts   # Requirement specification matching
│   │   │   └── security.ts       # Guardrail & secret leak validation
│   │   └── reports/
│   │       └── reportGenerator.ts # Terminal & JSON evaluation report formatter
│   ├── permissions/
│   │   └── permissionGate.ts     # Backward-compatible permission gate bridge
│   ├── providers/
│   │   ├── types.ts              # ChatModelClient, Message, and ToolCall interface types
│   │   ├── ollama.ts             # Ollama API client implementation
│   │   └── gemini.ts             # Gemini REST API client implementation
│   ├── session/
│   │   └── sessionStore.ts       # Append-only JSONL tree persistence, branching, and migrations
│   ├── tools/
│   │   ├── index.ts              # Unified ToolRegistry (13 built-ins + MCP)
│   │   ├── read.ts               # Range-sliced file reader with line numbers
│   │   ├── write.ts              # File creator and overwriter
│   │   ├── edit.ts               # Targeted find-replace editor with sliding drift recovery
│   │   ├── bash.ts               # Command execution tool
│   │   ├── checkSyntax.ts        # JS/TS syntax validator (Bun build compiler)
│   │   ├── glob.ts               # Wildcard pattern file scanner
│   │   ├── grep.ts               # Ripgrep-backed workspace search tool
│   │   ├── todo.ts               # Task list checklist management (.todo.md)
│   │   ├── subagent.ts           # Read-only background sub-agent dispatcher
│   │   ├── checkpoint.ts         # Checkpoint tools (create, rollback, list)
│   │   ├── activeClient.ts       # Active LLM client reference container
│   │   └── types.ts              # Tool interface contracts
│   └── tests/
│       ├── context.test.ts       # Staleness and compaction test suite
│       ├── executionMode.test.ts # Parallel vs sequential mode test suite
│       ├── gemini.test.ts        # Gemini provider test suite
│       ├── search.test.ts        # Glob and Grep test suite
│       ├── tools.test.ts         # File edit, read, syntax, and todo tool test suite
│       ├── v4.test.ts            # Session tree, diff, policy engine, and subagent test suite
│       ├── guardrails.test.ts    # Guardrails 5-policy comprehensive test suite
│       ├── mcp.test.ts           # MCP client, registry, adapter, and server test suite
│       ├── snapshots.test.ts     # Git plumbing snapshots and rollback test suite
│       └── evals.test.ts         # Evaluation framework test suite
├── evals/
│   └── datasets/
│       └── coding-harness-v1/    # Benchmark evaluation dataset
├── AGENT.md                      # Workspace project memory rules file
├── SNAPSHOTS.md                  # Workspace snapshots & checkpoints specification
├── agent-harness-architecture.md # Architecture specification document
├── pi-agent-session-storage.md   # Session storage specification document
├── package.json                  # Dependencies and run scripts
└── tsconfig.json                 # TypeScript compiler configuration
```

---

## 📜 License

MIT License. Built for autonomous AI agent research and development.
