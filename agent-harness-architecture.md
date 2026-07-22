# Custom Agent Harness — Architecture & Roadmap

**Goal:** Build a Claude-Code-style coding agent loop from scratch in TypeScript — no agent framework — to learn how the internals actually work, and get behavior as close to Claude Code as possible using the same underlying model.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Use Bun) | matches your existing stack, good for CLI + async tool execution |
| Model API | Ollama (qwen3:8b) and also we can add support later | direct access to tool_use, prompt caching, streaming |
| CLI shell | Node `readline` or `commander` + `chalk`/`ora` for output | simple REPL-style interface |
| Process exec | Node `child_process` (`execa` recommended over raw `exec`) | for the Bash tool |
| File search | `fast-glob` + shelling out to `ripgrep` (`rg`) if installed | Grep tool needs to be fast, not naive JS string search |
| Diffing | `diff` npm package | for showing Edit tool changes to the user before applying |
| Storage | Flat JSON/markdown files on disk (no DB needed for v1) | session transcripts, project memory file |
| Testing | Vitest | fast, TS-native |

No framework (no LangGraph, no LangChain) — the loop, state, and orchestration are all yours.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────┐
│                        CLI / REPL                        │
│   (reads user input, prints streamed output + tool logs) │
└───────────────────────────┬───────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   Agent (core)    │
                    │  - loop control   │
                    │  - state          │
                    └────────┬─────────┘
             ┌───────────────┼───────────────────┐
             │               │                    │
     ┌───────▼──────┐ ┌──────▼───────┐   ┌───────▼────────┐
     │ ContextManager│ │ ToolRegistry │   │ PermissionGate │
     │ - history      │ │ - Read       │   │ - classify     │
     │ - compaction   │ │ - Write      │   │   read/mutate  │
     │ - caching      │ │ - Edit       │   │ - confirm UI   │
     │   markers       │ │ - Bash       │   └────────────────┘
     └───────┬────────┘ │ - Glob       │
             │           │ - Grep       │
             │           │ - TodoWrite  │
             │           └──────┬───────┘
             │                  │
     ┌───────▼──────────────────▼───────┐
     │        Anthropic API client       │
     │  (messages.create, streaming,     │
     │   cache_control breakpoints)      │
     └────────────────────────────────────┘
