import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { StringDecoder } from "string_decoder";
import { Message } from "../client";

// ==========================================
// 1. Data Type Definitions
// ==========================================

export interface SessionHeader {
  version: number;
  sessionId: string;
  cwd: string;
  createdAt: string;
  parentSession?: string;
}

export interface BaseEntry {
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends BaseEntry {
  type: "message";
  message: Message;
}

export interface ThinkingLevelChangeEntry extends BaseEntry {
  type: "thinking_level_change";
  thinkingLevel: number;
}

export interface ModelChangeEntry extends BaseEntry {
  type: "model_change";
  model: string;
}

export interface CompactionEntry extends BaseEntry {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore?: number;
}

export interface BranchSummaryEntry extends BaseEntry {
  type: "branch_summary";
  summary: string;
  branchFromId: string;
}

export interface CustomEntry extends BaseEntry {
  type: "custom";
  key: string;
  data: any;
}

export interface CustomMessageEntry extends BaseEntry {
  type: "custom_message";
  message: Message;
}

export interface LabelEntry extends BaseEntry {
  type: "label";
  label: string;
}

export interface SessionInfoEntry extends BaseEntry {
  type: "session_info";
  title?: string;
  messagesCount?: number;
}

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

// ==========================================
// 2. Migration Helpers
// ==========================================

export function migrateV1ToV2(header: SessionHeader, entries: SessionEntry[]): void {
  let prevId: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.id) {
      entry.id = `migrated_${Math.random().toString(36).substring(2, 11)}_${Date.now()}_${i}`;
    }
    if (entry.parentId === undefined) {
      entry.parentId = prevId;
    }
    prevId = entry.id;
  }

  // Convert old firstKeptEntryIndex (number) to firstKeptEntryId (string) for compactions
  for (const entry of entries) {
    if (entry.type === "compaction") {
      const compaction = entry as any;
      if (typeof compaction.firstKeptEntryIndex === "number") {
        const idx = compaction.firstKeptEntryIndex;
        if (idx >= 0 && idx < entries.length) {
          compaction.firstKeptEntryId = entries[idx].id;
        } else {
          compaction.firstKeptEntryId = "";
        }
        delete compaction.firstKeptEntryIndex;
      }
    }
  }
  header.version = 2;
}

export function migrateV2ToV3(header: SessionHeader, entries: SessionEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "message") {
      const msgEntry = entry as SessionMessageEntry;
      if ((msgEntry.message.role as string) === "hookMessage") {
        msgEntry.message.role = "custom" as any;
      }
    }
  }
  header.version = 3;
}

export function migrateToCurrentVersion(header: SessionHeader, entries: SessionEntry[]): void {
  if (header.version === 1) {
    migrateV1ToV2(header, entries);
  }
  if (header.version === 2) {
    migrateV2ToV3(header, entries);
  }
}

// ==========================================
// 3. File Loading & Parsing
// ==========================================

