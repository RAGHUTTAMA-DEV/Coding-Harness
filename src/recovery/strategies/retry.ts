/**
 * Retry Recovery Strategy
 * Evaluates whether an immediate retry with modified parameters or backoff is safe.
 * Ensures the agent NEVER retries indefinitely (Specification Section 29).
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class RetryStrategy implements RecoveryStrategy {
  public readonly action = "RETRY";

  async execute(
    context: FailureContext,
    engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    const signature = `${context.toolName || "action"}:${context.description}`;
    const consecutive = engine.getConsecutiveFailures(signature);

    if (consecutive >= engine.limits.maxConsecutiveRetries) {
      return {
        action: "RETRY",
        success: false,
        message: `Maximum consecutive retries (${engine.limits.maxConsecutiveRetries}) reached for this operation.`,
        instructionForAgent: `Do NOT retry the same operation again. The failure persisted after ${consecutive} attempts. Shift to inspection or replanning.`
      };
    }

    let instruction = `[Recovery Notice: Retry Attempt ${consecutive + 1}/${engine.limits.maxConsecutiveRetries}]\n`;

    switch (context.failureClass) {
      case "MODEL_FAILURE":
        instruction += `The model or provider request encountered a transient issue (${context.error || "error"}). Retrying with fresh generation.`;
        break;
      case "TIMEOUT":
        instruction += `The operation timed out. If running a command, verify background status or optimize execution.`;
        break;
      case "TOOL_FAILURE":
        instruction += `The tool '${context.toolName}' failed: ${context.error || context.output || "Error"}. Carefully check the parameters and file paths before executing again.`;
        break;
      default:
        instruction += `Operation failed: ${context.description}. Review the error output and adjust your parameters.`;
        break;
    }

    return {
      action: "RETRY",
      success: true,
      message: `Safe retry authorized (attempt ${consecutive + 1}/${engine.limits.maxConsecutiveRetries}).`,
      instructionForAgent: instruction
    };
  }
}
