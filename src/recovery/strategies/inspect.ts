/**
 * Inspect Recovery Strategy
 * Instructs the agent to pause destructive operations and execute diagnostic tools
 * (read_file, glob, grep, git status) to inspect root causes before taking action.
 */

import {
  FailureContext,
  RecoveryEngineContext,
  RecoveryStrategy,
  RecoveryStrategyResult
} from "../types";

export class InspectStrategy implements RecoveryStrategy {
  public readonly action = "INSPECT";

  async execute(
    context: FailureContext,
    _engine: RecoveryEngineContext
  ): Promise<RecoveryStrategyResult> {
    let instruction = `[Recovery Action: Mandatory Diagnostic Inspection]\n`;

    switch (context.failureClass) {
      case "TEST_FAILURE":
        instruction += `Automated test execution failed. Do NOT guess or immediately re-edit blindly.\n` +
          `1. Read the failing test file to understand the exact test assertion.\n` +
          `2. Inspect the implementation file using 'read_file' to examine current state.\n` +
          `3. Diagnose the discrepancy between expected test assertion and actual return value.`;
        break;

      case "TYPECHECK_FAILURE":
        instruction += `Static type checking failed with compilation errors.\n` +
          `1. Inspect the relevant interface or type definitions.\n` +
          `2. Use 'read_file' on the offending file and line number to verify parameter types and imports.`;
        break;

      case "BUILD_FAILURE":
        instruction += `Build step failed.\n` +
          `1. Inspect package.json and configuration files.\n` +
          `2. Check syntax or missing export/import declarations.`;
        break;

      case "POLICY_BLOCK":
        instruction += `Your requested tool call was BLOCKED by harness security policy.\n` +
          `Reason: ${context.description}\n` +
          `Do NOT attempt to bypass or repeat the forbidden command. Inspect workspace alternatives within permitted paths.`;
        break;

      case "TOOL_FAILURE":
      default:
        instruction += `Tool execution encountered an unexpected error.\n` +
          `1. Use 'read_file' to re-verify the exact state of target files before modifying them.\n` +
          `2. Verify that all referenced paths exist using 'glob'.`;
        break;
    }

    return {
      action: "INSPECT",
      success: true,
      message: `Diagnostic inspection phase initiated for ${context.failureClass}`,
      instructionForAgent: instruction
    };
  }
}
