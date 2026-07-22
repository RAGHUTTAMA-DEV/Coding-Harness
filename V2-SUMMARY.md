# Custom Agent Harness v2 - Progress, Context & Learnings

This document summarizes the changes, architectures, and capabilities implemented in Custom Agent Harness v2 (Context Engineering & Search Capabilities).

---

## 1. Stack & Architecture Enhancements
We expanded the harness from a basic single-file toolset (v1) into a production-grade, long-session-capable agent loop. No external frameworks (like LangChain or LangGraph) were introduced—all orchestrations, state logic, and tool bindings remain natively written in TypeScript running under Bun.

---

## 2. What We Have Built (v2 Completed)

### A. Context Engineering & Token Management
- **Ollama Token Tracking (`src/client.ts`)**: Captures exact prompt/response token counts (`prompt_eval_count` and `eval_count`) from stream completions. Includes a robust fallback heuristic (1 token ≈ 4 characters) to guarantee token usage tracking is never missing.
- **Context Manager (`src/context/contextManager.ts`)**: Isolates conversation history from static prompts. Automatically prepends the system prompt and `AGENT.md` (Project Memory) to the API payload.
- **File Staleness Invalidation**: When the agent modifies a file (via `write_file` or `edit_file`), the `ContextManager` automatically targets and invalidates any previous `read_file` results in history for that path, replacing them with a token-efficient tombstone to prevent the agent from referencing outdated code states.
- **Microcompaction (`src/context/compaction.ts`)**: Continuously cleans up history by folding duplicate tool results (e.g., executing the same command multiple times or reading the same file multiple times) into a short notice.
- **Summarization Compaction**: When session tokens exceed the threshold (default: 8,000 tokens), the oldest 50% of the conversation history is summarized by the LLM and folded into a single system summary block.

### B. Workspace Discovery & Code Searching
- **Glob File Discovery (`src/tools/glob.ts`)**: Uses Bun's native `Glob` class to recursively inspect directories. Automatically filters out library/dependency and metadata folders (`node_modules`, `.git`, `.gemini`).
- **Grep Text Searcher (`src/tools/grep.ts`)**: Searches for string literals or RegExp patterns across files, returning paths and line numbers up to 50 results (truncated to prevent context blowout). Normalized to use cross-platform forward-slash paths.

### C. Syntax Validation & Loop Steering
- **`check_syntax` Tool (`src/tools/checkSyntax.ts`)**: Executes `bun build` on JavaScript or TypeScript files in a subprocess. Returns compilation/transpilation success or detailed syntax error positions. Runs automatically without permission prompts (`isMutating: false`).
- **Prompt Guidelines Tuning (`src/agent.ts`)**: Enforces immediate tool calls in the same assistant turn. Prevents the model from pausing to describe planned actions in text without invoking tools.

### D. Whitespace-Tolerant Editing
- **Whitespace-Insensitive matching (`src/tools/edit.ts`)**: Upgraded `edit_file` matching. If exact matching fails, it normalizes spaces, tabs, indentation, and line endings to locate the unique matching line block in the target file, preventing editing deadlocks.

---

## 3. Current Verification Status
A total of 18 unit tests are run across the codebase, split into three suites:
```bash
bun test
```

### Test Logs
```text
bun test v1.3.5 (1e86cebd)

src\context\context.test.ts:
✓ Context Management Tests > File staleness invalidates previous read results for the same path
✓ Context Management Tests > Microcompaction collapses duplicate tool calls with same arguments
✓ Context Management Tests > Summarization compaction folds the first 50% of history
✓ Context Management Tests > ContextManager compactIfNeeded runs both microcompaction and triggers summarization above threshold

src\tools\search.test.ts:
✓ Search Tools Tests (Glob & Grep) > glob lists files correctly
✓ Search Tools Tests (Glob & Grep) > glob handles specific pattern filters
✓ Search Tools Tests (Glob & Grep) > grep finds literal substrings across files
✓ Search Tools Tests (Glob & Grep) > grep handles regex pattern searches

src\tools\tools.test.ts:
✓ Tool Tests > read_file reads complete file with line numbers
✓ Tool Tests > read_file reads subset of lines
✓ Tool Tests > write_file overwrites content successfully
✓ Tool Tests > edit_file replaces unique block
✓ Tool Tests > edit_file fails on duplicate blocks
✓ Tool Tests > edit_file fails on missing block
✓ Tool Tests > edit_file replaces block with whitespace mismatch
✓ Tool Tests > edit_file fails on multiple whitespace-tolerant matches
✓ Tool Tests > check_syntax returns success for valid file
✓ Tool Tests > check_syntax returns errors for invalid file

 18 pass
 0 fail
 49 expect() calls
Ran 18 tests across 3 files. [248.00ms]
```
The codebase is extremely stable, verified, and equipped to support long, complex agent operations across multiple files.
