import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { SnapshotMetadata, SnapshotDiffResult, DEFAULT_SNAPSHOT_IGNORES } from "./types";
import { computeDiff, formatDiff } from "../utils/diff";

export class SnapshotDiff {
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
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

  /**
   * Computes diff between current workspace and a target snapshot.
   */
  public async diffWorkspaceWithSnapshot(
    snapshot: SnapshotMetadata
  ): Promise<SnapshotDiffResult> {
    if (snapshot.isGitRepo && snapshot.gitRef) {
      return this.gitDiffWorkspace(snapshot);
    } else {
      return this.fileDiffWorkspace(snapshot);
    }
  }

  /**
   * Computes diff between two snapshots (base vs target).
   */
  public async diffSnapshots(
    baseSnapshot: SnapshotMetadata,
    targetSnapshot: SnapshotMetadata
  ): Promise<SnapshotDiffResult> {
    if (
      baseSnapshot.isGitRepo &&
      targetSnapshot.isGitRepo &&
      baseSnapshot.gitRef &&
      targetSnapshot.gitRef
    ) {
      return this.gitDiffSnapshots(baseSnapshot, targetSnapshot);
    } else {
      return this.fileDiffSnapshots(baseSnapshot, targetSnapshot);
    }
  }

  // ==========================================
  // Git-Based Diff Implementations
  // ==========================================

  private gitDiffWorkspace(snapshot: SnapshotMetadata): SnapshotDiffResult {
    const gitRef = snapshot.gitRef!;
    const filesAdded: string[] = [];
    const filesModified: string[] = [];
    const filesDeleted: string[] = [];
    let totalAddedLines = 0;
    let totalDeletedLines = 0;

    let rawDiff = "";
    try {
      rawDiff = execSync(`git diff ${gitRef} -- .`, {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 10 * 1024 * 1024
      });
    } catch {
      rawDiff = "";
    }

    // Name status: M, A, D
    try {
      const nameStatusOutput = execSync(`git diff --name-status ${gitRef} -- .`, {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });

      for (const line of nameStatusOutput.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [status, ...filePathParts] = trimmed.split(/\s+/);
        const filePath = filePathParts.join(" ");
        if (this.isPathIgnored(filePath)) continue;

        if (status.startsWith("A")) {
          filesAdded.push(filePath);
        } else if (status.startsWith("D")) {
          filesDeleted.push(filePath);
        } else if (status.startsWith("M")) {
          filesModified.push(filePath);
        }
      }
    } catch {
      // Ignore git name-status error
    }

    // Untracked files in workspace
    try {
      const untrackedOutput = execSync("git ls-files --others --exclude-standard", {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });

      for (const line of untrackedOutput.split(/\r?\n/)) {
        const filePath = line.trim();
        if (!filePath || this.isPathIgnored(filePath)) continue;
        if (!filesAdded.includes(filePath)) {
          filesAdded.push(filePath);
        }
      }
    } catch {
      // Ignore
    }

    // Numstat: additions / deletions count
    try {
      const numstatOutput = execSync(`git diff --numstat ${gitRef} -- .`, {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"]
      });

      for (const line of numstatOutput.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [addStr, delStr, filePath] = trimmed.split(/\t/);
        if (filePath && this.isPathIgnored(filePath)) continue;

        const add = parseInt(addStr, 10);
        const del = parseInt(delStr, 10);
        if (!isNaN(add)) totalAddedLines += add;
        if (!isNaN(del)) totalDeletedLines += del;
      }
    } catch {
      // Ignore
    }

    const totalFilesChanged = filesAdded.length + filesModified.length + filesDeleted.length;
    const summary = `+${totalAddedLines} / -${totalDeletedLines} lines across ${totalFilesChanged} file(s) (${filesAdded.length} added, ${filesModified.length} modified, ${filesDeleted.length} deleted)`;

    return {
      targetSnapshotId: snapshot.id,
      filesAdded,
      filesModified,
      filesDeleted,
      totalAddedLines,
      totalDeletedLines,
      rawDiff,
      summary
    };
  }

