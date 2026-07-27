import * as fs from "fs/promises";
import * as path from "path";
import { Message } from "../client";

export class SessionStore {
  private static getSessionsDir(): string {
    return path.resolve(process.cwd(), ".sessions");
  }

  /**
   * Saves a conversation session transcript to disk.
   */
  static async saveSession(sessionId: string, messages: Message[]): Promise<void> {
    const dir = this.getSessionsDir();
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(messages, null, 2), "utf-8");

    // Track this as the latest session ID
    const latestPath = path.join(dir, "latest_id.txt");
    await fs.writeFile(latestPath, sessionId, "utf-8");
  }

  /**
   * Loads a saved session from disk. Returns an empty array if not found or corrupted.
   */
  static async loadSession(sessionId: string): Promise<Message[]> {
    const dir = this.getSessionsDir();
    const filePath = path.join(dir, `${sessionId}.json`);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as Message[];
    } catch {
      return [];
    }
  }

  /**
   * Gets the most recently active session ID.
   */
  static async getLatestSessionId(): Promise<string | null> {
    const dir = this.getSessionsDir();
    const latestPath = path.join(dir, "latest_id.txt");

    try {
      const sessionId = (await fs.readFile(latestPath, "utf-8")).trim();
      if (sessionId) {
        // Verify the session file actually exists
        const filePath = path.join(dir, `${sessionId}.json`);
        await fs.access(filePath);
        return sessionId;
      }
    } catch {
      // Ignore errors (e.g. file doesn't exist)
    }
    return null;
  }

  /**
   * Lists all saved sessions, sorted by modification date (newest first).
   */
  static async listSessions(): Promise<{ id: string; date: Date }[]> {
    const dir = this.getSessionsDir();
    try {
      const files = await fs.readdir(dir);
      const sessions: { id: string; date: Date }[] = [];

      for (const file of files) {
        if (file.endsWith(".json")) {
          const id = path.basename(file, ".json");
          const stats = await fs.stat(path.join(dir, file));
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
  static async deleteSession(sessionId: string): Promise<void> {
    const dir = this.getSessionsDir();
    const filePath = path.join(dir, `${sessionId}.json`);
    try {
      await fs.unlink(filePath);
    } catch {}

    try {
      const latestId = await this.getLatestSessionId();
      if (latestId === sessionId) {
        await fs.unlink(path.join(dir, "latest_id.txt"));
      }
    } catch {}
  }
}
