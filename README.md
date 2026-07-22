# Coding - Harness

An advanced, Claude-Code-style agent execution loop built completely from scratch in TypeScript and running under **Bun**. It orchestrates tool-calling, context memory, and permission gating natively, without using external agent frameworks (like LangChain or LangGraph).

---

## ✨ Features

- **💻 Interactive CLI REPL (`src/cli/repl.ts`)**: Streamed assistant responses, thinking chunks, and detailed tool calling logs.
- **🚀 Parallel Tool Execution**: Supports executing multiple tool blocks in a single LLM assistant turn.
- **🧠 Context Engineering (`src/context/`)**:
  - **Staleness Tracking**: Automatically invalidates and tombstones previous `read_file` results in history when the agent writes or edits that path, avoiding stale reference errors.
  - **Microcompaction**: Continuously deduplicates repetitive tool executions in history.
  - **Summarization Compaction**: Folds the oldest 50% of history into a single summary block once session tokens exceed context limits (default: 8,000 tokens).
- **📝 Robust Line-Targeted Range Editing (`src/tools/edit.ts`)**:
  - Supports `startLine` and `endLine` parameters for targeted edits, preventing duplicate block collision.
  - Automatically recovers from line number offsets (up to ±10 lines) using a sliding-window drift search.
  - Returns detailed snippets of the actual lines on search mismatches so the agent has direct diagnostics to auto-correct.
- **🎯 Task List (TODO) Management (`src/tools/todo.ts`)**:
  - Exposes `todo_read` and `todo_write` tools to maintain a persistent checkable task checklist (`.todo.md`).
- **🔍 Ripgrep-Backed Search (`src/tools/grep.ts`)**:
  - Ripgrep-backed (`rg`) recursive workspace text searches with automatic exclusions (`node_modules`, `.git`, etc.) and a native Bun-glob fallback.
- **🚦 Mid-Run Steering Checkpoints**:
  - Intercepts Ctrl+C (`SIGINT`) during execution. The agent loop pauses before the next completion turn, prompting the user for steering instructions without resetting the session context.
- **🛡️ Permission Gate (`src/permissions/`)**:
  - A console-based confirmation barrier that classifies and gates read-only vs. mutating tool runs.

---

## 🛠️ Technology Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript
- **Target LLM**: Ollama (`qwen3:8b` by default)
- **Unit Testing**: Bun Test / Vitest-compatible runner

---

## 🚀 Getting Started

### Prerequisites

1. Install **Bun**:
   ```bash
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
2. Install **Ollama** and fetch the default model:
   ```bash
   ollama pull qwen3:8b
   ```

### Installation

1. Clone the repository and navigate to the directory:
   ```bash
   cd Coding-harness
   ```
2. Install dependencies:
   ```bash
   bun install
   ```

### Usage

1. Start the agent CLI REPL:
   ```bash
   bun start
   ```
2. Start typing instructions! To exit, type `exit` or `quit`. To clear the session context, type `clear`.
3. Press `Ctrl+C` once during agent tool runs to pause and input a mid-run steering direction.

### Running Tests

Execute the unit tests verifying context manager logic, search tools, syntax checking, range-based edits, and task lists:
```bash
bun test
```

---

## 📁 Repository Structure

```
Coding-harness/
├── src/
│   ├── agent.ts            # Core execution loop & user steering
│   ├── client.ts           # Ollama client, streaming, token tracking
│   ├── cli/
│   │   └── repl.ts         # CLI REPL interface, SIGINT steering hook
│   ├── context/
│   │   ├── contextManager.ts # Session history, token invalidation
│   │   └── compaction.ts   # Microcompaction & summarization compaction
│   ├── permissions/
│   │   └── permissionGate.ts # Console confirmation check
│   └── tools/
│       ├── index.ts        # Tool registry definitions
│       ├── read.ts         # read_file (range formatted with lines)
│       ├── write.ts        # write_file
│       ├── edit.ts         # edit_file (range-targeted with sliding drift search)
│       ├── grep.ts         # grep (ripgrep-backed + Bun-glob fallback)
│       ├── glob.ts         # glob scanner
│       ├── checkSyntax.ts  # check_syntax compiler validation (bun build)
│       ├── todo.ts         # todo_read / todo_write task lists
│       └── types.ts        # Tool interfaces
├── AGENT.md                # Harness Project Memory injected into context
└── package.json            # Scripts & project manifest
```