```

---

## 3. Core modules to build

### `Agent`
- Owns the main loop: send messages → get response → if `tool_use` blocks exist, execute via `ToolRegistry` → append `tool_result` → repeat until plain-text-only response.
- Must handle **multiple parallel tool_use blocks** in one response, not just one at a time.
- Emits events (`onToolCall`, `onToolResult`, `onTextChunk`) so the CLI layer can render live instead of waiting for full completion.

### `ContextManager`
- Holds the message history array.
- Applies truncation rules to tool results before they're appended (cap bash output, cap grep matches, etc.).
- Tracks token usage per turn (from API response `usage` field) and triggers compaction at a threshold (e.g. 80% of context window).
- Handles file staleness: if a file is edited, invalidate/mark stale any earlier `Read` result for that file still sitting in history.
- Owns cache_control breakpoint placement (after system prompt + tool defs, after project memory).

### `ToolRegistry`
- Each tool = `{ name, description, input_schema, run(input) }`.
- `run()` returns a structured result, already truncated/formatted, never raw dumps.
- Tools are registered once at startup and their schemas go straight into the API request.

### `PermissionGate`
- Classifies each tool as `readonly` (auto-run: Read, Grep, Glob) or `mutating` (confirm: Write, Edit, Bash).
- For v1, confirmation can just be a CLI y/n prompt. Later this becomes a policy engine (auto-approve safe patterns, deny-list dangerous bash commands).

### `ProjectMemory`
- Loads a `AGENT.md` file from the project root at session start (like Claude Code's `CLAUDE.md`) — conventions, architecture notes, "don't touch X" rules.
- Injected once, cached, never resent raw every turn.

### `SessionStore`
- Persists conversation transcript + todo state to disk so a session can be resumed later.

---

## 4. Roadmap

### v1 — Working loop, single-file focus
Goal: agent can read/edit/write files and run shell commands reliably in a single directory, with a human confirming mutations.

- [ ] `Agent` core loop (already started)
- [ ] Tools: `Read`, `Write`, `Edit` (find/replace style, not full rewrite), `Bash`
- [ ] `PermissionGate` — basic y/n confirm before Write/Edit/Bash
- [ ] Tool result truncation (bash output cap, file read offset/limit)
- [ ] Basic system prompt (tool usage philosophy, environment info: cwd, platform)
- [ ] CLI REPL with streamed text output

### v2 — Context engineering
Goal: agent survives long sessions without blowing the context window or losing track.

- [ ] Prompt caching (`cache_control` on system prompt + tool defs)
- [ ] File staleness tracking (invalidate stale Read results after Write/Edit)
- [ ] Tool result microcompaction (drop/collapse superseded results continuously)
- [ ] Token usage tracking per turn
- [ ] Full summarization compaction at threshold (summarize old turns → replace with summary message)
- [ ] `AGENT.md` project memory file support

### v3 — Planning & multi-step reliability
Goal: agent handles multi-step tasks without losing the plan.

- [ ] `TodoWrite`/`TodoRead` tool — explicit task list the model maintains
- [ ] `Glob` + `Grep` tools (ripgrep-backed)
- [ ] Mid-run steering (interrupt + inject new instruction without losing state)
- [ ] Better error recovery (tool failures fed back as retryable tool_results, not crashes)

### v4 — Advanced / stretch
Goal: approach Claude Code's actual capability ceiling.

- [ ] Sub-agent dispatch tool (spin up isolated context for a narrow search/explore task, return only the result)
- [ ] Session resume from `SessionStore`
- [ ] Policy engine for `PermissionGate` (auto-approve safe bash patterns, deny-list dangerous ones)
- [ ] Diff preview before applying Edit/Write (show the user what's about to change)

---

## 5. Suggested file structure

```
agent-harness/
├── src/
│   ├── agent.ts              # core loop
│   ├── context/
│   │   ├── contextManager.ts
│   │   └── compaction.ts
│   ├── tools/
│   │   ├── index.ts          # ToolRegistry
│   │   ├── read.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   ├── bash.ts
│   │   ├── glob.ts
│   │   ├── grep.ts
│   │   └── todo.ts
│   ├── permissions/
│   │   └── permissionGate.ts
│   ├── memory/
│   │   └── projectMemory.ts
│   ├── session/
│   │   └── sessionStore.ts
│   ├── cli/
│   │   └── repl.ts
│   └── client.ts             # Anthropic API wrapper
├── AGENT.md                  # example project memory file
└── package.json
```

---

## 5.1 How we are stroing the context or managing the session :

Session starts
  → load AGENT.md → inject as early cached message
  → load .sessions/xyz.json if it exists → restore messages[]

Each turn
  → append user message to messages[]
  → send FULL messages[] array to API
  → get response, append to messages[]
  → execute any tools, append tool_results to messages[]
  → check token usage from API response
  → if usage > 80% of context window:
        summarize older half of messages[] → replace with 1 summary message
  → write messages[] to disk (session persistence)

Session ends / crashes
  → next launch reads messages[] back from disk, picks up where it left off

## 6. Build order (practical, incremental)

1. Finish the loop + parallel tool_use handling
2. `Read` / `Write` / `Edit` / `Bash` tools with truncation baked in from day 1
3. `PermissionGate` (basic confirm)
4. System prompt tuning
5. Prompt caching + file staleness
6. `TodoWrite` tool
7. Summarization compaction
8. Sub-agents (only once everything above feels solid)

This order front-loads the stuff with the highest "feels like Claude Code" payoff per hour of work, and saves the genuinely hard stuff (compaction, sub-agents) for once the plumbing is proven.
