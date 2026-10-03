/**
 * Failure Classifier
 * Classifies runtime errors, command exit statuses, test outputs, and tool responses
 * into canonical failure classes according to Specification Section 29.
 */

import { FailureClass } from "./types";

export interface ClassifyInput {
  error?: string | Error;
  output?: string;
  toolName?: string;
  toolArgs?: any;
  exitCode?: number;
  policyDecision?: string;
  stall?: boolean;
  loopDetected?: boolean;
  budgetExceeded?: boolean;
  timeout?: boolean;
}

export class FailureClassifier {
  /**
   * Classify an incident into a canonical FailureClass
   */
  public static classify(input: ClassifyInput): FailureClass {
    const errorMsg = typeof input.error === "string" ? input.error : input.error?.message || "";
    const output = input.output || "";
    const combined = `${errorMsg}\n${output}`.trim();
    const command = input.toolArgs?.command || "";

    // 1. Budget limits
    if (
      input.budgetExceeded ||
      /budget\s+exceeded|max\s+(?:iterations|tokens|tool\s*calls|duration)\s+cap/i.test(combined)
    ) {
      return "BUDGET_EXCEEDED";
    }

    // 2. Policy / Guardrail blocks
    if (
      input.policyDecision === "DENY" ||
      /policy\s+block|guardrail\s+block|permission\s+denied|forbidden\s+path|risk\s+threshold\s+exceeded/i.test(
        combined
      )
    ) {
      return "POLICY_BLOCK";
    }

    // 3. Loop / repeated failures
    if (input.loopDetected || /repeated\s+failure\s+detected|infinite\s+loop/i.test(combined)) {
      return "REPEATED_FAILURE";
    }

    // 4. Timeout
    if (
      input.timeout ||
      /timeout|timed\s+out|deadline\s+exceeded|ETIMEDOUT/i.test(combined)
    ) {
      return "TIMEOUT";
    }

    // 5. Stall detection
    if (input.stall || /stall\s+detected|no\s+progress\s+detected/i.test(combined)) {
      return "STALL";
    }

    // 6. Model failure
    if (
      /rate\s*limit|quota\s*exceeded|429\s+Too\s+Many\s+Requests|overloaded|context\s+(?:length|window)\s+exceeded|failed\s+to\s+parse\s+tool\s+arguments.*?as\s+valid\s+json/i.test(
        combined
      )
    ) {
      return "MODEL_FAILURE";
    }

    // 7. Build failures (Checked before tests to avoid 'Build failed' being confused with test fail)
    const isBuildContext =
      /(?:npm|bun|yarn|pnpm)\s+run\s+build|build\b|vite\s+build|webpack|rollup|cargo\s+build/i.test(command);
    const hasBuildErrorSignals =
      /Build\s+failed|Compilation\s+failed|SyntaxError|Cannot\s+find\s+module|Failed\s+to\s+compile/i.test(
        combined
      );

    if (isBuildContext || (hasBuildErrorSignals && !/(?:npm|bun|yarn|pnpm)\s+test/i.test(command))) {
      if ((input.exitCode !== undefined && input.exitCode !== 0) || hasBuildErrorSignals) {
        return "BUILD_FAILURE";
      }
    }

    // 8. Typecheck failures
    const isTypecheckContext =
      /tsc\b|typecheck|npm\s+run\s+typecheck/i.test(command);
    const hasTsErrorCodes = /\bTS\d{4,5}\b|error\s+TS\d+|Type\s+.*?\s+is\s+not\s+assignable\s+to\s+type/i.test(
      combined
    );

    if (isTypecheckContext || hasTsErrorCodes) {
      if ((input.exitCode !== undefined && input.exitCode !== 0) || hasTsErrorCodes) {
        return "TYPECHECK_FAILURE";
      }
    }

    // 9. Automated Test failures
    const isTestContext =
      /(?:npm|bun|yarn|pnpm)\s+(?:test|run\s+test)|jest|vitest|pytest|mocha|\btest\.ts|\btest\.js/i.test(
        command
      );
    const hasTestFailSignals =
      /\b(?:FAIL|FAILED)\b|\b(?:tests?|specs?)\s+failed\b|AssertionError|expect\(.*?\)\.to|Assertion failed/i.test(
        combined
      );

    if (isTestContext || hasTestFailSignals) {
      if (input.exitCode !== undefined && input.exitCode !== 0) {
        return "TEST_FAILURE";
      }
      if (hasTestFailSignals) {
        return "TEST_FAILURE";
      }
    }

    // 10. General tool failure
    return "TOOL_FAILURE";
  }

  /**
   * Helper to format a clear human-readable explanation of why this failure was classified as such
   */
  public static explain(failureClass: FailureClass, input: ClassifyInput): string {
    switch (failureClass) {
      case "POLICY_BLOCK":
        return `Operation was blocked by harness security guardrails: ${input.error || "Policy violation"}`;
      case "TEST_FAILURE":
        return `Automated test suite failed execution (exit code ${input.exitCode ?? 1})`;
      case "TYPECHECK_FAILURE":
        return "TypeScript/typecheck compilation detected static type errors";
      case "BUILD_FAILURE":
        return `Build or compilation step failed (exit code ${input.exitCode ?? 1})`;
      case "REPEATED_FAILURE":
        return "Repeated failure cycle detected: the same operation has failed consecutively";
      case "TIMEOUT":
        return "Execution exceeded configured time limits";
      case "STALL":
        return "Process stall detected without progress";
      case "BUDGET_EXCEEDED":
        return "Task resource budget has been exhausted";
      case "MODEL_FAILURE":
        return `Model provider API or generation error: ${input.error || "Generation error"}`;
      case "TOOL_FAILURE":
      default:
        return `Tool execution failed: ${input.error || "Execution error"}`;
    }
  }
}
