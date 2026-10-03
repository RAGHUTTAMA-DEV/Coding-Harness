/**
 * Abort Recovery Strategy
 * Safely halts agent execution when limits are exhausted or non-recoverable failures occur.
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class AbortStrategy implements RecoveryStrategy {
  public readonly action = "ABORT";

  async execute(
    context: FailureContext,
    engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    const totalRecoveries = engine.getTotalRecoveries();
    const reason = context.error
      ? (typeof context.error === "string" ? context.error : context.error.message)
      : context.description;

    return {
      action: "ABORT",
      success: true,
      message: `Task execution safely aborted: ${reason}`,
      abortReason: `Non-recoverable failure (${context.failureClass}): ${reason}.`,
      instructionForAgent: `CRITICAL: Task execution has been aborted by the harness. Stop all tool calls.`
    };
  }
}
