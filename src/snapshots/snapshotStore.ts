import * as fs from "fs";
import * as path from "path";
import {
  SnapshotMetadata,
  CheckpointMetadata,
  SnapshotFilter,
  CheckpointFilter
} from "./types";

interface SnapshotStoreData {
  version: number;
  snapshots: Record<string, SnapshotMetadata>;
  checkpoints: Record<string, CheckpointMetadata>;
}

export class SnapshotStore {
  private workspaceDir: string;
  private storageDir: string;
  private metadataPath: string;

  constructor(workspaceDir: string) {
    this.workspaceDir = path.resolve(workspaceDir);
    this.storageDir = path.join(this.workspaceDir, ".harness", "snapshots");
    this.metadataPath = path.join(this.storageDir, "metadata.json");
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadData(): SnapshotStoreData {
    this.ensureStorageDir();
    if (!fs.existsSync(this.metadataPath)) {
      return {
        version: 1,
        snapshots: {},
        checkpoints: {}
      };
    }

    try {
      const content = fs.readFileSync(this.metadataPath, "utf-8");
      const parsed = JSON.parse(content);
      return {
        version: parsed.version || 1,
        snapshots: parsed.snapshots || {},
        checkpoints: parsed.checkpoints || {}
      };
    } catch {
      // In case of corrupted file, return safe empty data
      return {
        version: 1,
        snapshots: {},
        checkpoints: {}
      };
    }
  }

  private saveData(data: SnapshotStoreData): void {
    this.ensureStorageDir();
    const tempFile = path.join(
      this.storageDir,
      `metadata.json.tmp.${process.pid}.${Date.now()}`
    );
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, this.metadataPath);
  }

  public async saveSnapshot(snapshot: SnapshotMetadata): Promise<void> {
    const data = this.loadData();
    data.snapshots[snapshot.id] = snapshot;
    this.saveData(data);
  }

  public async getSnapshot(id: string): Promise<SnapshotMetadata | null> {
    const data = this.loadData();
    return data.snapshots[id] || null;
  }

  public async listSnapshots(filter?: SnapshotFilter): Promise<SnapshotMetadata[]> {
    const data = this.loadData();
    let list = Object.values(data.snapshots);

    // Sort descending by timestamp (newest first)
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.creator) {
      list = list.filter((s) => s.creator === filter.creator);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const filterTags = filter.tags;
      list = list.filter(
        (s) => s.tags && filterTags.some((tag) => s.tags!.includes(tag))
      );
    }

    if (filter?.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  public async deleteSnapshot(id: string): Promise<boolean> {
    const data = this.loadData();
    if (!data.snapshots[id]) {
      return false;
    }

    const snapshot = data.snapshots[id];
    delete data.snapshots[id];

    // If there is a file backup folder, remove it
    if (snapshot.backupPath && fs.existsSync(snapshot.backupPath)) {
      try {
        fs.rmSync(snapshot.backupPath, { recursive: true, force: true });
      } catch {
        // Ignore folder removal error
      }
    }

    this.saveData(data);
    return true;
  }

  public async saveCheckpoint(checkpoint: CheckpointMetadata): Promise<void> {
    const data = this.loadData();
    data.checkpoints[checkpoint.id] = checkpoint;
    this.saveData(data);
  }

  public async getCheckpoint(id: string): Promise<CheckpointMetadata | null> {
    const data = this.loadData();
    return data.checkpoints[id] || null;
  }

  public async listCheckpoints(filter?: CheckpointFilter): Promise<CheckpointMetadata[]> {
    const data = this.loadData();
    let list = Object.values(data.checkpoints);

    // Sort descending by timestamp
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.reason) {
      list = list.filter((c) => c.reason === filter.reason);
    }

    if (filter?.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  public async deleteCheckpoint(id: string): Promise<boolean> {
    const data = this.loadData();
    if (!data.checkpoints[id]) {
      return false;
    }

    delete data.checkpoints[id];
    this.saveData(data);
    return true;
  }

  public async pruneOldSnapshots(maxKeep: number): Promise<number> {
    const list = await this.listSnapshots();
    if (list.length <= maxKeep) {
      return 0;
    }

    const toRemove = list.slice(maxKeep);
    let deletedCount = 0;
    for (const snap of toRemove) {
      const ok = await this.deleteSnapshot(snap.id);
      if (ok) deletedCount++;
    }
    return deletedCount;
  }
}
