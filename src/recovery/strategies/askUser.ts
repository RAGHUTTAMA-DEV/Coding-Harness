/**
 * Ask User Recovery Strategy
 * Solicits human-in-the-loop intervention or steering when automated recovery options are exhausted.
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class AskUserStrategy implements RecoveryStrategy {
  public readonly action = "ASK_USER";

  async execute(
    context: FailureContext,
    engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    if (engine.headless || !engine.rl) {
      return {
        action: "ASK_USER",
        success: false,
        message: "Interactive user prompt unavailable in headless mode.",
        instructionForAgent: "Headless environment: cannot prompt user. Proceeding with best-effort autonomous recovery or abort."
      };
    }

    const promptMessage = `\n\x1b[1m\x1b[33m🛸 Harness Recovery: Automated recovery exhausted.\x1b[0m\n` +
      `Issue: ${context.description} (${context.failureClass})\n` +
      `How would you like the agent to proceed? (Provide steering instruction or press Enter to abort):\n> `;

    return new Promise((resolve) => {
      engine.rl.question(promptMessage, (answer: string) => {
        const trimmed = answer.trim();
        if (!trimmed) {
          resolve({
            action: "ASK_USER",
            success: false,
            message: "User declined to provide guidance. Aborting.",
            abortReason: "User cancelled after automated recovery exhaustion."
          });
        } else {
          resolve({
            action: "ASK_USER",
            success: true,
            message: "User provided steering instructions.",
            instructionForAgent: `[User Recovery Instruction]: ${trimmed}`
          });
        }
      });
    });
  }
}
