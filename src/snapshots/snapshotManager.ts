import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  SnapshotMetadata,
  CheckpointMetadata,
  CreateSnapshotOptions,
  CreateCheckpointOptions,
  RollbackOptions,
  RollbackResult,
  SnapshotDiffResult,
  SnapshotFilter,
  CheckpointFilter,
  DEFAULT_SNAPSHOT_IGNORES
} from "./types";
import { SnapshotStore } from "./snapshotStore";
import { RollbackManager } from "./rollback";
import { SnapshotDiff } from "./diff";

export class SnapshotManager {
  private workspaceDir: string;
  private store: SnapshotStore;
  private rollbackManager: RollbackManager;
  private diffManager: SnapshotDiff;

  constructor(workspaceDir: string = process.cwd()) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.store = new SnapshotStore(this.workspaceDir);
    this.rollbackManager = new RollbackManager(this.workspaceDir);
    this.diffManager = new SnapshotDiff(this.workspaceDir);
  }

  public getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  public getStore(): SnapshotStore {
    return this.store;
  }

  /**
   * Checks if the current workspace is a valid Git repository.
   */
  public isGitRepository(): boolean {
    const gitDir = path.join(this.workspaceDir, ".git");
    if (!fs.existsSync(gitDir)) {
      return false;
    }
    try {
      const output = execSync("git rev-parse --is-inside-work-tree", {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      return output.trim() === "true";
    } catch {
      return false;
    }
  }

  private isPathIgnored(relPath: string, customIgnores: string[] = []): boolean {
    const normalized = relPath.replace(/\\/g, "/");
    const allIgnores = [...DEFAULT_SNAPSHOT_IGNORES, ...customIgnores];
    for (const pattern of allIgnores) {
      if (normalized === pattern || normalized.startsWith(pattern + "/")) {
        return true;
      }
      if (pattern.startsWith("*.") && normalized.endsWith(pattern.slice(1))) {
        return true;
      }
    }
    return false;
  }

  private getAllWorkspaceFiles(dir: string, baseDir: string = dir): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

      if (this.isPathIgnored(relPath)) continue;

      if (entry.isDirectory()) {
        results.push(...this.getAllWorkspaceFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        results.push(relPath);
      }
    }
    return results;
  }

  /**
   * Captures the complete workspace state as a Snapshot.
   * Uses non-destructive Git tree plumbing if Git is available,
   * otherwise falls back to a file archive.
   */
  public async createSnapshot(
    options?: CreateSnapshotOptions
  ): Promise<SnapshotMetadata> {
    const isGit = this.isGitRepository();
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const description = options?.description || "Workspace Snapshot";
    const creator = options?.creator || "user";
    const tags = options?.tags || [];

    if (isGit) {
      try {
        return await this.createGitSnapshot(snapshotId, description, creator, tags, options);
      } catch (err: any) {
        // Fall back to file-based snapshot if git operation encountered an issue
        return await this.createFileSnapshot(snapshotId, description, creator, tags, options);
      }
    } else {
      return await this.createFileSnapshot(snapshotId, description, creator, tags, options);
    }
  }

  private async createGitSnapshot(
    snapshotId: string,
    description: string,
    creator: any,
    tags: string[],
    options?: CreateSnapshotOptions
  ): Promise<SnapshotMetadata> {
    const gitDir = path.join(this.workspaceDir, ".git");
    const tempIndexFile = path.join(
      gitDir,
      `harness_snap_idx_${Date.now()}_${process.pid}`
    );

    const gitEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexFile,
      GIT_AUTHOR_NAME: "Coding Harness",
      GIT_AUTHOR_EMAIL: "harness@local",
      GIT_COMMITTER_NAME: "Coding Harness",
      GIT_COMMITTER_EMAIL: "harness@local"
    };

    let treeSha = "";
    let commitSha = "";
    const changedFiles: string[] = [];
    let fileCount = 0;

    try {
      // 1. Stage all files into the isolated temporary index
      execSync("git add -A", {
        cwd: this.workspaceDir,
        env: gitEnv,
        stdio: ["ignore", "ignore", "ignore"]
      });

      // 2. Unstage forbidden secrets and build artifacts from temporary index
      const ignores = [
        ".env",
        ".env.*",
        ".harness",
        ".sessions",
        "node_modules",
        "dist",
        "build",
        "coverage",
        ...(options?.customIgnores || [])
      ].join(" ");

      execSync(`git rm --cached --ignore-unmatch -r ${ignores}`, {
        cwd: this.workspaceDir,
        env: gitEnv,
        stdio: ["ignore", "ignore", "ignore"]
      });

      // 3. Write tree object
      treeSha = execSync("git write-tree", {
        cwd: this.workspaceDir,
        env: gitEnv,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();

      // 4. Identify parent commit if HEAD exists
      let parentSha = "";
      try {
        parentSha = execSync("git rev-parse --verify HEAD", {
          cwd: this.workspaceDir,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }).trim();
      } catch {
        // Initial commit with no HEAD yet
      }

      // 5. Create commit object
      const safeDesc = description.replace(/"/g, '\\"');
      const parentArg = parentSha ? `-p ${parentSha}` : "";
      commitSha = execSync(
        `git commit-tree ${treeSha} ${parentArg} -m "Harness Snapshot [${snapshotId}]: ${safeDesc}"`,
        {
          cwd: this.workspaceDir,
          env: gitEnv,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }
      ).trim();

      // 6. Update snapshot reference
      execSync(`git update-ref refs/harness/snapshots/${snapshotId} ${commitSha}`, {
        cwd: this.workspaceDir,
        env: gitEnv,
        stdio: ["ignore", "ignore", "ignore"]
      });

      // 7. Count tracked files in the snapshot tree
      const treeFilesRaw = execSync(`git ls-tree -r --name-only ${commitSha}`, {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const treeFiles = treeFilesRaw
        .split(/\r?\n/)
        .map((f) => f.trim())
        .filter(Boolean);
      fileCount = treeFiles.length;

      // 8. Determine changed files relative to parent or HEAD
      const compareRef = options?.parentSnapshotId
        ? `refs/harness/snapshots/${options.parentSnapshotId}`
        : parentSha;

      if (compareRef) {
        try {
          const diffOutput = execSync(
            `git diff-tree --no-commit-id --name-only -r ${compareRef} ${commitSha}`,
            {
              cwd: this.workspaceDir,
              encoding: "utf-8",
              stdio: ["ignore", "pipe", "ignore"]
            }
          );
          for (const line of diffOutput.split(/\r?\n/)) {
            const f = line.trim();
            if (f && !this.isPathIgnored(f)) changedFiles.push(f);
          }
        } catch {
          // Ignore
        }
      }
    } finally {
      if (fs.existsSync(tempIndexFile)) {
        try {
          fs.unlinkSync(tempIndexFile);
        } catch {
          // Ignore
        }
      }
    }

    const metadata: SnapshotMetadata = {
      id: snapshotId,
      timestamp: new Date().toISOString(),
      description,
      creator,
      workspaceDir: this.workspaceDir,
      isGitRepo: true,
      gitRef: commitSha,
      gitTree: treeSha,
      fileCount,
      parentSnapshotId: options?.parentSnapshotId,
      tags,
      changedFiles
    };

    await this.store.saveSnapshot(metadata);
    return metadata;
  }

  private async createFileSnapshot(
    snapshotId: string,
    description: string,
    creator: any,
    tags: string[],
    options?: CreateSnapshotOptions
  ): Promise<SnapshotMetadata> {
    const backupDir = path.join(this.store.getStorageDir(), snapshotId, "files");
    fs.mkdirSync(backupDir, { recursive: true });

    const allFiles = this.getAllWorkspaceFiles(this.workspaceDir);
    let totalBytes = 0;

    for (const relPath of allFiles) {
      const srcPath = path.join(this.workspaceDir, relPath);
      const destPath = path.join(backupDir, relPath);
      const destParent = path.dirname(destPath);

      if (!fs.existsSync(destParent)) {
        fs.mkdirSync(destParent, { recursive: true });
      }

      fs.copyFileSync(srcPath, destPath);
      try {
        const stats = fs.statSync(srcPath);
        totalBytes += stats.size;
      } catch {
        // Ignore
      }
    }

    const metadata: SnapshotMetadata = {
      id: snapshotId,
      timestamp: new Date().toISOString(),
      description,
      creator,
      workspaceDir: this.workspaceDir,
      isGitRepo: false,
      fileCount: allFiles.length,
      backupPath: backupDir,
      sizeBytes: totalBytes,
      parentSnapshotId: options?.parentSnapshotId,
      tags,
      changedFiles: []
    };

    await this.store.saveSnapshot(metadata);
    return metadata;
  }

  /**
   * Restores the workspace to the specified snapshot state.
   * If createSafetySnapshot is true, a backup snapshot is taken before rollback.
   */
  public async restoreSnapshot(
    snapshotId: string,
    options?: RollbackOptions
  ): Promise<RollbackResult> {
    const snapshot = await this.store.getSnapshot(snapshotId);
    if (!snapshot) {
      return {
        success: false,
        targetSnapshotId: snapshotId,
        restoredFiles: [],
        deletedFiles: [],
        durationMs: 0,
        error: `Snapshot '${snapshotId}' not found.`
      };
    }

    let safetySnapshotId: string | undefined;
    if (options?.createSafetySnapshot !== false) {
      try {
        const safetySnap = await this.createSnapshot({
          description: `Automatic safety snapshot before restoring ${snapshotId}`,
          creator: "auto",
          tags: ["safety", "pre-rollback"]
        });
        safetySnapshotId = safetySnap.id;
      } catch {
        // Continue rollback even if safety snapshot fails
      }
    }

    const result = await this.rollbackManager.rollback(snapshot, options);
    result.safetySnapshotId = safetySnapshotId;
    return result;
  }

  /**
   * Creates a full task checkpoint (workspace snapshot + conversation + plan + metrics).
   */
  public async createCheckpoint(
    options: CreateCheckpointOptions
  ): Promise<CheckpointMetadata> {
    const snapshot = await this.createSnapshot({
      description: options.description || `Checkpoint: ${options.reason}`,
      creator: "checkpoint",
      tags: ["checkpoint", options.reason],
      ...options.snapshotOptions
    });

    const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const checkpoint: CheckpointMetadata = {
      id: checkpointId,
      snapshotId: snapshot.id,
      timestamp: new Date().toISOString(),
      reason: options.reason,
      description: options.description || `Checkpoint: ${options.reason}`,
      workspaceDir: this.workspaceDir,
      taskState: options.taskState,
      conversationState: options.conversationState,
      evaluationState: options.evaluationState,
      metrics: options.metrics,
      customData: options.customData
    };

    await this.store.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  /**
   * Restores a checkpoint (workspace rollback + checkpoint metadata).
   */
  public async restoreCheckpoint(
    checkpointId: string,
    options?: RollbackOptions
  ): Promise<{ rollbackResult: RollbackResult; checkpoint: CheckpointMetadata }> {
    const checkpoint = await this.store.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint '${checkpointId}' not found.`);
    }

    const rollbackResult = await this.restoreSnapshot(checkpoint.snapshotId, options);
    return { rollbackResult, checkpoint };
  }

  /**
   * Computes diff between current workspace and a snapshot, or between two snapshots.
   */
  public async diff(
    snapshotId: string,
    compareSnapshotId?: string
  ): Promise<SnapshotDiffResult> {
    const targetSnapshot = await this.store.getSnapshot(snapshotId);
    if (!targetSnapshot) {
      throw new Error(`Snapshot '${snapshotId}' not found.`);
    }

    if (compareSnapshotId) {
      const baseSnapshot = await this.store.getSnapshot(compareSnapshotId);
      if (!baseSnapshot) {
        throw new Error(`Base snapshot '${compareSnapshotId}' not found.`);
      }
      return this.diffManager.diffSnapshots(baseSnapshot, targetSnapshot);
    } else {
      return this.diffManager.diffWorkspaceWithSnapshot(targetSnapshot);
    }
  }

  // ==========================================
  // Store Delegate Methods
  // ==========================================

  public async listSnapshots(filter?: SnapshotFilter): Promise<SnapshotMetadata[]> {
    return this.store.listSnapshots(filter);
  }

  public async getSnapshot(id: string): Promise<SnapshotMetadata | null> {
    return this.store.getSnapshot(id);
  }

  public async deleteSnapshot(id: string): Promise<boolean> {
    return this.store.deleteSnapshot(id);
  }

  public async listCheckpoints(filter?: CheckpointFilter): Promise<CheckpointMetadata[]> {
    return this.store.listCheckpoints(filter);
  }

  public async getCheckpoint(id: string): Promise<CheckpointMetadata | null> {
    return this.store.getCheckpoint(id);
  }

  public async deleteCheckpoint(id: string): Promise<boolean> {
    return this.store.deleteCheckpoint(id);
  }

  public async prune(maxKeep: number = 20): Promise<number> {
    return this.store.pruneOldSnapshots(maxKeep);
  }
}
