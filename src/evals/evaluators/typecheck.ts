import * as fs from "fs";
import * as path from "path";
import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class TypecheckEvaluator implements Evaluator {
  name = "typecheck";
  description = "Verifies TypeScript compilation and type sanity without emitting code.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, runCommand: customRun } = context;
    let typecheckCmd = task.verification?.typecheckCommand;

    // If not specified, inspect if tsconfig.json exists
    if (!typecheckCmd) {
      const tsconfigPath = path.resolve(workspaceDir, "tsconfig.json");
      if (fs.existsSync(tsconfigPath)) {
        typecheckCmd = "bun x tsc --noEmit";
      } else {
        return {
          status: "skipped",
          score: 1.0,
          details: { reason: "No tsconfig.json found and no typecheckCommand specified" }
        };
      }
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    const res = await execFn(typecheckCmd, workspaceDir);
    const combinedOutput = `${res.stdout}\n${res.stderr}`.trim();
    const passed = res.exitCode === 0;

    return {
      status: passed ? "passed" : "failed",
      score: passed ? 1.0 : 0.0,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      output: combinedOutput,
      details: {
        command: typecheckCmd
      }
    };
  }
}
