import * as fs from "fs";
import * as path from "path";
import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class BuildEvaluator implements Evaluator {
  name = "build";
  description = "Verifies that the project builds or bundles cleanly.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, runCommand: customRun } = context;
    let buildCmd = task.verification?.buildCommand;

    if (!buildCmd) {
      // Check if package.json has a build script
      const pkgPath = path.resolve(workspaceDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg.scripts && pkg.scripts.build) {
            buildCmd = "bun run build";
          }
        } catch {
          // ignore parsing error
        }
      }
    }

    if (!buildCmd) {
      return {
        status: "skipped",
        score: 1.0,
        details: { reason: "No buildCommand configured and no package.json build script found" }
      };
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    const res = await execFn(buildCmd, workspaceDir);
    const combinedOutput = `${res.stdout}\n${res.stderr}`.trim();
    const passed = res.exitCode === 0;

    return {
      status: passed ? "passed" : "failed",
      score: passed ? 1.0 : 0.0,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      output: combinedOutput,
      details: {
        command: buildCmd
      }
    };
  }
}
