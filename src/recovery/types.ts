/**
 * Coding-Harness Recovery Engine & Loop Detection Types
 * Specification Reference: Sections 29, 30, and 34
 */

export type FailureClass =
  | "MODEL_FAILURE"
  | "TOOL_FAILURE"
  | "TIMEOUT"
  | "TEST_FAILURE"
  | "TYPECHECK_FAILURE"
  | "BUILD_FAILURE"
  | "POLICY_BLOCK"
  | "STALL"
  | "REPEATED_FAILURE"
  | "BUDGET_EXCEEDED";

export type RecoveryAction =
  | "RETRY"
  | "INSPECT"
  | "REPLAN"
  | "ROLLBACK"
  | "REDUCE_SCOPE"
  | "SPAWN_SUBAGENT"
  | "ASK_USER"
  | "ABORT";

export interface FailureContext {
  failureClass: FailureClass;
  description: string;
  toolName?: string;
  toolArgs?: any;
  error?: string | Error;
  output?: string;
  exitCode?: number;
  consecutiveFailures?: number;
  loopDetected?: boolean;
  loopPattern?: string;
  lastSnapshotId?: string;
  lastCheckpointId?: string;
  iteration?: number;
  metadata?: Record<string, any>;
}

export interface RecoveryStrategyResult {
  action: RecoveryAction;
  success: boolean;
  message: string;
  instructionForAgent?: string;
  restoredSnapshotId?: string;
  restoredCheckpointId?: string;
  replannedSteps?: string[];
  abortReason?: string;
  customData?: Record<string, any>;
}

export interface RecoveryLimits {
  /** Maximum consecutive retries of the exact same operation before escalating */
  maxConsecutiveRetries?: number;
  /** Maximum total recovery attempts across the entire task run */
  maxTotalRecoveries?: number;
  /** Maximum rollbacks allowed per task run */
  maxRollbacks?: number;
}

export interface LoopDetectorEntry {
  toolName: string;
  argsSignature: string;
  outcome: "success" | "failure";
  errorSignature?: string;
  timestamp: number;
}

export interface LoopDetectionResult {
  loopDetected: boolean;
  count: number;
  pattern: string;
  loopType: "identical_tool_failure" | "cyclic_edits" | "repeated_test_failure" | "none";
  suggestion?: string;
}

export interface RecoveryStrategy {
  action: RecoveryAction;
  execute(context: FailureContext, engine: RecoveryEngineContext): Promise<RecoveryStrategyResult>;
}

export interface RecoveryEngineContext {
  workspaceDir: string;
  snapshotManager?: any;
  headless?: boolean;
  rl?: any;
  limits: Required<RecoveryLimits>;
  getConsecutiveFailures(signature: string): number;
  getTotalRecoveries(): number;
  getRollbackCount(): number;
}
