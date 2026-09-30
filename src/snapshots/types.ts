/**
 * Coding-Harness Snapshot & Checkpoint Types
 * Implements specifications for Git-based state capture, rollback, diffing, and checkpoints.
 */

export type SnapshotCreator = "user" | "agent" | "checkpoint" | "eval" | "recovery" | "auto";

export type CheckpointReason =
  | "before_major_changes"
  | "after_successful_verification"
  | "before_risky_operations"
  | "before_recovery"
  | "manual"
  | "interval";

export interface SnapshotMetadata {
  id: string;
  timestamp: string; // ISO 8601
  description: string;
  creator: SnapshotCreator;
  workspaceDir: string;
  isGitRepo: boolean;
  gitRef?: string; // Git commit SHA if git-backed
  gitTree?: string; // Git tree SHA if git-backed
  fileCount: number;
  parentSnapshotId?: string;
  tags?: string[];
  changedFiles?: string[];
  backupPath?: string; // Path to fallback file backup if non-git
  sizeBytes?: number;
}

export interface CheckpointTaskState {
  task?: string;
  status?: string;
  currentIteration?: number;
  plan?: string[];
  [key: string]: any;
}

export interface CheckpointConversationState {
  messages: any[];
  totalTokens?: number;
}

export interface CheckpointEvaluationState {
  lastRunId?: string;
  status?: string;
  evaluators?: Record<string, any>;
  [key: string]: any;
}

export interface CheckpointMetrics {
  iterations?: number;
  toolCalls?: number;
  tokens?: number;
  durationMs?: number;
  filesChanged?: string[];
  recoveryAttempts?: number;
  rollbackCount?: number;
  guardrailBlocks?: number;
  mcpCalls?: number;
  [key: string]: any;
}

export interface CheckpointMetadata {
  id: string;
  snapshotId: string;
  timestamp: string; // ISO 8601
  reason: CheckpointReason;
  description: string;
  workspaceDir: string;
  taskState?: CheckpointTaskState;
  conversationState?: CheckpointConversationState;
  evaluationState?: CheckpointEvaluationState;
  metrics?: CheckpointMetrics;
  customData?: Record<string, any>;
}

export interface CreateSnapshotOptions {
  description?: string;
  creator?: SnapshotCreator;
  tags?: string[];
  parentSnapshotId?: string;
  customIgnores?: string[];
}

export interface CreateCheckpointOptions {
  reason: CheckpointReason;
  description?: string;
  taskState?: CheckpointTaskState;
  conversationState?: CheckpointConversationState;
  evaluationState?: CheckpointEvaluationState;
  metrics?: CheckpointMetrics;
  customData?: Record<string, any>;
  snapshotOptions?: CreateSnapshotOptions;
}

export interface SnapshotDiffResult {
  targetSnapshotId: string;
  baseSnapshotId?: string;
  filesAdded: string[];
  filesModified: string[];
  filesDeleted: string[];
  totalAddedLines: number;
  totalDeletedLines: number;
  rawDiff: string;
  summary: string;
}

export interface RollbackOptions {
  createSafetySnapshot?: boolean; // Default true
  cleanUntracked?: boolean; // Default true
  force?: boolean;
}

export interface RollbackResult {
  success: boolean;
  targetSnapshotId: string;
  safetySnapshotId?: string;
  restoredFiles: string[];
  deletedFiles: string[];
  durationMs: number;
  error?: string;
}

export interface SnapshotFilter {
  tags?: string[];
  creator?: SnapshotCreator;
  limit?: number;
}

export interface CheckpointFilter {
  reason?: CheckpointReason;
  limit?: number;
}

export const DEFAULT_SNAPSHOT_IGNORES: string[] = [
  ".git",
  "node_modules",
  ".harness",
  ".sessions",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  "target",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.pfx",
  "id_rsa",
  "id_ed25519",
  ".DS_Store",
  "Thumbs.db"
];
