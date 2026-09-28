import * as fs from "fs";
import * as path from "path";
import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class LintEvaluator implements Evaluator {
  name = "lint";
  description = "Verifies code quality and lint checks without rule violations.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, runCommand: customRun } = context;
    let lintCmd = task.verification?.lintCommand;

    if (!lintCmd) {
      const pkgPath = path.resolve(workspaceDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg.scripts && pkg.scripts.lint) {
            lintCmd = "bun run lint";
          }
        } catch {
          // ignore parsing error
        }
      }
    }

    if (!lintCmd) {
      return {
        status: "skipped",
        score: 1.0,
        details: { reason: "No lintCommand specified and no package.json lint script found" }
      };
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    const res = await execFn(lintCmd, workspaceDir);
    const combinedOutput = `${res.stdout}\n${res.stderr}`.trim();
    const passed = res.exitCode === 0;

    return {
      status: passed ? "passed" : "failed",
      score: passed ? 1.0 : 0.0,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      output: combinedOutput,
      details: {
        command: lintCmd
      }
    };
  }
}
