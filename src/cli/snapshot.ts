#!/usr/bin/env bun
import * as path from "path";
import { SnapshotManager } from "../snapshots/snapshotManager";
import { CheckpointReason } from "../snapshots/types";

function printUsage() {
  console.log(`
\x1b[1m\x1b[36mCODING-HARNESS - Snapshot & Checkpoint Management\x1b[0m

\x1b[1mUsage:\x1b[0m
  harness snapshot <command> [options]
  harness checkpoint <command> [options]

\x1b[1mSnapshot Commands:\x1b[0m
  \x1b[38;5;220mcreate [description]\x1b[0m         Capture current workspace state as a snapshot
  \x1b[38;5;220mlist [limit]\x1b[0m                 List saved snapshots (newest first)
  \x1b[38;5;220mrestore <snapshot-id>\x1b[0m        Rollback workspace to specified snapshot
  \x1b[38;5;220mdiff <snapshot-id> [base-id]\x1b[0m Show diff against workspace or another snapshot
  \x1b[38;5;220mdelete <snapshot-id>\x1b[0m         Delete a snapshot

\x1b[1mCheckpoint Commands:\x1b[0m
  \x1b[38;5;220mcheckpoint create [reason] [description]\x1b[0m
  \x1b[38;5;220mcheckpoint list\x1b[0m
  \x1b[38;5;220mcheckpoint restore <checkpoint-id>\x1b[0m

\x1b[1mOptions:\x1b[0m
  --cwd <path>            Target directory (default: current directory)
  -h, --help              Show this help message
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let cwd = process.cwd();

  const filteredArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--cwd" && i + 1 < rawArgs.length) {
      cwd = path.resolve(rawArgs[i + 1]);
      i++;
    } else {
      filteredArgs.push(rawArgs[i]);
    }
  }

  const manager = new SnapshotManager(cwd);
  const isCheckpointCommand = filteredArgs[0] === "checkpoint";
  const subCommand = (isCheckpointCommand ? filteredArgs[1] : (filteredArgs[0] === "snapshot" ? filteredArgs[1] : filteredArgs[0])) || "help";
  const extraArgs = isCheckpointCommand ? filteredArgs.slice(2) : (filteredArgs[0] === "snapshot" ? filteredArgs.slice(2) : filteredArgs.slice(1));

  if (subCommand === "help" || filteredArgs.includes("--help") || filteredArgs.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (isCheckpointCommand || filteredArgs[0] === "checkpoint") {
    switch (subCommand) {
      case "create": {
        const reason = (extraArgs[0] as CheckpointReason) || "manual";
        const description = extraArgs.slice(1).join(" ") || "Manual CLI Checkpoint";
        console.log(`\x1b[90mCreating checkpoint [${reason}] in ${cwd}...\x1b[0m`);
        const checkpoint = await manager.createCheckpoint({ reason, description });
        console.log(`\x1b[32m✔ Checkpoint created successfully!\x1b[0m`);
        console.log(`  \x1b[1mCheckpoint ID:\x1b[0m ${checkpoint.id}`);
        console.log(`  \x1b[1mSnapshot ID:\x1b[0m   ${checkpoint.snapshotId}`);
        console.log(`  \x1b[1mReason:\x1b[0m        ${checkpoint.reason}`);
        console.log(`  \x1b[1mDescription:\x1b[0m   ${checkpoint.description}`);
        break;
      }
      case "list": {
        const limit = extraArgs[0] ? parseInt(extraArgs[0], 10) : 20;
        const list = await manager.listCheckpoints({ limit });
        console.log(`\x1b[1m\x1b[36mCheckpoints in ${cwd} (${list.length}):\x1b[0m\n`);
        if (list.length === 0) {
          console.log(`  \x1b[90m(no checkpoints found)\x1b[0m`);
        } else {
          for (const c of list) {
            console.log(`  \x1b[38;5;220m• ${c.id}\x1b[0m \x1b[36m[${c.reason}]\x1b[0m`);
            console.log(`    \x1b[90mDate:\x1b[0m ${c.timestamp} | \x1b[90mSnapshot:\x1b[0m ${c.snapshotId}`);
            console.log(`    \x1b[90mDesc:\x1b[0m ${c.description}\n`);
          }
        }
        break;
      }
      case "restore": {
        const checkpointId = extraArgs[0];
        if (!checkpointId) {
          console.error(`\x1b[31m✖ Error: Missing checkpoint ID.\x1b[0m Usage: harness checkpoint restore <id>`);
          process.exit(1);
        }
        console.log(`\x1b[90mRestoring checkpoint '${checkpointId}'...\x1b[0m`);
        const { rollbackResult, checkpoint } = await manager.restoreCheckpoint(checkpointId);
        if (!rollbackResult.success) {
          console.error(`\x1b[31m✖ Rollback failed:\x1b[0m ${rollbackResult.error}`);
          process.exit(1);
        }
        console.log(`\x1b[32m✔ Checkpoint successfully restored!\x1b[0m`);
        console.log(`  \x1b[1mCheckpoint:\x1b[0m ${checkpoint.id} - ${checkpoint.description}`);
        console.log(`  \x1b[1mRestored:\x1b[0m   ${rollbackResult.restoredFiles.length} file(s)`);
        console.log(`  \x1b[1mCleaned:\x1b[0m    ${rollbackResult.deletedFiles.length} file(s)`);
        if (rollbackResult.safetySnapshotId) {
          console.log(`  \x1b[1mSafety Snapshot:\x1b[0m ${rollbackResult.safetySnapshotId}`);
        }
        break;
      }
      default:
        console.error(`\x1b[31mUnknown checkpoint command: ${subCommand}\x1b[0m`);
        printUsage();
        process.exit(1);
    }
    return;
  }

  // Snapshot subcommands
  switch (subCommand) {
    case "create": {
      const description = extraArgs.join(" ") || "Manual workspace snapshot";
      console.log(`\x1b[90mCapturing workspace snapshot for ${cwd}...\x1b[0m`);
      const snapshot = await manager.createSnapshot({ description });
      console.log(`\x1b[32m✔ Snapshot captured successfully!\x1b[0m`);
      console.log(`  \x1b[1mSnapshot ID:\x1b[0m  ${snapshot.id}`);
      console.log(`  \x1b[1mType:\x1b[0m         ${snapshot.isGitRepo ? "Git (ref: " + snapshot.gitRef?.slice(0, 8) + ")" : "File Archive"}`);
      console.log(`  \x1b[1mFiles Tracked:\x1b[0m ${snapshot.fileCount}`);
      console.log(`  \x1b[1mDescription:\x1b[0m   ${snapshot.description}`);
      break;
    }
    case "list": {
      const limit = extraArgs[0] ? parseInt(extraArgs[0], 10) : 20;
      const list = await manager.listSnapshots({ limit });
      console.log(`\x1b[1m\x1b[36mSnapshots in ${cwd} (${list.length}):\x1b[0m\n`);
      if (list.length === 0) {
        console.log(`  \x1b[90m(no snapshots found)\x1b[0m`);
      } else {
        for (const s of list) {
          const typeStr = s.isGitRepo ? `git:${s.gitRef?.slice(0, 7)}` : "archive";
          console.log(`  \x1b[38;5;220m• ${s.id}\x1b[0m \x1b[90m(${typeStr}, ${s.fileCount} files)\x1b[0m`);
          console.log(`    \x1b[90mDate:\x1b[0m ${s.timestamp}`);
          console.log(`    \x1b[90mDesc:\x1b[0m ${s.description}\n`);
        }
      }
      break;
    }
    case "restore": {
      const snapshotId = extraArgs[0];
      if (!snapshotId) {
        console.error(`\x1b[31m✖ Error: Missing snapshot ID.\x1b[0m Usage: harness snapshot restore <id>`);
        process.exit(1);
      }
      console.log(`\x1b[90mRestoring workspace to snapshot '${snapshotId}'...\x1b[0m`);
      const result = await manager.restoreSnapshot(snapshotId);
      if (!result.success) {
        console.error(`\x1b[31m✖ Restoration failed:\x1b[0m ${result.error}`);
        process.exit(1);
      }
      console.log(`\x1b[32m✔ Snapshot restored successfully!\x1b[0m`);
      console.log(`  \x1b[1mRestored Files:\x1b[0m ${result.restoredFiles.length}`);
      console.log(`  \x1b[1mRemoved Files:\x1b[0m  ${result.deletedFiles.length}`);
      if (result.safetySnapshotId) {
        console.log(`  \x1b[1mSafety Snapshot Created:\x1b[0m ${result.safetySnapshotId}`);
      }
      break;
    }
    case "diff": {
      const targetId = extraArgs[0];
      if (!targetId) {
        console.error(`\x1b[31m✖ Error: Missing snapshot ID.\x1b[0m Usage: harness snapshot diff <id> [base-id]`);
        process.exit(1);
      }
      const baseId = extraArgs[1];
      console.log(`\x1b[90mComputing diff for '${targetId}'...\x1b[0m`);
      const diffResult = await manager.diff(targetId, baseId);
      console.log(`\x1b[1m\x1b[36mDiff Summary:\x1b[0m ${diffResult.summary}\n`);
      if (diffResult.filesAdded.length > 0) {
        console.log(`  \x1b[32mAdded (${diffResult.filesAdded.length}):\x1b[0m ${diffResult.filesAdded.join(", ")}`);
      }
      if (diffResult.filesModified.length > 0) {
        console.log(`  \x1b[33mModified (${diffResult.filesModified.length}):\x1b[0m ${diffResult.filesModified.join(", ")}`);
      }
      if (diffResult.filesDeleted.length > 0) {
        console.log(`  \x1b[31mDeleted (${diffResult.filesDeleted.length}):\x1b[0m ${diffResult.filesDeleted.join(", ")}`);
      }
      if (diffResult.rawDiff) {
        console.log("\n" + diffResult.rawDiff);
      }
      break;
    }
    case "delete": {
      const id = extraArgs[0];
      if (!id) {
        console.error(`\x1b[31m✖ Error: Missing snapshot ID.\x1b[0m`);
        process.exit(1);
      }
      const ok = await manager.deleteSnapshot(id);
      if (ok) {
        console.log(`\x1b[32m✔ Deleted snapshot '${id}'.\x1b[0m`);
      } else {
        console.error(`\x1b[31m✖ Snapshot '${id}' not found.\x1b[0m`);
      }
      break;
    }
    default:
      console.error(`\x1b[31mUnknown snapshot command: ${subCommand}\x1b[0m`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\x1b[31mFatal error:\x1b[0m ${err.message}`);
  process.exit(1);
});
