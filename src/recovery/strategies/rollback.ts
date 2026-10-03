/**
 * Rollback Recovery Strategy
 * Restores workspace files and/or checkpoints to a known healthy state using SnapshotManager.
 * Specification Reference: Section 27, 28, 29, and Section 34 (Integration Test 6).
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class RollbackStrategy implements RecoveryStrategy {
  public readonly action = "ROLLBACK";

  async execute(
    context: FailureContext,
    engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    const currentRollbacks = engine.getRollbackCount();
    if (currentRollbacks >= engine.limits.maxRollbacks) {
      return {
        action: "ROLLBACK",
        success: false,
        message: `Maximum rollback limit (${engine.limits.maxRollbacks}) reached for this task.`,
        instructionForAgent: `Maximum rollbacks reached. You cannot roll back again. Either resolve current state or abort.`
      };
    }

    if (!engine.snapshotManager) {
      return {
        action: "ROLLBACK",
        success: false,
        message: "No SnapshotManager available in recovery context to perform rollback.",
        instructionForAgent: "Snapshot rollback unavailable. Proceed with manual diagnostic inspection."
      };
    }

    let targetSnapshotId = context.lastSnapshotId;

    // If no target snapshot specified, find the most recent valid snapshot
    if (!targetSnapshotId) {
      const snapshots = await engine.snapshotManager.listSnapshots();
      if (snapshots && snapshots.length > 0) {
        targetSnapshotId = snapshots[snapshots.length - 1].id;
      }
    }

    if (!targetSnapshotId) {
      return {
        action: "ROLLBACK",
        success: false,
        message: "No snapshots found to roll back to.",
        instructionForAgent: "No workspace snapshot found. Please inspect files manually."
      };
    }

    try {
      // Execute the rollback via SnapshotManager.restoreSnapshot
      const rollbackResult = await engine.snapshotManager.restoreSnapshot(targetSnapshotId, {
        cleanUntracked: true
      });

      if (!rollbackResult.success) {
        return {
          action: "ROLLBACK",
          success: false,
          message: rollbackResult.error || "Rollback execution failed",
          instructionForAgent: `Rollback could not be completed: ${rollbackResult.error}. Shift to inspection or replanning.`
        };
      }

      const instruction = `[Recovery Action: Workspace Rolled Back]\n` +
        `The workspace has been successfully reverted to snapshot '${targetSnapshotId}'.\n` +
        `- Files Restored: ${rollbackResult.restoredFiles.length}\n` +
        `- Untracked Files Removed: ${rollbackResult.deletedUntrackedFiles?.length || 0}\n\n` +
        `All destructive or broken changes from the failing attempt have been cleared.\n` +
        `Formulate a new plan and proceed carefully from this clean baseline.`;

      return {
        action: "ROLLBACK",
        success: true,
        message: `Workspace successfully rolled back to snapshot ${targetSnapshotId}`,
        restoredSnapshotId: targetSnapshotId,
        instructionForAgent: instruction,
        customData: {
          restoredFiles: rollbackResult.restoredFiles,
          deletedUntrackedFiles: rollbackResult.deletedUntrackedFiles
        }
      };
    } catch (err: any) {
      return {
        action: "ROLLBACK",
        success: false,
        message: `Rollback failed: ${err.message}`,
        instructionForAgent: `Rollback error: ${err.message}. Switch to inspection or replanning.`
      };
    }
  }
}
