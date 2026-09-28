export type TaskCategory =
  | "bug-fix"
  | "feature"
  | "refactor"
  | "debugging"
  | "testing"
  | "security"
  | "repo-navigation"
  | "multi-step"
  | string;

export type TaskDifficulty = "L1" | "L2" | "L3" | "L4" | "L5";

export interface TaskVerification {
  commands?: string[];
  testCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
}

export interface TaskConstraints {
  forbiddenPaths?: string[];
  requiredPaths?: string[];
  forbiddenCommands?: string[];
}

export interface TaskLimits {
  maxIterations?: number;
  maxToolCalls?: number;
  maxExecutionTimeSeconds?: number;
}

export interface HiddenTestFile {
  path: string;
  content: string;
}

export interface TaskHiddenTests {
  files?: HiddenTestFile[];
  commands?: string[];
}

export interface EvalTask {
  id: string;
  version?: string;
  category: TaskCategory;
  difficulty?: TaskDifficulty;
  description: string;
  prompt: string;
  repository?: {
    fixture?: string;
    path?: string;
  };
  requirements?: string[];
  verification?: TaskVerification;
  hiddenTests?: TaskHiddenTests;
  constraints?: TaskConstraints;
  limits?: TaskLimits;
}

export type EvaluatorStatus = "passed" | "failed" | "skipped" | "error";

export interface EvaluatorResult {
  status: EvaluatorStatus;
  score: number; // 0.0 to 1.0
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  exitCode?: number;
  durationMs?: number;
  output?: string;
  details?: Record<string, any>;
  error?: string;
}

export interface TaskRunMetrics {
  iterations: number;
  toolCalls: number;
  tokens: number;
  durationMs: number;
  filesChanged: number;
  recoveryAttempts?: number;
  rollbackCount?: number;
  guardrailBlocks?: number;
  mcpCalls?: number;
}

export interface EvalResult {
  runId: string;
  timestamp: string;
  dataset?: string;
  taskId: string;
  taskDescription?: string;
  status: "passed" | "failed";
  evaluators: Record<string, EvaluatorResult>;
  metrics: TaskRunMetrics;
  error?: string;
}

export interface EvaluatorContext {
  task: EvalTask;
  workspaceDir: string;
  filesChanged: string[];
  metrics?: Partial<TaskRunMetrics>;
  runCommand?: (cmd: string, cwd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface Evaluator {
  name: string;
  description: string;
  evaluate(context: EvaluatorContext): Promise<EvaluatorResult>;
}
