import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  SnapshotMetadata,
  RollbackOptions,
  RollbackResult,
  DEFAULT_SNAPSHOT_IGNORES
} from "./types";

export class RollbackManager {
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
  }

  private isPathIgnored(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, "/");
    for (const pattern of DEFAULT_SNAPSHOT_IGNORES) {
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

  private cleanEmptyDirs(dir: string, baseDir: string = dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
        if (this.isPathIgnored(relPath)) continue;
        this.cleanEmptyDirs(fullPath, baseDir);
      }
    }

    if (dir !== baseDir) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        try {
          fs.rmdirSync(dir);
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * Executes rollback of the workspace to the specified snapshot state.
   */
  public async rollback(
    snapshot: SnapshotMetadata,
    options?: RollbackOptions
  ): Promise<RollbackResult> {
    const startTime = Date.now();
    const cleanUntracked = options?.cleanUntracked ?? true;

    try {
      if (snapshot.isGitRepo && snapshot.gitRef) {
        return this.rollbackGit(snapshot, cleanUntracked, startTime);
      } else {
        return this.rollbackFiles(snapshot, cleanUntracked, startTime);
      }
    } catch (err: any) {
      return {
        success: false,
        targetSnapshotId: snapshot.id,
        restoredFiles: [],
        deletedFiles: [],
        durationMs: Date.now() - startTime,
        error: err.message
      };
    }
  }

  // ==========================================
  // Git-Based Rollback
  // ==========================================

  private rollbackGit(
    snapshot: SnapshotMetadata,
    cleanUntracked: boolean,
    startTime: number
  ): RollbackResult {
    const gitRef = snapshot.gitRef!;
    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];

    // 1. Get list of files in the target snapshot commit
    const snapshotFilesRaw = execSync(`git ls-tree -r --name-only ${gitRef}`, {
      cwd: this.workspaceDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const snapshotFiles = new Set(
      snapshotFilesRaw
        .split(/\r?\n/)
        .map((f) => f.trim().replace(/\\/g, "/"))
        .filter(Boolean)
    );

    // 2. Checkout all snapshot files over the working tree
    execSync(`git checkout ${gitRef} -- .`, {
      cwd: this.workspaceDir,
      stdio: ["ignore", "ignore", "ignore"]
    });

    for (const file of snapshotFiles) {
      restoredFiles.push(file);
    }

    // 3. Remove untracked files that were created after the snapshot
    if (cleanUntracked) {
      const currentWorkspaceFiles = this.getAllWorkspaceFiles(this.workspaceDir);
      for (const relPath of currentWorkspaceFiles) {
        if (!snapshotFiles.has(relPath) && !this.isPathIgnored(relPath)) {
          const absPath = path.join(this.workspaceDir, relPath);
          try {
            if (fs.existsSync(absPath)) {
              fs.unlinkSync(absPath);
              deletedFiles.push(relPath);
            }
          } catch {
            // Ignore
          }
        }
      }
      this.cleanEmptyDirs(this.workspaceDir);
    }

    return {
      success: true,
      targetSnapshotId: snapshot.id,
      restoredFiles,
      deletedFiles,
      durationMs: Date.now() - startTime
    };
  }

  // ==========================================
  // File-Based Fallback Rollback
  // ==========================================

  private rollbackFiles(
    snapshot: SnapshotMetadata,
    cleanUntracked: boolean,
    startTime: number
  ): RollbackResult {
    const backupDir = snapshot.backupPath;
    if (!backupDir || !fs.existsSync(backupDir)) {
      throw new Error(`Backup storage folder not found for snapshot ${snapshot.id}`);
    }

    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];

    const snapshotFiles = this.getAllWorkspaceFiles(backupDir);
    const snapSet = new Set(snapshotFiles);

    // 1. Copy files from snapshot backup to workspace
    for (const relPath of snapshotFiles) {
      const source = path.join(backupDir, relPath);
      const target = path.join(this.workspaceDir, relPath);
      const parentDir = path.dirname(target);

      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      fs.copyFileSync(source, target);
      restoredFiles.push(relPath);
    }

    // 2. Clean files not present in snapshot
    if (cleanUntracked) {
      const currentFiles = this.getAllWorkspaceFiles(this.workspaceDir);
      for (const relPath of currentFiles) {
        if (!snapSet.has(relPath) && !this.isPathIgnored(relPath)) {
          const absPath = path.join(this.workspaceDir, relPath);
          try {
            if (fs.existsSync(absPath)) {
              fs.unlinkSync(absPath);
              deletedFiles.push(relPath);
            }
          } catch {
            // Ignore
          }
        }
      }
      this.cleanEmptyDirs(this.workspaceDir);
    }

    return {
      success: true,
      targetSnapshotId: snapshot.id,
      restoredFiles,
      deletedFiles,
      durationMs: Date.now() - startTime
    };
  }
}
