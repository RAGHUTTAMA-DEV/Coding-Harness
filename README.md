# 🛸 Coding-Harness

An advanced, autonomous, Claude-Code-style AI agent execution loop built completely from scratch in TypeScript and running under **Bun**. 

It natively orchestrates tool-calling, multi-layered context memory, tree-structured session persistence, and permission gating without using external agent frameworks (like LangChain or LangGraph).

---

## 📹 Demo

> 🎬 **Watch Coding Harness in Action**:

<video src="https://raw.githubusercontent.com/RAGHUTTAMA-DEV/Coding-Harness/main/assets/Coding-Harness.mp4" controls width="100%"></video>

[🎥 Watch Demo Video (assets/Coding-Harness.mp4)](https://raw.githubusercontent.com/RAGHUTTAMA-DEV/Coding-Harness/main/assets/Coding-Harness.mp4)

---

## 📋 Table of Contents

- [📹 Demo](#-demo)
- [✨ Features](#-features)
- [🏗️ High-Level Architecture](#️-high-level-architecture)
- [🧠 Context Management Engine](#-context-management-engine)
  - [1. File Staleness Tracking \& Tombstoning](#1-file-staleness-tracking--tombstoning)
  - [2. Microcompaction](#2-microcompaction)
  - [3. LLM Summarization Compaction](#3-llm-summarization-compaction)
  - [4. Ephemeral Prompt Caching](#4-ephemeral-prompt-caching)
  - [5. Workspace Project Memory (`AGENT.md`)](#5-workspace-project-memory-agentmd)
- [💾 Session Management \& Tree Persistence](#-session-management--tree-persistence)
  - [1. Append-Only JSONL Tree Storage](#1-append-only-jsonl-tree-storage)
  - [2. Tree Branching \& Leaf Pointer Rewinding](#2-tree-branching--leaf-pointer-rewinding)
  - [3. Path Resolution \& Context Rebuilding](#3-path-resolution--context-rebuilding)
  - [4. Deferred Disk Flushing](#4-deferred-disk-flushing)
  - [5. Automatic Version Migrations](#5-automatic-version-migrations)
  - [6. Session Discovery \& Resumption](#6-session-discovery--resumption)
- [🛠️ Tool Ecosystem](#️-tool-ecosystem)
- [🤖 Multi-Provider LLM Support](#-multi-provider-llm-support)
- [🚀 Execution Modes](#-execution-modes)
  - [1. Interactive CLI REPL](#1-interactive-cli-repl)
  - [2. Headless Automation CLI](#2-headless-automation-cli)
  - [3. Parallel vs. Sequential Tool Execution](#3-parallel-vs-sequential-tool-execution)
  - [4. Mid-Run User Steering Intercept](#4-mid-run-user-steering-intercept)
- [🚦 Permission Gate \& Safety Engine](#-permission-gate--safety-engine)
- [⚡ Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Interactive REPL](#running-the-interactive-repl)
  - [Running Headless Tasks](#running-headless-tasks)
  - [Running Unit Tests](#running-unit-tests)
- [📁 Repository Structure](#-repository-structure)

---

## ✨ Features

- **💻 Dynamic Interactive CLI REPL**: Live streaming of assistant responses, formatted `💭 Thinking` blocks, tool call parameters, execution results, and runtime token dashboard.
- **⚙️ Headless Mode**: Non-interactive automation entry point that accepts `--task` and `--cwd` and outputs structured JSON results for script/CI integration.
- **🧠 Advanced Context Engineering**: Automatic file read staleness invalidation (tombstoning), tool-call microcompaction, LLM summarization compaction, and `cache_control` breakpoint injection.
- **🌳 Tree-Structured Session Storage**: Append-only JSONL event-log format supporting linear history, parent-pointer branching, leaf rewinding, and session resume capabilities.
- **🚀 Dual Tool Execution Modes**: Switch dynamically between **Parallel** execution (running independent read/write calls concurrently via `Promise.all`) and **Sequential** execution.
- **📝 Range-Targeted Editing with Drift Recovery**: Line-targeted find-and-replace (`startLine`/`endLine`) with sliding-window offset recovery (±10 lines tolerance) and mismatch diagnostics.
- **🔍 Fast Search Capabilities**: Ripgrep-backed (`rg`) recursive text pattern matching with Bun-glob fallback and wildcard glob scanning.
- **🤖 Provider Agnostic**: Seamlessly switch between local **Ollama** models (`qwen3:14b`, `qwen3:8b`, `llama3.1:8b`) and cloud **Gemini** models (`gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-3.1-flash-lite`).
- **🛡️ Permission Gate & Policy Engine**: Safety barrier enforcing user confirmation before running mutating actions (writes, edits, shell commands) with policy-based auto-approval.
- **🛰️ Read-Only Sub-Agent Dispatch**: Isolated sub-agent worker context for performing background research without mutating workspace files.

---

## 🏗️ High-Level Architecture

The framework is decoupled into modular layers, separating execution control, context lifecycle, persistence, tool execution, and model connectivity:

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLI Layer                               │
│     Interactive REPL (repl.ts)   │   Headless CLI (headless.ts)  │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                         ┌────────▼────────┐
                         │   Agent Core    │
                         │ (src/agent.ts)  │
                         └────────┬────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
┌──────▼─────────┐       ┌────────▼────────┐       ┌─────────▼────────┐
│ ContextManager │       │ SessionStore    │       │ PermissionGate   │
│ - History      │       │ - JSONL Tree    │       │ - Read/Mutate    │
│ - Invalidation │       │ - Branching     │       │   Classification │
│ - Compaction   │       │ - Path Resolve  │       │ - Policy Engine  │
└──────┬─────────┘       └─────────────────┘       └──────────────────┘
       │
       │                 ┌─────────────────┐
       ├────────────────►│  ToolRegistry   │◄────────┐
       │                 │ - 10 Built-ins  │         │
       │                 └────────┬────────┘         │
       │                          │                  │
       │                 ┌────────▼────────┐ ┌───────┴────────┐
       │                 │ Sub-Agent Engine│ │ Tool Execution │
       │                 │  (Read-only)    │ │ Sequential/    │
       │                 └─────────────────┘ │ Parallel       │
       │                                     └────────────────┘
┌──────▼──────────────────────────────────────────────────────┐
│                  ChatModelClient Interface                  │
│       OllamaClient (Local)   │   GeminiClient (API)         │
└─────────────────────────────────────────────────────────────┘
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
- Dynamic `/models` changes, `/mode` toggling, and `clear` commands immediately sync session state.

---

## 🛠️ Tool Ecosystem

The harness provides 10 core tools in `src/tools/`:

| Tool Name | Type | Description |
|---|---|---|
| `read_file` | Read-only | Reads text files with line numbering, offset paging, and line range slicing. |
| `write_file` | Mutating | Creates new files or overwrites existing files completely. |
| `edit_file` | Mutating | Performs range-targeted find-and-replace using `startLine`/`endLine`, with sliding-window line drift recovery (±10 lines tolerance) and exact line mismatch diagnostics. |
| `run_command` | Mutating | Executes shell commands on the host machine. Gated by permission checks and safety policies. |
| `check_syntax` | Read-only | Validates JavaScript/TypeScript files using Bun's internal bundler compiler to report syntax errors prior to execution. |
| `glob` | Read-only | Performs fast wildcard pattern file and directory scanning across the workspace. |
| `grep` | Read-only | Executes workspace text searches using system `ripgrep` (`rg`) with a native Bun glob fallback. |
| `todo_read` | Read-only | Reads the persistent checklist file (`.todo.md`). |
| `todo_write` | Mutating | Updates and manages the project task checklist (`.todo.md`). |
| `dispatch_subagent` | Read-only | Spawns an isolated, read-only sub-agent to perform deep research tasks without file mutation access. |

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
   - Handles thought signatures (`thought_signature`), structured tool declarations, and usage metadata.
   - Built-in support for `gemini-1.5-flash`, `gemini-1.5-pro`, and `gemini-3.1-flash-lite`.

Model switching can be done interactively during REPL sessions using the `/models` command.

---

## 🚀 Execution Modes

### 1. Interactive CLI REPL
Launch using `bun start` or `bun run src/cli/repl.ts`:
- Features colored streaming responses and thinking visualization.
- Displays live tool invocation summaries and execution results.
- Includes interactive command shortcuts:
  - `/models`: Open interactive model selector menu.
  - `/mode`: Toggle between `parallel` and `sequential` tool execution.
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

## 🚦 Permission Gate & Safety Engine

`PermissionGate` (`src/permissions/permissionGate.ts`) acts as a security barrier between the agent and host machine operations:

- **Read-Only Operations**: (`read_file`, `grep`, `glob`, `todo_read`, `check_syntax`, `dispatch_subagent`) execute automatically.
- **Mutating Operations**: (`write_file`, `edit_file`, `run_command`, `todo_write`) require user confirmation in interactive mode.
- **Policy Engine Auto-Approval**: Evaluates safe command patterns (e.g. `git status`, `ls`, `npm test`) against policy rules to bypass prompts for non-destructive operations.
- **Dangerous Command Blocking**: Rejects destructive system commands (e.g. `rm -rf /`) automatically.
- **Auto-Confirm Option**: `autoConfirm: true` (used in headless mode) automatically approves non-blocked mutating actions.

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

### Running Headless Tasks

```bash
bun run src/cli/headless.ts --task "Refactor search utility to use async/await" --cwd "."
```

### Running Unit Tests

Execute the Vitest-compatible Bun test suite covering tools, context compaction, staleness tracking, session storage, and execution modes:

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
│   │   └── headless.ts           # Non-interactive JSON automation CLI entry point
│   ├── context/
│   │   ├── contextManager.ts     # History state, staleness tombstoning, token tracking
│   │   └── compaction.ts         # Microcompaction & LLM summarization compaction
│   ├── permissions/
│   │   └── permissionGate.ts     # Read/mutate safety gate and command policy engine
│   ├── providers/
│   │   ├── types.ts              # ChatModelClient, Message, and ToolCall interface types
│   │   ├── ollama.ts             # Ollama API client implementation
│   │   └── gemini.ts             # Gemini REST API client implementation
│   ├── session/
│   │   └── sessionStore.ts       # Append-only JSONL tree persistence, branching, and migrations
│   ├── tools/
│   │   ├── index.ts              # Unified ToolRegistry definition
│   │   ├── read.ts               # Range-sliced file reader with line numbers
│   │   ├── write.ts              # File creator and overwriter
│   │   ├── edit.ts               # Targeted find-replace editor with sliding drift recovery
│   │   ├── bash.ts               # Command execution tool
│   │   ├── checkSyntax.ts        # JS/TS syntax validator (Bun build compiler)
│   │   ├── glob.ts               # Wildcard pattern file scanner
│   │   ├── grep.ts               # Ripgrep-backed workspace search tool
│   │   ├── todo.ts               # Task list checklist management (.todo.md)
│   │   ├── subagent.ts           # Read-only background sub-agent dispatcher
│   │   ├── activeClient.ts       # Active LLM client reference container
│   │   └── types.ts              # Tool interface contracts
│   └── tests/
│       ├── context.test.ts       # Staleness and compaction test suite
│       ├── executionMode.test.ts # Parallel vs sequential mode test suite
│       ├── gemini.test.ts        # Gemini provider test suite
│       ├── search.test.ts        # Glob and Grep test suite
│       ├── tools.test.ts         # File edit, read, syntax, and todo tool test suite
│       └── v4.test.ts            # Session tree, diff, policy engine, and subagent test suite
├── AGENT.md                      # Workspace project memory rules file
├── agent-harness-architecture.md # Architecture specification document
├── pi-agent-session-storage.md   # Session storage specification document
├── package.json                  # Dependencies and run scripts
└── tsconfig.json                 # TypeScript compiler configuration
```

---

## 📜 License

MIT License. Built for autonomous AI agent research and development.

