import { Tool } from "./types";
import { SnapshotManager } from "../snapshots/snapshotManager";
import { CheckpointReason } from "../snapshots/types";

let activeSnapshotManager: SnapshotManager | null = null;

export function getActiveSnapshotManager(cwd?: string): SnapshotManager {
  if (!activeSnapshotManager || (cwd && activeSnapshotManager.getWorkspaceDir() !== cwd)) {
    activeSnapshotManager = new SnapshotManager(cwd || process.cwd());
  }
  return activeSnapshotManager;
}

export function setActiveSnapshotManager(manager: SnapshotManager): void {
  activeSnapshotManager = manager;
}

export const checkpointCreateTool: Tool = {
  name: "create_checkpoint",
  description:
    "Create a workspace checkpoint and snapshot before major edits, risky operations, or refactoring. Returns the checkpoint ID which can be used to rollback if changes fail.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        enum: [
          "before_major_changes",
          "after_successful_verification",
          "before_risky_operations",
          "before_recovery",
          "manual"
        ],
        description: "The operational reason for capturing this checkpoint."
      },
      description: {
        type: "string",
        description: "A concise summary of what workspace state this checkpoint captures."
      }
    },
    required: ["reason", "description"]
  },
  isMutating: false,
  async run(args: { reason: CheckpointReason; description: string }): Promise<string> {
    try {
      const manager = getActiveSnapshotManager();
      const checkpoint = await manager.createCheckpoint({
        reason: args.reason,
        description: args.description
      });

      return `Checkpoint successfully created.\nCheckpoint ID: ${checkpoint.id}\nSnapshot ID: ${checkpoint.snapshotId}\nReason: ${checkpoint.reason}\nDescription: ${checkpoint.description}`;
    } catch (err: any) {
      return `Error creating checkpoint: ${err.message}`;
    }
  }
};

export const checkpointRollbackTool: Tool = {
  name: "rollback_checkpoint",
  description:
    "Roll back the workspace to a previously saved checkpoint state. Restores files and removes untracked files added after the checkpoint.",
  input_schema: {
    type: "object",
    properties: {
      checkpoint_id: {
        type: "string",
        description: "The unique ID of the checkpoint to restore."
      }
    },
    required: ["checkpoint_id"]
  },
  isMutating: true,
  async run(args: { checkpoint_id: string }): Promise<string> {
    try {
      const manager = getActiveSnapshotManager();
      const { rollbackResult, checkpoint } = await manager.restoreCheckpoint(args.checkpoint_id);

      if (!rollbackResult.success) {
        return `Failed to restore checkpoint ${args.checkpoint_id}: ${rollbackResult.error}`;
      }

      return (
        `Successfully restored checkpoint '${checkpoint.id}'.\n` +
        `Restored ${rollbackResult.restoredFiles.length} file(s), deleted ${rollbackResult.deletedFiles.length} file(s) created after checkpoint.\n` +
        (rollbackResult.safetySnapshotId
          ? `(A safety snapshot was automatically created: ${rollbackResult.safetySnapshotId})\n`
          : "") +
        `Checkpoint description: ${checkpoint.description}`
      );
    } catch (err: any) {
      return `Error rolling back checkpoint: ${err.message}`;
    }
  }
};

export const checkpointListTool: Tool = {
  name: "list_checkpoints",
  description: "List recent checkpoints saved for this workspace.",
  input_schema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of checkpoints to retrieve (default: 10)."
      }
    }
  },
  isMutating: false,
  async run(args?: { limit?: number }): Promise<string> {
    try {
      const manager = getActiveSnapshotManager();
      const list = await manager.listCheckpoints({ limit: args?.limit || 10 });

      if (list.length === 0) {
        return "No checkpoints found in workspace.";
      }

      const formatted = list
        .map(
          (c) =>
            `- [${c.id}] (${c.reason}) ${c.description} (created at ${c.timestamp})`
        )
        .join("\n");

      return `Saved Checkpoints:\n${formatted}`;
    } catch (err: any) {
      return `Error listing checkpoints: ${err.message}`;
    }
  }
};
