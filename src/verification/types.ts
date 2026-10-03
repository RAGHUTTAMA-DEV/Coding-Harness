/**
 * Coding-Harness Verification Subsystem Types
 * Specification Reference: Section 2 (Target Architecture), Section 4, Section 34 (Integration Tests 1 & 2).
 */

export type TaskType =
  | "bug_fix"
  | "feature"
  | "refactor"
  | "debugging"
  | "testing"
  | "security"
  | "repo_navigation"
  | "multi_step"
  | "general";

export interface DiscoveredVerification {
  testCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  customCommands?: string[];
  packageManager?: "bun" | "npm" | "yarn" | "pnpm" | "cargo" | "python";
}

export interface TaskAnalysis {
  taskType: TaskType;
  summary: string;
  primaryObjective: string;
  requirements: string[];
  forbiddenPaths: string[];
  suggestedPlan: string[];
  discoveredVerification: DiscoveredVerification;
}

export interface VerificationConfig {
  /** Test command to execute (e.g. 'npm test', 'bun test') */
  testCommand?: string;
  /** Typecheck command to execute (e.g. 'tsc --noEmit') */
  typecheckCommand?: string;
  /** Build command to execute (e.g. 'npm run build') */
  buildCommand?: string;
  /** Lint command to execute (e.g. 'npm run lint') */
  lintCommand?: string;
  /** Additional custom verification commands */
  customCommands?: string[];
  /** File paths or patterns forbidden from modification */
  forbiddenPaths?: string[];
  /** Whether to auto-discover commands from package.json/tsconfig if not specified (default: true) */
  autoDiscover?: boolean;
  /** Maximum number of verification failure -> recovery cycles before giving up (default: 4) */
  maxVerificationCycles?: number;
  /** Timeout per verification command in milliseconds (default: 60000) */
  timeoutMs?: number;
}

export interface VerificationCheckResult {
  name: "build" | "typecheck" | "tests" | "lint" | "forbidden_paths" | "custom";
  command?: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  timestamp: string;
  cycle: number;
  durationMs: number;
  checks: VerificationCheckResult[];
  failureSummary?: string;
  restoredCheckpointId?: string;
}