  private gitDiffSnapshots(
    baseSnapshot: SnapshotMetadata,
    targetSnapshot: SnapshotMetadata
  ): SnapshotDiffResult {
    const filesAdded: string[] = [];
    const filesModified: string[] = [];
    const filesDeleted: string[] = [];
    let totalAddedLines = 0;
    let totalDeletedLines = 0;

    let rawDiff = "";
    try {
      rawDiff = execSync(`git diff ${baseSnapshot.gitRef} ${targetSnapshot.gitRef}`, {
        cwd: this.workspaceDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 10 * 1024 * 1024
      });
    } catch {
      rawDiff = "";
    }

    try {
      const nameStatus = execSync(
        `git diff --name-status ${baseSnapshot.gitRef} ${targetSnapshot.gitRef}`,
        {
          cwd: this.workspaceDir,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }
      );

      for (const line of nameStatus.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [status, ...filePathParts] = trimmed.split(/\s+/);
        const filePath = filePathParts.join(" ");
        if (this.isPathIgnored(filePath)) continue;

        if (status.startsWith("A")) {
          filesAdded.push(filePath);
        } else if (status.startsWith("D")) {
          filesDeleted.push(filePath);
        } else if (status.startsWith("M")) {
          filesModified.push(filePath);
        }
      }
    } catch {
      // Ignore
    }

    try {
      const numstat = execSync(
        `git diff --numstat ${baseSnapshot.gitRef} ${targetSnapshot.gitRef}`,
        {
          cwd: this.workspaceDir,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"]
        }
      );

      for (const line of numstat.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [addStr, delStr, filePath] = trimmed.split(/\t/);
        if (filePath && this.isPathIgnored(filePath)) continue;

        const add = parseInt(addStr, 10);
        const del = parseInt(delStr, 10);
        if (!isNaN(add)) totalAddedLines += add;
        if (!isNaN(del)) totalDeletedLines += del;
      }
    } catch {
      // Ignore
    }

    const totalFilesChanged = filesAdded.length + filesModified.length + filesDeleted.length;
    const summary = `+${totalAddedLines} / -${totalDeletedLines} lines across ${totalFilesChanged} file(s) (${filesAdded.length} added, ${filesModified.length} modified, ${filesDeleted.length} deleted)`;

    return {
      targetSnapshotId: targetSnapshot.id,
      baseSnapshotId: baseSnapshot.id,
      filesAdded,
      filesModified,
      filesDeleted,
      totalAddedLines,
      totalDeletedLines,
      rawDiff,
      summary
    };
  }

  // ==========================================
  // File-Based Fallback Diff Implementations
  // ==========================================

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

  private fileDiffWorkspace(snapshot: SnapshotMetadata): SnapshotDiffResult {
    const backupDir = snapshot.backupPath;
    const filesAdded: string[] = [];
    const filesModified: string[] = [];
    const filesDeleted: string[] = [];
    let totalAddedLines = 0;
    let totalDeletedLines = 0;
    const diffSnippets: string[] = [];

    if (!backupDir || !fs.existsSync(backupDir)) {
      return {
        targetSnapshotId: snapshot.id,
        filesAdded: [],
        filesModified: [],
        filesDeleted: [],
        totalAddedLines: 0,
        totalDeletedLines: 0,
        rawDiff: "No snapshot backup files available.",
        summary: "No diff available."
      };
    }

    const snapFiles = new Set(this.getAllWorkspaceFiles(backupDir));
    const workFiles = new Set(this.getAllWorkspaceFiles(this.workspaceDir));

    // Check added and modified files
    for (const file of workFiles) {
      const workPath = path.join(this.workspaceDir, file);
      const snapPath = path.join(backupDir, file);

      if (!snapFiles.has(file)) {
        filesAdded.push(file);
        try {
          const content = fs.readFileSync(workPath, "utf-8");
          const lines = content.split(/\r?\n/).length;
          totalAddedLines += lines;
          diffSnippets.push(`--- /dev/null\n+++ b/${file}\n[New file with ${lines} lines]`);
        } catch {
          // Binary or unreadable
        }
      } else {
        try {
          const workContent = fs.readFileSync(workPath, "utf-8");
          const snapContent = fs.readFileSync(snapPath, "utf-8");
          if (workContent !== snapContent) {
            filesModified.push(file);
            const hunks = computeDiff(snapContent, workContent);
            const formatted = formatDiff(hunks);
            diffSnippets.push(`--- a/${file}\n+++ b/${file}\n${formatted}`);

            for (const hunk of hunks) {
              if (hunk.type === "added") totalAddedLines++;
              if (hunk.type === "removed") totalDeletedLines++;
            }
          }
        } catch {
          // Binary
        }
      }
    }

    // Check deleted files
    for (const file of snapFiles) {
      if (!workFiles.has(file)) {
        filesDeleted.push(file);
        try {
          const snapContent = fs.readFileSync(path.join(backupDir, file), "utf-8");
          const lines = snapContent.split(/\r?\n/).length;
          totalDeletedLines += lines;
          diffSnippets.push(`--- a/${file}\n+++ /dev/null\n[Deleted file with ${lines} lines]`);
        } catch {
          // Binary
        }
      }
    }

    const totalFilesChanged = filesAdded.length + filesModified.length + filesDeleted.length;
    const summary = `+${totalAddedLines} / -${totalDeletedLines} lines across ${totalFilesChanged} file(s) (${filesAdded.length} added, ${filesModified.length} modified, ${filesDeleted.length} deleted)`;

    return {
      targetSnapshotId: snapshot.id,
      filesAdded,
      filesModified,
      filesDeleted,
      totalAddedLines,
      totalDeletedLines,
      rawDiff: diffSnippets.join("\n\n"),
      summary
    };
  }

