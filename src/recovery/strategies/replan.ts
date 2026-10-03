/**
 * Replan Recovery Strategy
 * Forces the agent to discard a failing hypothesis, break out of an unviable plan,
 * and formulate a fresh step-by-step strategy.
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class ReplanStrategy implements RecoveryStrategy {
  public readonly action = "REPLAN";

  async execute(
    context: FailureContext,
    _engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    const loopNotice = context.loopDetected
      ? `\n⚠️ Loop Detected: Pattern '${context.loopPattern || "repeated action"}' has failed repeatedly.`
      : "";

    const instruction = `[Recovery Action: Explicit Replanning Triggered]${loopNotice}\n` +
      `Your current approach has encountered persistent failures:\n` +
      `Failure Class: ${context.failureClass}\n` +
      `Details: ${context.description}\n\n` +
      `You MUST perform an explicit replan before continuing:\n` +
      `1. Explain why the previous approach failed.\n` +
      `2. Identify an alternative, simpler, or different architecture/implementation path.\n` +
      `3. Update your plan using 'todo_write' with the revised sequence of steps.\n` +
      `4. Proceed with step 1 of your revised plan.`;

    return {
      action: "REPLAN",
      success: true,
      message: `Replanning triggered for failure class: ${context.failureClass}`,
      instructionForAgent: instruction,
      replannedSteps: [
        "Acknowledge previous failure and identify root cause",
        "Formulate alternative solution without repeating past errors",
        "Update TODO checklist",
        "Execute first verification checkpoint"
      ]
    };
  }
}
