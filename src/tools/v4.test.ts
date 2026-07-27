import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { computeDiff, formatDiff } from "../utils/diff";
import { PermissionGate } from "../permissions/permissionGate";
import { SessionStore } from "../session/sessionStore";
import { applyEditContent } from "./edit";
import { subAgentTool } from "./subagent";

describe("v4 advanced features", () => {
  // --- 1. Diff Utility Tests ---
  test("LCS computeDiff computes line additions and deletions", () => {
    const oldStr = "line 1\nline 2\nline 3";
    const newStr = "line 1\nline 2 modified\nline 3\nline 4";
    
    const diff = computeDiff(oldStr, newStr);
    
    // Check that we got correct counts
    const unchanged = diff.filter(d => d.type === "unchanged");
    const added = diff.filter(d => d.type === "added");
    const removed = diff.filter(d => d.type === "removed");
    
    expect(unchanged.length).toBe(2);
    expect(added.length).toBe(2); // "line 2 modified" and "line 4"
    expect(removed.length).toBe(1); // "line 2"
    
    expect(added[0].content).toBe("line 2 modified");
    expect(added[1].content).toBe("line 4");
    expect(removed[0].content).toBe("line 2");
  });

  test("formatDiff formats unified diff with context collapsing", () => {
    const oldStr = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10";
    const newStr = "1\n2\n3\n4 modified\n5\n6\n7\n8\n9\n10";
    
    const diff = computeDiff(oldStr, newStr);
    const formatted = formatDiff(diff, 2); // 2 lines of context
    
    expect(formatted).toContain("Hunk");
    expect(formatted).toContain("- 4");
    expect(formatted).toContain("+ 4 modified");
    expect(formatted).toContain("... [4 lines unchanged] ..."); // lines 7, 8, 9, 10 collapsed
  });

  // --- 2. Permission Gate & Policy Engine Tests ---
  test("PermissionGate auto-approves safe command patterns", async () => {
    const safeCommand = "git status";
    const approved = await PermissionGate.checkPermission("run_command", { command: safeCommand });
    expect(approved).toBe(true);
  });

  test("PermissionGate blocks dangerous command patterns", async () => {
    const dangerousCommand = "rm -rf important_file";
    const approved = await PermissionGate.checkPermission("run_command", { command: dangerousCommand });
    expect(approved).toBe(false);
  });

  // --- 3. Session Store Tests ---
  test("SessionStore saves, loads, lists, and deletes sessions", async () => {
    const sessionId = "test_session_v4_temp";
    const testMessages = [
      { role: "user" as const, content: "Hello subagent" },
      { role: "assistant" as const, content: "Hello parent" }
    ];

    try {
      // Clean up if remaining from previous failed test
      await SessionStore.deleteSession(sessionId);

      // Save session
      await SessionStore.saveSession(sessionId, testMessages);

      // Load session
      const loaded = await SessionStore.loadSession(sessionId);
      expect(loaded.length).toBe(2);
      expect(loaded[0].content).toBe("Hello subagent");
      expect(loaded[1].content).toBe("Hello parent");

      // Verify it's the latest session
      const latest = await SessionStore.getLatestSessionId();
      expect(latest).toBe(sessionId);

      // List sessions
      const list = await SessionStore.listSessions();
      expect(list.some(s => s.id === sessionId)).toBe(true);
    } finally {
      // Clean up
      await SessionStore.deleteSession(sessionId);
    }
  });

  // --- 4. Edit Tool Refactoring Tests ---
  test("applyEditContent performs exact and whitespace replacements", () => {
    const content = "const x = 5;\nconsole.log(x);";
    const result = applyEditContent(content, {
      search: "console.log(x);",
      replace: "console.log('val:', x);"
    });
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newContent).toBe("const x = 5;\nconsole.log('val:', x);");
    }
  });

  // --- 5. Subagent Registration Test ---
  test("subAgentTool properties are correct", () => {
    expect(subAgentTool.name).toBe("dispatch_subagent");
    expect(subAgentTool.isMutating).toBe(false); // Sub-agents are safe / read-only
    expect(subAgentTool.input_schema.properties.query).toBeDefined();
  });
});
