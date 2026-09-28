import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class RequirementsEvaluator implements Evaluator {
  name = "requirements";
  description = "Verifies explicit visible requirements and task verification commands.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, runCommand: customRun } = context;
    const requirements = task.requirements || [];
    const commands = task.verification?.commands || [];

    if (requirements.length === 0 && commands.length === 0) {
      return {
        status: "passed",
        score: 1.0,
        details: { message: "No explicit requirements or verification commands specified." }
      };
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    const commandResults: { command: string; exitCode: number; passed: boolean }[] = [];

    for (const cmd of commands) {
      const res = await execFn(cmd, workspaceDir);
      commandResults.push({
        command: cmd,
        exitCode: res.exitCode,
        passed: res.exitCode === 0
      });
    }

    const failedCommands = commandResults.filter((r) => !r.passed);
    const passed = failedCommands.length === 0;

    let score = 1.0;
    if (commandResults.length > 0) {
      score = (commandResults.length - failedCommands.length) / commandResults.length;
    }

    return {
      status: passed ? "passed" : "failed",
      score,
      details: {
        requirements,
        commandResults
      }
    };
  }
}