  private fileDiffSnapshots(
    baseSnapshot: SnapshotMetadata,
    targetSnapshot: SnapshotMetadata
  ): SnapshotDiffResult {
    const baseDir = baseSnapshot.backupPath;
    const targetDir = targetSnapshot.backupPath;

    if (!baseDir || !fs.existsSync(baseDir) || !targetDir || !fs.existsSync(targetDir)) {
      return {
        targetSnapshotId: targetSnapshot.id,
        baseSnapshotId: baseSnapshot.id,
        filesAdded: [],
        filesModified: [],
        filesDeleted: [],
        totalAddedLines: 0,
        totalDeletedLines: 0,
        rawDiff: "Snapshot backup files unavailable.",
        summary: "No diff available."
      };
    }

    const baseFiles = new Set(this.getAllWorkspaceFiles(baseDir));
    const targetFiles = new Set(this.getAllWorkspaceFiles(targetDir));

    const filesAdded: string[] = [];
    const filesModified: string[] = [];
    const filesDeleted: string[] = [];
    let totalAddedLines = 0;
    let totalDeletedLines = 0;
    const diffSnippets: string[] = [];

    for (const file of targetFiles) {
      const targetFilePath = path.join(targetDir, file);
      const baseFilePath = path.join(baseDir, file);

      if (!baseFiles.has(file)) {
        filesAdded.push(file);
        try {
          const content = fs.readFileSync(targetFilePath, "utf-8");
          const lines = content.split(/\r?\n/).length;
          totalAddedLines += lines;
          diffSnippets.push(`--- /dev/null\n+++ b/${file}\n[Added file with ${lines} lines]`);
        } catch {
          // Ignore
        }
      } else {
        try {
          const targetContent = fs.readFileSync(targetFilePath, "utf-8");
          const baseContent = fs.readFileSync(baseFilePath, "utf-8");
          if (targetContent !== baseContent) {
            filesModified.push(file);
            const hunks = computeDiff(baseContent, targetContent);
            diffSnippets.push(`--- a/${file}\n+++ b/${file}\n${formatDiff(hunks)}`);
            for (const hunk of hunks) {
              if (hunk.type === "added") totalAddedLines++;
              if (hunk.type === "removed") totalDeletedLines++;
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    for (const file of baseFiles) {
      if (!targetFiles.has(file)) {
        filesDeleted.push(file);
        try {
          const content = fs.readFileSync(path.join(baseDir, file), "utf-8");
          const lines = content.split(/\r?\n/).length;
          totalDeletedLines += lines;
          diffSnippets.push(`--- a/${file}\n+++ /dev/null\n[Deleted file with ${lines} lines]`);
        } catch {
          // Ignore
        }
      }
    }

    const totalFilesChanged = filesAdded.length + filesModified.length + filesDeleted.length;
    const summary = `+${totalAddedLines} / -${totalDeletedLines} lines across ${totalFilesChanged} file(s) (${filesAdded.length} added, ${filesModified.length} modified, ${filesDeleted.length} deleted)`;

    return {
      targetSnapshotId: targetSnapshot.id,
      baseSnapshotId: baseSnapshot.id,
      filesAdded,
      filesModified,
      filesDeleted,
      totalAddedLines,
      totalDeletedLines,
      rawDiff: diffSnippets.join("\n\n"),
      summary
    };
  }
}