export function loadEntriesFromFile(filePath: string): { header: SessionHeader; entries: SessionEntry[]; migrated: boolean } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8").trim();
  } catch (err) {
    throw new Error(`Failed to read session file: ${filePath}`);
  }

  // Backwards compatibility with flat JSON array of messages (v1 legacy format)
  if (content.startsWith("[")) {
    try {
      const messages = JSON.parse(content) as Message[];
      const header: SessionHeader = {
        version: 3,
        sessionId: path.basename(filePath, path.extname(filePath)),
        cwd: process.cwd(),
        createdAt: new Date().toISOString()
      };
      const entries: SessionEntry[] = [];
      let prevId: string | null = null;
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const id = `msg_${Math.random().toString(36).substring(2, 11)}_${Date.now()}_${i}`;
        entries.push({
          id,
          parentId: prevId,
          timestamp: new Date().toISOString(),
          type: "message",
          message: msg
        });
        prevId = id;
      }
      return { header, entries, migrated: true };
    } catch {
      // If it fails to parse as JSON array, try JSONL parsing
    }
  }

  // Efficient streaming line-by-line JSONL parser using 1MB chunks and StringDecoder
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch (err) {
    throw new Error(`Failed to open session file: ${filePath}`);
  }

  const buffer = Buffer.alloc(1024 * 1024);
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let header: SessionHeader | null = null;
  const entries: SessionEntry[] = [];

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIdx = pending.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = pending.slice(0, newlineIdx).trim();
        pending = pending.slice(newlineIdx + 1);
        newlineIdx = pending.indexOf("\n");

        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (!header) {
            header = parsed as SessionHeader;
          } else {
            entries.push(parsed as SessionEntry);
          }
        } catch {
          // Gracefully skip malformed JSON lines
        }
      }
    }

    const finalLine = pending.trim();
    if (finalLine) {
      try {
        const parsed = JSON.parse(finalLine);
        if (!header) {
          header = parsed as SessionHeader;
        } else {
          entries.push(parsed as SessionEntry);
        }
      } catch {
        // Gracefully skip malformed final line
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  if (!header) {
    throw new Error(`Invalid session file structure (missing header) in ${filePath}`);
  }

  let migrated = false;
  if (header.version < 3) {
    migrateToCurrentVersion(header, entries);
    migrated = true;
  }

  return { header, entries, migrated };
}

// ==========================================
// 4. Tree Resolvers
// ==========================================

export function buildSessionPath(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>
): SessionEntry[] {
  const index = byId || new Map<string, SessionEntry>();
  if (index.size === 0) {
    for (const entry of entries) {
      index.set(entry.id, entry);
    }
  }

  let currentId = leafId;
  if (currentId === undefined || currentId === null) {
    if (entries.length > 0) {
      currentId = entries[entries.length - 1].id;
    } else {
      return [];
    }
  }

  const path: SessionEntry[] = [];
  let current = index.get(currentId);
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) {
      break; // Circular reference protection
    }
    visited.add(current.id);
    path.push(current);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }

  path.reverse();
  return path;
}

export function buildContextEntries(path: SessionEntry[]): SessionEntry[] {
  let compactionIdx = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === "compaction") {
      compactionIdx = i;
      break;
    }
  }

  if (compactionIdx === -1) {
    return path;
  }

  const compaction = path[compactionIdx] as CompactionEntry;
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
  return contextEntries;
}

export function sessionEntryToContextMessages(entry: SessionEntry): Message[] {
  switch (entry.type) {
    case "message": {
      const msgEntry = entry as SessionMessageEntry;
      return [msgEntry.message];
    }
    case "custom_message": {
      const customMsgEntry = entry as CustomMessageEntry;
      return [customMsgEntry.message];
    }
    case "compaction": {
      const compaction = entry as CompactionEntry;
      return [{
        role: "system",
        content: compaction.summary
      }];
    }
    case "branch_summary": {
      const branchSummary = entry as BranchSummaryEntry;
      return [{
        role: "system",
        content: `[Branch Summary: ${branchSummary.summary}]`
      }];
    }
    default:
      return [];
  }
}

export interface SessionContext {
  messages: Message[];
  thinkingLevel?: number;
  model?: string;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  const path = buildSessionPath(entries, leafId, byId);
  const contextEntries = buildContextEntries(path);

  let thinkingLevel: number | undefined;
  let model: string | undefined;

  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = (entry as ThinkingLevelChangeEntry).thinkingLevel;
    } else if (entry.type === "model_change") {
      model = (entry as ModelChangeEntry).model;
    }
  }

  const messages = contextEntries.flatMap(sessionEntryToContextMessages);
  return { messages, thinkingLevel, model };
}

// ==========================================
// 5. Message Equality Helper
// ==========================================

export function messagesEqual(m1: Message, m2: Message): boolean {
  if (m1.role !== m2.role) return false;
  if (m1.content !== m2.content) return false;
  if (m1.name !== m2.name) return false;
  if (m1.tool_call_id !== m2.tool_call_id) return false;
  if ((m1.tool_calls?.length || 0) !== (m2.tool_calls?.length || 0)) return false;
  if (m1.tool_calls && m2.tool_calls) {
    for (let i = 0; i < m1.tool_calls.length; i++) {
      const tc1 = m1.tool_calls[i];
      const tc2 = m2.tool_calls[i];
      if (tc1.id !== tc2.id) return false;
      if (tc1.function.name !== tc2.function.name) return false;
      if (JSON.stringify(tc1.function.arguments) !== JSON.stringify(tc2.function.arguments)) return false;
    }
  }
  return true;
}

// ==========================================
// 6. Active Session Manager
// ==========================================

export class Session {
  public filePath: string;
  public header: SessionHeader;
  public fileEntries: SessionEntry[];
  public byId: Map<string, SessionEntry>;
  public leafId: string | null;
  public flushed: boolean;

