import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { SnapshotManager } from "../snapshots/snapshotManager";
import { SnapshotStore } from "../snapshots/snapshotStore";
import {
  checkpointCreateTool,
  checkpointListTool,
  checkpointRollbackTool,
  setActiveSnapshotManager
} from "../tools/checkpoint";

describe("Workspace Snapshots & Checkpoints Subsystem", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-snapshot-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on Windows file locks
    }
  });

  describe("Git-Based Snapshots & Rollback", () => {
    it("captures full workspace state (staged, unstaged, untracked) using Git plumbing without dirtying branch", async () => {
      // Initialize a test git repo
      execSync("git init", { cwd: testDir });
      execSync("git config user.name \"Test User\"", { cwd: testDir });
      execSync("git config user.email \"test@user.local\"", { cwd: testDir });

      fs.writeFileSync(path.join(testDir, "README.md"), "# Initial Project\n", "utf-8");
      fs.writeFileSync(path.join(testDir, "app.ts"), "console.log('version 1');\n", "utf-8");
      execSync("git add . && git commit -m \"Initial commit\"", { cwd: testDir });

      const initialHead = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();

      // Make an unstaged modification and add an untracked file
      fs.writeFileSync(path.join(testDir, "app.ts"), "console.log('version 2 - modified');\n", "utf-8");
      fs.writeFileSync(path.join(testDir, "untracked.ts"), "export const val = 42;\n", "utf-8");

      const manager = new SnapshotManager(testDir);
      expect(manager.isGitRepository()).toBe(true);

      const snapshot = await manager.createSnapshot({
        description: "Pre-refactor state",
        creator: "user",
        tags: ["v1", "pre-test"]
      });

      expect(snapshot.id).toStartWith("snap_");
      expect(snapshot.isGitRepo).toBe(true);
      expect(snapshot.gitRef).toBeDefined();
      expect(snapshot.gitTree).toBeDefined();
      expect(snapshot.fileCount).toBe(3); // README.md, app.ts, untracked.ts

      // Crucial requirement: HEAD of the user's repo must NOT have changed
      const currentHead = execSync("git rev-parse HEAD", { cwd: testDir, encoding: "utf-8" }).trim();
      expect(currentHead).toBe(initialHead);

      // Verify the snapshot is stored in SnapshotStore
      const fetched = await manager.getSnapshot(snapshot.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.description).toBe("Pre-refactor state");
    });

    it("excludes secrets (.env) and build artifacts from snapshots", async () => {
      execSync("git init", { cwd: testDir });
      execSync("git config user.name \"Test User\"", { cwd: testDir });
      execSync("git config user.email \"test@user.local\"", { cwd: testDir });

      fs.writeFileSync(path.join(testDir, "index.ts"), "console.log('hello');", "utf-8");
      fs.writeFileSync(path.join(testDir, ".env"), "SECRET_API_KEY=supersecret123", "utf-8");
      fs.mkdirSync(path.join(testDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "dist", "bundle.js"), "compiled output", "utf-8");

      const manager = new SnapshotManager(testDir);
      const snapshot = await manager.createSnapshot({ description: "Secret exclusion test" });

      expect(snapshot.isGitRepo).toBe(true);
      const treeFilesRaw = execSync(`git ls-tree -r --name-only ${snapshot.gitRef}`, {
        cwd: testDir,
        encoding: "utf-8"
      });
      const files = treeFilesRaw.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);

      expect(files).toContain("index.ts");
      expect(files).not.toContain(".env");
      expect(files).not.toContain("dist/bundle.js");
    });

    it("computes diff between workspace and snapshot", async () => {
      execSync("git init", { cwd: testDir });
      execSync("git config user.name \"Test User\"", { cwd: testDir });
      execSync("git config user.email \"test@user.local\"", { cwd: testDir });

      fs.writeFileSync(path.join(testDir, "code.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");
      execSync("git add . && git commit -m \"Base\"", { cwd: testDir });

      const manager = new SnapshotManager(testDir);
      const snap = await manager.createSnapshot({ description: "Base Snapshot" });

      // Now modify file and add a new one
      fs.writeFileSync(path.join(testDir, "code.ts"), "const a = 1;\nconst b = 999;\nconst c = 3;\n", "utf-8");
      fs.writeFileSync(path.join(testDir, "newfile.ts"), "export const x = 100;\n", "utf-8");

      const diffResult = await manager.diff(snap.id);
      expect(diffResult.targetSnapshotId).toBe(snap.id);
      expect(diffResult.filesModified).toContain("code.ts");
      expect(diffResult.filesAdded).toContain("newfile.ts");
      expect(diffResult.totalAddedLines).toBeGreaterThan(0);
    });

    it("performs clean rollback, restoring modified/deleted files and removing newly added files (Spec Test 6)", async () => {
      execSync("git init", { cwd: testDir });
      execSync("git config user.name \"Test User\"", { cwd: testDir });
      execSync("git config user.email \"test@user.local\"", { cwd: testDir });

      fs.writeFileSync(path.join(testDir, "important.ts"), "function correctLogic() { return true; }\n", "utf-8");
      fs.writeFileSync(path.join(testDir, "config.json"), JSON.stringify({ version: "1.0.0" }), "utf-8");
      execSync("git add . && git commit -m \"Clean base\"", { cwd: testDir });

      const manager = new SnapshotManager(testDir);
      const snapshot = await manager.createSnapshot({ description: "Pristine state" });

      // Agent performs destructive changes:
      // 1. Corrupts important.ts
      fs.writeFileSync(path.join(testDir, "important.ts"), "SYNTAX_ERROR_CRASH!!;\n", "utf-8");
      // 2. Deletes config.json
      fs.unlinkSync(path.join(testDir, "config.json"));
      // 3. Adds rogue untracked files and folders
      fs.mkdirSync(path.join(testDir, "rogue_dir"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "rogue_dir", "malicious.js"), "rm -rf /", "utf-8");

      // Verify destructive changes took effect
      expect(fs.existsSync(path.join(testDir, "config.json"))).toBe(false);
      expect(fs.readFileSync(path.join(testDir, "important.ts"), "utf-8")).toContain("SYNTAX_ERROR_CRASH");
      expect(fs.existsSync(path.join(testDir, "rogue_dir", "malicious.js"))).toBe(true);

      // Now rollback to the pristine snapshot
      const rollbackResult = await manager.restoreSnapshot(snapshot.id, {
        cleanUntracked: true,
        createSafetySnapshot: true
      });

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.safetySnapshotId).toBeDefined();

      // Verify workspace is fully restored to pristine state:
      expect(fs.existsSync(path.join(testDir, "config.json"))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, "config.json"), "utf-8")).toContain("1.0.0");
      expect(fs.readFileSync(path.join(testDir, "important.ts"), "utf-8")).toContain("function correctLogic()");
      // Rogue files created after snapshot must be gone:
      expect(fs.existsSync(path.join(testDir, "rogue_dir", "malicious.js"))).toBe(false);
    });
  });

  describe("File-Based Fallback Snapshots (Non-Git Workspaces)", () => {
    it("creates snapshots and performs rollback in non-git workspace", async () => {
      fs.writeFileSync(path.join(testDir, "file1.txt"), "hello world\n", "utf-8");
      fs.mkdirSync(path.join(testDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(testDir, "sub", "file2.txt"), "sub content\n", "utf-8");

      const manager = new SnapshotManager(testDir);
      expect(manager.isGitRepository()).toBe(false);

      const snapshot = await manager.createSnapshot({ description: "Non-git snapshot" });
      expect(snapshot.isGitRepo).toBe(false);
      expect(snapshot.fileCount).toBe(2);
      expect(snapshot.backupPath).toBeDefined();

      // Modify and delete files, and add an extra file
      fs.writeFileSync(path.join(testDir, "file1.txt"), "corrupted\n", "utf-8");
      fs.unlinkSync(path.join(testDir, "sub", "file2.txt"));
      fs.writeFileSync(path.join(testDir, "extra.txt"), "extra\n", "utf-8");

      const rollback = await manager.restoreSnapshot(snapshot.id);
      expect(rollback.success).toBe(true);

      expect(fs.readFileSync(path.join(testDir, "file1.txt"), "utf-8")).toBe("hello world\n");
      expect(fs.existsSync(path.join(testDir, "sub", "file2.txt"))).toBe(true);
      expect(fs.readFileSync(path.join(testDir, "sub", "file2.txt"), "utf-8")).toBe("sub content\n");
      expect(fs.existsSync(path.join(testDir, "extra.txt"))).toBe(false);
    });
  });

  describe("Checkpoints Subsystem", () => {
    it("creates and restores full checkpoint including conversation, task state, and plan", async () => {
      fs.writeFileSync(path.join(testDir, "main.ts"), "console.log('original');", "utf-8");

      const manager = new SnapshotManager(testDir);
      const checkpoint = await manager.createCheckpoint({
        reason: "before_major_changes",
        description: "Checkpoint before refactoring auth system",
        taskState: {
          task: "Refactor auth system",
          status: "in-progress",
          currentIteration: 5,
          plan: ["1. Read auth.ts", "2. Replace JWT", "3. Test"]
        },
        conversationState: {
          messages: [
            { role: "user", content: "Please refactor auth" },
            { role: "assistant", content: "I will now proceed with step 1." }
          ],
          totalTokens: 1200
        },
        metrics: {
          toolCalls: 12,
          filesChanged: ["main.ts"]
        }
      });

      expect(checkpoint.id).toStartWith("chk_");
      expect(checkpoint.reason).toBe("before_major_changes");
      expect(checkpoint.snapshotId).toStartWith("snap_");

      // Corrupt workspace file
      fs.writeFileSync(path.join(testDir, "main.ts"), "console.log('broken');", "utf-8");

      // Restore checkpoint
      const { rollbackResult, checkpoint: restoredChk } = await manager.restoreCheckpoint(checkpoint.id);
      expect(rollbackResult.success).toBe(true);
      expect(restoredChk.id).toBe(checkpoint.id);
      expect(restoredChk.taskState?.plan?.length).toBe(3);
      expect(restoredChk.conversationState?.messages.length).toBe(2);

      // Verify workspace file restored
      expect(fs.readFileSync(path.join(testDir, "main.ts"), "utf-8")).toBe("console.log('original');");
    });

    it("filters and lists checkpoints", async () => {
      const manager = new SnapshotManager(testDir);
      await manager.createCheckpoint({ reason: "before_risky_operations", description: "Risky step 1" });
      await manager.createCheckpoint({ reason: "after_successful_verification", description: "Step 2 done" });
      await manager.createCheckpoint({ reason: "before_recovery", description: "Before recovery" });

      const all = await manager.listCheckpoints();
      expect(all.length).toBe(3);

      const filtered = await manager.listCheckpoints({ reason: "after_successful_verification" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].description).toBe("Step 2 done");
    });
  });

  describe("Agent Checkpoint Tools", () => {
    it("allows agent to create, list, and rollback checkpoints via registered tools", async () => {
      fs.writeFileSync(path.join(testDir, "service.ts"), "export const service = 'v1';", "utf-8");

      const manager = new SnapshotManager(testDir);
      setActiveSnapshotManager(manager);

      // 1. Tool: create_checkpoint
      const createResult = await checkpointCreateTool.run({
        reason: "before_major_changes",
        description: "Agent created safety checkpoint"
      });
      expect(createResult).toContain("Checkpoint successfully created.");
      const match = createResult.match(/Checkpoint ID: (chk_[a-zA-Z0-9_]+)/);
      expect(match).not.toBeNull();
      const checkpointId = match![1];

      // 2. Tool: list_checkpoints
      const listResult = await checkpointListTool.run({ limit: 5 });
      expect(listResult).toContain(checkpointId);

      // 3. Make changes to workspace
      fs.writeFileSync(path.join(testDir, "service.ts"), "export const service = 'broken';", "utf-8");
      fs.writeFileSync(path.join(testDir, "temp_junk.txt"), "junk", "utf-8");

      // 4. Tool: rollback_checkpoint
      const rollbackToolResult = await checkpointRollbackTool.run({
        checkpoint_id: checkpointId
      });
      expect(rollbackToolResult).toContain("Successfully restored checkpoint");

      // Verify files restored
      expect(fs.readFileSync(path.join(testDir, "service.ts"), "utf-8")).toBe("export const service = 'v1';");
      expect(fs.existsSync(path.join(testDir, "temp_junk.txt"))).toBe(false);
    });
  });
});
