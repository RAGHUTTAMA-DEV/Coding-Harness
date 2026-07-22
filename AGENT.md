# Antigravity Agent Harness - Project Memory

Welcome! This is the project memory file for the Antigravity Custom Agent Harness.

## Project Structure & Architecture
- `src/agent.ts`: Defines the core execution loop and manages parallel tool blocks.
- `src/client.ts`: Ollama client wrapper handling streaming outputs, thoughts, and token statistics tracking.
- `src/context/`: Context management & engineering subfolder.
  - `contextManager.ts`: State container for message history, file staleness invalidations, token metrics, and compaction triggers.
  - `compaction.ts`: Strategy patterns for microcompaction (deduplication of duplicate tool calls) and summarization compaction (older turns summary).
- `src/tools/`: Custom developer tools (read_file, write_file, edit_file, run_command).
- `src/permissions/`: Console-based confirmation gates.
- `src/cli/`: Interactive colorized terminal REPL.

## Development Rules & Conventions
1. **No External Frameworks**: Do NOT import LangChain, LangGraph, or other agent frameworks. All orchestrations, loop structures, and state management must remain native and dependency-free.
2. **TypeScript & Bun**: Always run inside the Bun environment. Write clean, idiomatic TypeScript.
3. **Safe File Operations**:
   - Prefer `edit_file` (find-and-replace) over `write_file` (complete write) for localized file modifications.
   - Use `path.resolve` to normalize target paths for file staleness and tool arguments checking.
4. **Token Management**:
   - Keep conversation history lean. Rely on automatic microcompaction and summarization compaction to handle long-running sessions.
   - Fallbacks for token metrics are calculated by string length heuristics when API metadata is absent.
5. **Testing**: Run Vitest-compatible tests using `bun test`. Ensure all new features are backed by comprehensive unit test coverage.
