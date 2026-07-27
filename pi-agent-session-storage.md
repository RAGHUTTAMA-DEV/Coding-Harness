# Session Storage in pi-agent-core

This module implements conversation history as an **append-only tree** stored in JSONL files, with a resolved "current path" concept for building LLM context. Here's how it works, piece by piece.

## 1. Core data model: entries with tree structure

Every unit of session data is a `SessionEntry` with an `id`, `parentId`, and `timestamp`. The type union covers messages, thinking-level changes, model changes, compactions, branch summaries, custom extension data, labels, and session names:

```ts
export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry;
```

Because every entry points to a `parentId`, the session isn't a flat list — it's a **tree**. A `null` parentId means root. This is what enables branching: you can rewind the "leaf" pointer to an earlier entry and start appending a new child chain from there, without touching or deleting the old path.

The file itself is just JSONL: a `SessionHeader` line, followed by one JSON entry per line, written via `appendFileSync`. This is why the format is append-friendly and crash-resistant — each line is a complete, independently-parseable JSON object.

## 2. Writing entries: the `_appendEntry` / `_persist` machinery

All `appendXXX` methods (`appendMessage`, `appendThinkingLevelChange`, `appendModelChange`, `appendCompaction`, etc.) follow the same pattern: build an entry with a fresh id and `parentId: this.leafId`, then call `_appendEntry`, which updates in-memory state and advances the leaf pointer:

```ts
private _appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);
}
```

The disk-write logic in `_persist` has an interesting optimization: it **defers writing until the first assistant message arrives**. Before that, entries just accumulate in memory (`flushed = false`). This avoids creating session files for conversations that get abandoned before any real assistant response (e.g., accidental empty sessions). Once an assistant message shows up, it does a one-time bulk write of everything buffered so far, then switches to simple appends thereafter.

## 3. The leaf pointer and branching

`leafId` tracks "where we currently are" in the tree. Normal usage just keeps advancing it. But `branch()` lets you rewind:

```ts
branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
        throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
}
```

After calling this, the next appended entry becomes a **new child** of `branchFromId`, forming a sibling branch. Nothing is deleted — old branches remain in the file, just unreachable from the new leaf unless you explicitly navigate back. `branchWithSummary` does the same but also drops a `BranchSummaryEntry` capturing context from the abandoned path, so a future compaction/context-build can still reference what happened there.

`resetLeaf()` is the special case of branching to the very root (before the first entry) — used e.g. to re-edit the first user message.

## 4. Resolving a path from leaf to root

Given any leaf, the actual "conversation so far" is reconstructed by walking parent pointers back to the root:

```ts
function buildSessionPath(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const index = buildEntryIndex(entries, byId);
	...
	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.push(current);
		current = current.parentId ? index.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}
```

This is the mechanism that makes branches work as isolated timelines — each leaf has exactly one path back to root, and other branches simply aren't part of that walk.

## 5. Compaction-aware context building

Long conversations get compacted (summarized) to save tokens. A `CompactionEntry` records a `summary`, the `firstKeptEntryId` (first original entry still kept verbatim after the summary point), and `tokensBefore`. `buildContextEntries` walks the resolved path, finds the **latest** compaction on it, and reconstructs the effective entry list as: `[compaction entry, ...entries from firstKeptEntryId up to the compaction point, ...everything after the compaction]`:

```ts
const contextEntries: SessionEntry[] = [compaction];
let foundFirstKept = false;
for (let i = 0; i < compactionIdx; i++) {
    const entry = path[i];
    if (entry.id === compaction.firstKeptEntryId) {
        foundFirstKept = true;
    }
    if (foundFirstKept) {
        contextEntries.push(entry);
    }
}
contextEntries.push(...path.slice(compactionIdx + 1));
```

This means older, summarized entries are silently dropped from context, while the summary and everything post-compaction remains.

## 6. From entries to LLM messages

`sessionEntryToContextMessages` converts each resolved entry into zero or more `AgentMessage`s. Plain `message` entries pass through mostly as-is (with a defensive fallback for null content on old/hand-edited files). `custom_message`, `branch_summary`, and `compaction` entries get converted into synthetic messages via helper constructors (`createCustomMessage`, `createBranchSummaryMessage`, `createCompactionSummaryMessage`). Plain `custom` entries (extension state, not context) return `[]` — they never reach the LLM.

`buildSessionContext` ties it together: it resolves the path, extracts the active `thinkingLevel`/`model` settings by scanning the path for the latest `thinking_level_change`/`model_change`/assistant message, and flat-maps the compaction-aware entries into the final message array.

## 7. Versioning and migration

Sessions carry a `version` in the header. Two migrations exist:

- **v1→v2** (`migrateV1ToV2`): old sessions had no id/parentId tree — this synthesizes ids and chains them linearly (`parentId = prevId`), and converts old `firstKeptEntryIndex` (array index) into the new `firstKeptEntryId` (stable id) for compactions.
- **v2→v3** (`migrateV2ToV3`): renames a legacy `hookMessage` role to `custom`.

`migrateToCurrentVersion` checks the header's version and applies whichever migrations are needed, mutating in place; `setSessionFile` triggers a full file rewrite (`_rewriteFile`) if any migration ran.

## 8. Reading files efficiently

`loadEntriesFromFile` avoids loading the whole file into a JS string/array structure via naive `readFileSync + split`. Instead it streams via `readSync` into a fixed 1MB buffer, uses a `StringDecoder` to safely handle multi-byte UTF-8 sequences split across buffer boundaries, and parses line-by-line:

```ts
while (true) {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    pending += decoder.write(buffer.subarray(0, bytesRead));
    ...
}
```

Malformed lines are silently skipped (`parseSessionEntryLine` catches JSON parse errors) — this makes the format resilient to partial writes (e.g., a crash mid-append).

## 9. Session discovery and listing

Sessions live under `~/.pi/agent/sessions/<encoded-cwd>/`, where the cwd is encoded into a filesystem-safe directory name:

```ts
const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
```

`findMostRecentSession` (used by `continueRecent`) reads just the header of each `.jsonl` file (first 512 bytes) to cheaply filter by matching `cwd`, then sorts by mtime — avoiding a full parse of every session just to find the latest one.

`SessionManager.list` / `listAll` build richer `SessionInfo` summaries (first message, all message text for search, message count, etc.) using `buildSessionInfo`, which streams the file line-by-line via `readline` rather than loading it whole. Since this can be slow across many files, it's parallelized with a bounded worker pool (`buildSessionInfosWithConcurrency`, capped at `MAX_CONCURRENT_SESSION_INFO_LOADS = 10`) that reports incremental progress.

## 10. Forking and extracting sub-sessions

Two related-but-distinct operations:

- **`forkFrom`**: copies an *entire other session's* entries into a brand-new file under a different `cwd`, preserving full tree structure, and points the new header's `parentSession` at the source file.
- **`createBranchedSession`**: extracts just the *single root-to-leaf path* of the *current* session into a new file (dropping other branches and re-chaining around removed `label` entries so nothing is orphaned), useful for turning one branch of a branched conversation into its own clean session.

## Summary

The design's key idea is: **storage is an immutable, append-only tree; "the conversation" is just one resolved path through that tree, computed on demand.** This gives you branching/forking without ever mutating history, crash-safety via line-oriented JSONL, and a clean seam (`buildSessionContext`) between "what's stored" and "what's sent to the model," which is also where compaction and versioned migrations get transparently applied.
