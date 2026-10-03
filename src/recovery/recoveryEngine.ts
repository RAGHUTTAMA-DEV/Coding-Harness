/**
 * Coding-Harness Recovery Engine
 * Implements automated failure classification, recovery strategy orchestration,
 * loop handling, rollback coordination, and recovery escalation limits.
 * Specification Reference: Sections 29, 30, and 34.
 */

import {
  FailureClass,
  FailureContext,
  RecoveryAction,
  RecoveryEngineContext,
  RecoveryLimits,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "./types";
import { FailureClassifier, ClassifyInput } from "./failureClassifier";
import { LoopDetector, LoopDetectorOptions } from "./loopDetector";
import { RetryStrategy } from "./strategies/retry";
import { InspectStrategy } from "./strategies/inspect";
import { ReplanStrategy } from "./strategies/replan";
import { RollbackStrategy } from "./strategies/rollback";
import { AskUserStrategy } from "./strategies/askUser";
import { AbortStrategy } from "./strategies/abort";

export interface RecoveryEngineOptions {
  workspaceDir?: string;
  snapshotManager?: any;
  headless?: boolean;
  rl?: any;
  limits?: RecoveryLimits;
  loopDetectorOptions?: LoopDetectorOptions;
  onRecoveryStarted?: (context: FailureContext, action: RecoveryAction) => void;
  onRecoveryCompleted?: (result: RecoveryStrategyResult) => void;
}

export class RecoveryEngine {
  private workspaceDir: string;
  private snapshotManager?: any;
  private headless: boolean;
  private rl?: any;
  private limits: Required<RecoveryLimits>;
  private loopDetector: LoopDetector;
  private strategies: Map<RecoveryAction, RecoveryStrategy> = new Map();

  private totalRecoveries: number = 0;
  private rollbackCount: number = 0;
  private consecutiveFailureMap: Map<string, number> = new Map();
  private recoveryHistory: { context: FailureContext; result: RecoveryStrategyResult }[] = [];

  private onRecoveryStarted?: (context: FailureContext, action: RecoveryAction) => void;
  private onRecoveryCompleted?: (result: RecoveryStrategyResult) => void;

  constructor(options: RecoveryEngineOptions = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.snapshotManager = options.snapshotManager;
    this.headless = options.headless || false;
    this.rl = options.rl;

    this.limits = {
      maxConsecutiveRetries: options.limits?.maxConsecutiveRetries ?? 2,
      maxTotalRecoveries: options.limits?.maxTotalRecoveries ?? 10,
      maxRollbacks: options.limits?.maxRollbacks ?? 3
    };

    this.loopDetector = new LoopDetector(options.loopDetectorOptions);

    this.onRecoveryStarted = options.onRecoveryStarted;
    this.onRecoveryCompleted = options.onRecoveryCompleted;

    // Register default strategies
    this.registerStrategy(new RetryStrategy());
    this.registerStrategy(new InspectStrategy());
    this.registerStrategy(new ReplanStrategy());
    this.registerStrategy(new RollbackStrategy());
    this.registerStrategy(new AskUserStrategy());
    this.registerStrategy(new AbortStrategy());
  }

  public setEventCallbacks(callbacks: {
    onRecoveryStarted?: (context: FailureContext, action: RecoveryAction) => void;
    onRecoveryCompleted?: (result: RecoveryStrategyResult) => void;
  }): void {
    if (callbacks.onRecoveryStarted !== undefined) {
      this.onRecoveryStarted = callbacks.onRecoveryStarted;
    }
    if (callbacks.onRecoveryCompleted !== undefined) {
      this.onRecoveryCompleted = callbacks.onRecoveryCompleted;
    }
  }

  public registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.set(strategy.action, strategy);
  }

  public getLoopDetector(): LoopDetector {
    return this.loopDetector;
  }

  public getTotalRecoveries(): number {
    return this.totalRecoveries;
  }

  public getRollbackCount(): number {
    return this.rollbackCount;
  }

  public static getActionSignature(toolName?: string, toolArgs?: any, fallback?: string): string {
    const argsSig = LoopDetector.normalizeArgs(toolName || "", toolArgs);
    return `${toolName || "action"}:${argsSig || fallback || "operation"}`;
  }

  public getConsecutiveFailures(signature: string): number {
    return this.consecutiveFailureMap.get(signature) || 0;
  }

  public getRecoveryHistory(): { context: FailureContext; result: RecoveryStrategyResult }[] {
    return [...this.recoveryHistory];
  }

  /**
   * Record a tool execution into loop detector and return loop check result
   */
  public recordAction(
    toolName: string,
    args: any,
    outcome: "success" | "failure",
    errorOrOutput?: string
  ) {
    return this.loopDetector.recordAction(toolName, args, outcome, errorOrOutput);
  }

  /**
   * Determine the optimal recovery action based on context, repetition, and limits.
   */
  public selectStrategyAction(context: FailureContext): RecoveryAction {
    const signature = RecoveryEngine.getActionSignature(
      context.toolName,
      context.toolArgs,
      context.failureClass
    );
    const consecutive = this.getConsecutiveFailures(signature);

    // 1. Budget exhausted -> immediate abort
    if (context.failureClass === "BUDGET_EXCEEDED") {
      return "ABORT";
    }

    // 2. Global recovery limit reached -> ask user or abort
    if (this.totalRecoveries >= this.limits.maxTotalRecoveries) {
      return this.headless ? "ABORT" : "ASK_USER";
    }

    // 3. Security Guardrail blocked -> inspect alternative compliant methods (never retry directly)
    if (context.failureClass === "POLICY_BLOCK") {
      return "INSPECT";
    }

    // 4. Repeated failure / Loop detected
    if (context.failureClass === "REPEATED_FAILURE" || context.loopDetected) {
      if (this.snapshotManager && this.rollbackCount < this.limits.maxRollbacks) {
        return "ROLLBACK";
      }
      return "REPLAN";
    }

    // 5. Verification failures: Tests, Typecheck, Build
    if (
      context.failureClass === "TEST_FAILURE" ||
      context.failureClass === "TYPECHECK_FAILURE" ||
      context.failureClass === "BUILD_FAILURE"
    ) {
      if (consecutive >= 3) {
        if (this.snapshotManager && this.rollbackCount < this.limits.maxRollbacks) {
          return "ROLLBACK";
        }
        return "REPLAN";
      }
      return "INSPECT";
    }

    // 6. Model failure / Timeout
    if (context.failureClass === "MODEL_FAILURE" || context.failureClass === "TIMEOUT") {
      if (consecutive <= this.limits.maxConsecutiveRetries) {
        return "RETRY";
      }
      return "INSPECT";
    }

    // 7. General Tool failure
    if (consecutive <= this.limits.maxConsecutiveRetries) {
      return "RETRY";
    }
    if (consecutive === this.limits.maxConsecutiveRetries + 1) {
      return "INSPECT";
    }

    return "REPLAN";
  }

  /**
   * Classifies an incident and executes the appropriate recovery strategy.
   */
  public async handleIncident(
    input: ClassifyInput & {
      description?: string;
      lastSnapshotId?: string;
      lastCheckpointId?: string;
      iteration?: number;
    }
  ): Promise<RecoveryStrategyResult> {
    const failureClass = FailureClassifier.classify(input);
    const loopStatus = this.loopDetector.checkLoop();

    const signature = RecoveryEngine.getActionSignature(
      input.toolName,
      input.toolArgs,
      failureClass
    );
    const consecutive = (this.consecutiveFailureMap.get(signature) || 0) + 1;
    this.consecutiveFailureMap.set(signature, consecutive);

    const context: FailureContext = {
      failureClass: loopStatus.loopDetected ? "REPEATED_FAILURE" : failureClass,
      description: input.description || FailureClassifier.explain(failureClass, input),
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      error: input.error,
      output: input.output,
      exitCode: input.exitCode,
      consecutiveFailures: consecutive,
      loopDetected: loopStatus.loopDetected,
      loopPattern: loopStatus.pattern,
      lastSnapshotId: input.lastSnapshotId,
      lastCheckpointId: input.lastCheckpointId,
      iteration: input.iteration
    };

    return this.handleFailure(context);
  }

  /**
   * Execute recovery for a specified FailureContext
   */
  public async handleFailure(context: FailureContext): Promise<RecoveryStrategyResult> {
    this.totalRecoveries++;
    const chosenAction = this.selectStrategyAction(context);

    if (this.onRecoveryStarted) {
      this.onRecoveryStarted(context, chosenAction);
    }

    const strategy = this.strategies.get(chosenAction);
    if (!strategy) {
      const fallbackResult: RecoveryStrategyResult = {
        action: "ABORT",
        success: false,
        message: `Recovery strategy '${chosenAction}' not registered.`,
        abortReason: `Missing strategy implementation for ${chosenAction}`
      };
      return fallbackResult;
    }

    const engineContext: RecoveryEngineContext = {
      workspaceDir: this.workspaceDir,
      snapshotManager: this.snapshotManager,
      headless: this.headless,
      rl: this.rl,
      limits: this.limits,
      getConsecutiveFailures: (sig: string) => this.getConsecutiveFailures(sig),
      getTotalRecoveries: () => this.totalRecoveries,
      getRollbackCount: () => this.rollbackCount
    };

    let result = await strategy.execute(context, engineContext);

    // If strategy execution failed (e.g., retry was exhausted or rollback couldn't find snapshot),
    // escalate to the next fallback strategy (INSPECT -> REPLAN -> ABORT)
    if (!result.success) {
      if (chosenAction === "RETRY") {
        const inspectStrat = this.strategies.get("INSPECT");
        if (inspectStrat) {
          result = await inspectStrat.execute(context, engineContext);
        }
      } else if (chosenAction === "ROLLBACK") {
        const replanStrat = this.strategies.get("REPLAN");
        if (replanStrat) {
          result = await replanStrat.execute(context, engineContext);
        }
      } else if (chosenAction === "ASK_USER") {
        const abortStrat = this.strategies.get("ABORT");
        if (abortStrat) {
          result = await abortStrat.execute(context, engineContext);
        }
      }
    }

    if (result.action === "ROLLBACK" && result.success) {
      this.rollbackCount++;
      // Reset consecutive failure tracker on successful rollback
      this.consecutiveFailureMap.clear();
      this.loopDetector.reset();
    }

    this.recoveryHistory.push({ context, result });

    if (this.onRecoveryCompleted) {
      this.onRecoveryCompleted(result);
    }

    return result;
  }

  /**
   * Reset engine counters
   */
  public reset(): void {
    this.totalRecoveries = 0;
    this.rollbackCount = 0;
    this.consecutiveFailureMap.clear();
    this.recoveryHistory = [];
    this.loopDetector.reset();
  }
}
