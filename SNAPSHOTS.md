# Workspace Snapshots & Checkpoints (`src/snapshots/`)

## Overview

The **Workspace Snapshots & Checkpoints** subsystem provides robust, non-destructive, version-controlled state capture and rollback capabilities for autonomous coding agents.

Rather than relying on risky manual git branches or lossy stashes, Coding-Harness uses isolated Git plumbing objects to capture 100% of the workspace state (staged files, unstaged modifications, and untracked files) without dirtying the working branch or moving `HEAD`. For environments without Git, an automated file-archive fallback ensures identical functionality.

---

## Key Features

1. **Non-Destructive Git Plumbing State Capture**:
   - Uses an isolated alternate index file (`GIT_INDEX_FILE`).
   - Writes tree and commit objects directly to Git's object database.
   - Updates snapshot references under `refs/harness/snapshots/<id>`.
   - Never alters the user's active branch, working index, or `HEAD`.
2. **Automatic Secret and Artifact Protection**:
   - Excludes `.env`, `.env.*`, `node_modules`, build artifacts (`dist`, `build`, `coverage`), and private credentials (`.pem`, `.key`, `id_rsa`) from snapshots.
3. **Comprehensive Rollback & Clean Untracked Removal**:
   - Restores modified and deleted files.
   - Cleans untracked files created after the snapshot.
   - Automatically takes a **Safety Snapshot** before rolling back, ensuring rollbacks can be undone.
4. **Full Checkpoint Capture**:
   - Checkpoints encapsulate both the workspace snapshot and runtime state:
     - Workspace file snapshot
     - Conversation message history
     - Active task and plan
     - Evaluation state
     - Performance metrics
5. **Agent Tools Integration**:
   - `create_checkpoint`: Agent takes a checkpoint before risky operations or refactoring.
   - `rollback_checkpoint`: Restores workspace and context if an operation fails.
   - `list_checkpoints`: Inspects saved checkpoints.
6. **CLI & REPL Integration**:
   - Standalone CLI: `harness snapshot` and `harness checkpoint`.
   - REPL slash commands: `/snapshot` and `/checkpoint`.

---

## Architecture

```text
                     Agent / CLI / Runtime
                               │
                               ▼
                    ┌─────────────────────┐
                    │   SnapshotManager   │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
    │  Git Plumbing │  │ RollbackMgr   │  │ SnapshotDiff  │
    │  & File Store │  │ (Clean + Undo)│  │ (LCS / Git)   │
    └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │    SnapshotStore    │
                    │ (.harness/snapshots)│
                    └─────────────────────┘
```

---

## CLI Usage

### Snapshots

```bash
# Capture current workspace state
harness snapshot create "Pre-refactor state"

# List all saved snapshots
harness snapshot list

# Show diff between current workspace and a snapshot
harness snapshot diff <snapshot-id>

# Restore workspace to a snapshot
harness snapshot restore <snapshot-id>

# Delete a snapshot
harness snapshot delete <snapshot-id>
```

### Checkpoints

```bash
# Create a checkpoint
harness checkpoint create before_major_changes "Refactoring auth system"

# List checkpoints
harness checkpoint list

# Restore checkpoint
harness checkpoint restore <checkpoint-id>
```

---

## REPL Commands

Inside the interactive REPL:
- `/snapshot create [description]` - Create a workspace snapshot
- `/snapshot list` - List recent snapshots
- `/snapshot restore <id>` - Restore workspace to snapshot
- `/snapshot diff <id>` - Show diff with snapshot
- `/checkpoint create [description]` - Create checkpoint with conversation history
- `/checkpoint list` - List checkpoints
- `/checkpoint restore <id>` - Restore workspace and conversation context

---

## Agent Tools

The Agent has native access to checkpoint tools:
- `create_checkpoint`:
  - `reason`: `"before_major_changes" | "after_successful_verification" | "before_risky_operations" | "before_recovery" | "manual"`
  - `description`: string
- `rollback_checkpoint`:
  - `checkpoint_id`: string
- `list_checkpoints`:
  - `limit`: number

---

## Verification

The subsystem is covered by automated unit and integration tests in [`src/tests/snapshots.test.ts`](file:///c:/Users/raghu/OneDrive/Documents/Coding-harness/src/tests/snapshots.test.ts):
- Git-based snapshot capture without dirtying the working branch
- Exclusion of `.env` secrets and build directories
- Diff computation against workspace and between snapshots
- Clean rollback with safety snapshot generation (Specification Integration Test 6)
- File-based fallback for non-git workspaces
- Full checkpoint creation, persistence, and restoration
- Agent tool execution
