import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class TestEvaluator implements Evaluator {
  name = "tests";
  description = "Executes the test suite and parses test counts, duration, and exit codes.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, runCommand: customRun } = context;
    const testCmd = task.verification?.testCommand;

    if (!testCmd) {
      return {
        status: "skipped",
        score: 1.0,
        details: { reason: "No testCommand specified for task" }
      };
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    const res = await execFn(testCmd, workspaceDir);
    const combinedOutput = `${res.stdout}\n${res.stderr}`;

    // Parse common test outputs: bun test, jest, vitest, mocha, pytest
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let total = 0;

    // Bun test format: "34 pass\n0 fail\nRan 34 tests"
    const bunPassMatch = combinedOutput.match(/(\d+)\s+pass(?:ed)?/i);
    const bunFailMatch = combinedOutput.match(/(\d+)\s+fail(?:ed)?/i);
    const bunSkipMatch = combinedOutput.match(/(\d+)\s+skip(?:ped)?/i);

    if (bunPassMatch || bunFailMatch) {
      if (bunPassMatch) passed = parseInt(bunPassMatch[1], 10);
      if (bunFailMatch) failed = parseInt(bunFailMatch[1], 10);
      if (bunSkipMatch) skipped = parseInt(bunSkipMatch[1], 10);
      total = passed + failed + skipped;
    } else {
      // Jest / Vitest format: "Tests: 2 failed, 10 passed, 12 total"
      const jestPass = combinedOutput.match(/(\d+)\s+passed/i);
      const jestFail = combinedOutput.match(/(\d+)\s+failed/i);
      const jestTotal = combinedOutput.match(/(\d+)\s+total/i);

      if (jestPass) passed = parseInt(jestPass[1], 10);
      if (jestFail) failed = parseInt(jestFail[1], 10);
      if (jestTotal) total = parseInt(jestTotal[1], 10);
      else total = passed + failed + skipped;
    }

    const isExitSuccess = res.exitCode === 0;
    let score = 0;

    if (total > 0) {
      score = passed / total;
    } else {
      score = isExitSuccess ? 1.0 : 0.0;
    }

    const status = isExitSuccess && failed === 0 ? "passed" : "failed";

    return {
      status,
      score,
      passed,
      failed,
      skipped,
      total,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      output: combinedOutput.trim(),
      details: {
        command: testCmd
      }
    };
  }
}