  constructor(filePath: string, header: SessionHeader, entries: SessionEntry[] = []) {
    this.filePath = filePath;
    this.header = header;
    this.fileEntries = entries;
    this.byId = new Map();
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
    }
    this.leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    this.flushed = fs.existsSync(filePath);
  }

  private _appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);
  }

  private _persist(entry: SessionEntry): void {
    const isAssistant = entry.type === "message" && (entry as SessionMessageEntry).message.role === "assistant";
    if (isAssistant && !this.flushed) {
      // First assistant message triggers bulk flush of header and all buffered entries
      this.flush();
    } else if (this.flushed) {
      // Simple append sync
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    }
  }

  public flush(): void {
    if (!this.flushed) {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const lines = [
        JSON.stringify(this.header),
        ...this.fileEntries.map(e => JSON.stringify(e))
      ];
      fs.writeFileSync(this.filePath, lines.join("\n") + "\n", "utf8");
      this.flushed = true;
    }
  }

  public appendMessage(message: Message): void {
    this._appendEntry({
      id: `msg_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      type: "message",
      message
    });
  }

  public appendThinkingLevelChange(thinkingLevel: number): void {
    this._appendEntry({
      id: `tlc_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      type: "thinking_level_change",
      thinkingLevel
    });
  }

  public appendModelChange(model: string): void {
    this._appendEntry({
      id: `mc_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      type: "model_change",
      model
    });
  }

  public appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore?: number): void {
    this._appendEntry({
      id: `comp_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      type: "compaction",
      summary,
      firstKeptEntryId,
      tokensBefore
    });
  }

  public branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`);
    }
    this.leafId = branchFromId;
  }

  public branchWithSummary(branchFromId: string, summary: string): void {
    this.branch(branchFromId);
    this._appendEntry({
      id: `brsum_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`,
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      type: "branch_summary",
      summary,
      branchFromId
    });
  }

  public resetLeaf(): void {
    this.leafId = null;
  }

  public static forkFrom(srcFilePath: string, destFilePath: string, newSessionId: string, newCwd: string): Session {
    const { header, entries } = loadEntriesFromFile(srcFilePath);
    const newHeader: SessionHeader = {
      version: 3,
      sessionId: newSessionId,
      cwd: newCwd,
      createdAt: new Date().toISOString(),
      parentSession: header.sessionId
    };

    const dir = path.dirname(destFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify(newHeader),
      ...entries.map(e => JSON.stringify(e))
    ];
    fs.writeFileSync(destFilePath, lines.join("\n") + "\n", "utf8");

    return new Session(destFilePath, newHeader, entries);
  }

  public createBranchedSession(destFilePath: string, newSessionId: string): Session {
    const pathEntries = buildSessionPath(this.fileEntries, this.leafId, this.byId);
    const newHeader: SessionHeader = {
      version: 3,
      sessionId: newSessionId,
      cwd: this.header.cwd,
      createdAt: new Date().toISOString(),
      parentSession: this.header.sessionId
    };

    const branchedEntries: SessionEntry[] = [];
    let prevId: string | null = null;
    for (const entry of pathEntries) {
      if (entry.type === "label") {
        continue;
      }
      const newEntry: SessionEntry = { ...entry, parentId: prevId } as SessionEntry;
      branchedEntries.push(newEntry);
      prevId = newEntry.id;
    }

    const dir = path.dirname(destFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify(newHeader),
      ...branchedEntries.map(e => JSON.stringify(e))
    ];
    fs.writeFileSync(destFilePath, lines.join("\n") + "\n", "utf8");

    return new Session(destFilePath, newHeader, branchedEntries);
  }
}

// ==========================================
// 7. SessionStore Compatibility Wrapper
// ==========================================

export class SessionStore {
  public static getSessionsDir(): string {
    const homeDir = os.homedir();
    const resolvedCwd = process.cwd();
    const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return path.join(homeDir, ".harness", "agent", "session", safePath);
  }

  /**
   * Saves a conversation session transcript to disk.
   */
  public static async saveSession(sessionId: string, messages: Message[]): Promise<void> {
    const dir = this.getSessionsDir();
    await fs.promises.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${sessionId}.jsonl`);

    let header: SessionHeader;
    let entries: SessionEntry[] = [];

    if (fs.existsSync(filePath)) {
      try {
        const loaded = loadEntriesFromFile(filePath);
        header = loaded.header;
        entries = loaded.entries;
      } catch {
        header = {
          version: 3,
          sessionId,
          cwd: process.cwd(),
          createdAt: new Date().toISOString()
        };
      }
    } else {
      header = {
        version: 3,
        sessionId,
        cwd: process.cwd(),
        createdAt: new Date().toISOString()
      };
    }

    const session = new Session(filePath, header, entries);

    // Find where incoming messages diverge from the current path
    const pathEntries = buildSessionPath(entries, session.leafId);
    const pathMessages = pathEntries.flatMap(entry => {
      const msgs = sessionEntryToContextMessages(entry);
      return msgs.map(m => ({ entryId: entry.id, msg: m }));
    });

    let divergenceIdx = 0;
    while (divergenceIdx < messages.length && divergenceIdx < pathMessages.length) {
      if (!messagesEqual(messages[divergenceIdx], pathMessages[divergenceIdx].msg)) {
        break;
      }
      divergenceIdx++;
    }

    // Rewind/branch leaf
    if (divergenceIdx === 0) {
      session.resetLeaf();
    } else {
      session.branch(pathMessages[divergenceIdx - 1].entryId);
    }

    // Append remaining messages
    for (let i = divergenceIdx; i < messages.length; i++) {
      session.appendMessage(messages[i]);
    }

    session.flush();

    // Track this as the latest session ID
    const latestPath = path.join(dir, "latest_id.txt");
    await fs.promises.writeFile(latestPath, sessionId, "utf-8");
  }

  /**
   * Loads a saved session from disk. Returns an empty array if not found or corrupted.
   */
  public static async loadSession(sessionId: string): Promise<Message[]> {
    const dir = this.getSessionsDir();
    const filePathJsonl = path.join(dir, `${sessionId}.jsonl`);
    const filePathJson = path.join(dir, `${sessionId}.json`);

    let targetPath = filePathJsonl;
    if (!fs.existsSync(filePathJsonl) && fs.existsSync(filePathJson)) {
      targetPath = filePathJson;
    }

    try {
      const { entries } = loadEntriesFromFile(targetPath);
      const pathEntries = buildSessionPath(entries);
      return pathEntries.flatMap(sessionEntryToContextMessages);
    } catch {
      return [];
    }
  }

  /**
   * Gets the most recently active session ID.
   */
  public static async getLatestSessionId(): Promise<string | null> {
    const dir = this.getSessionsDir();
    const latestPath = path.join(dir, "latest_id.txt");

    try {
      const sessionId = (await fs.promises.readFile(latestPath, "utf-8")).trim();
      if (sessionId) {
        // Verify the session file actually exists (either .jsonl or .json)
        const filePathJsonl = path.join(dir, `${sessionId}.jsonl`);
        const filePathJson = path.join(dir, `${sessionId}.json`);
        try {
          await fs.promises.access(filePathJsonl);
          return sessionId;
        } catch {
          await fs.promises.access(filePathJson);
          return sessionId;
        }
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Lists all saved sessions, sorted by modification date (newest first).
   */
  public static async listSessions(): Promise<{ id: string; date: Date }[]> {
    const dir = this.getSessionsDir();
    try {
      const files = await fs.promises.readdir(dir);
      const sessions: { id: string; date: Date }[] = [];

      for (const file of files) {
        if (file.endsWith(".jsonl") || file.endsWith(".json")) {
          const id = file.endsWith(".jsonl") ? path.basename(file, ".jsonl") : path.basename(file, ".json");
          const stats = await fs.promises.stat(path.join(dir, file));
          sessions.push({ id, date: stats.mtime });
        }
      }

      return sessions.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }

  /**
   * Deletes a session file from disk.
   */
  public static async deleteSession(sessionId: string): Promise<void> {
    const dir = this.getSessionsDir();
    const filePathJsonl = path.join(dir, `${sessionId}.jsonl`);
    const filePathJson = path.join(dir, `${sessionId}.json`);

    try {
      await fs.promises.unlink(filePathJsonl);
    } catch {}
    try {
      await fs.promises.unlink(filePathJson);
    } catch {}

    try {
      const latestId = await this.getLatestSessionId();
      if (latestId === sessionId) {
        await fs.promises.unlink(path.join(dir, "latest_id.txt"));
      }
    } catch {}
  }
}
