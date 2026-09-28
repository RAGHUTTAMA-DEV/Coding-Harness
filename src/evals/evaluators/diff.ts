import * as fs from "fs";
import * as path from "path";
import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";
import { runCommand } from "../execHelper";

export class DiffEvaluator implements Evaluator {
  name = "diff";
  description = "Analyzes diff metrics, lines added/removed, and sensitive file modifications.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { workspaceDir, filesChanged, runCommand: customRun } = context;

    let linesAdded = 0;
    let linesRemoved = 0;
    const sensitiveFilesModified: string[] = [];

    const sensitivePatterns = [
      /\.env($|\..+)/i,
      /\.pem$/i,
      /\.key$/i,
      /id_rsa/i,
      /credentials\.json/i,
      /\.npmrc$/i,
      /\.git\//i
    ];

    for (const file of filesChanged) {
      const norm = file.replace(/\\/g, "/");
      if (sensitivePatterns.some((pattern) => pattern.test(norm))) {
        sensitiveFilesModified.push(file);
      }
    }

    const execFn = customRun
      ? async (c: string, d: string) => {
          const res = await customRun(c, d);
          return { ...res, durationMs: 0 };
        }
      : runCommand;

    // Check if git is available in the workspace
    const gitDir = path.resolve(workspaceDir, ".git");
    let diffSummary = "";

    if (fs.existsSync(gitDir)) {
      const diffRes = await execFn("git diff --stat HEAD", workspaceDir);
      if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
        diffSummary = diffRes.stdout.trim();
        // Parse summary line like " 3 files changed, 25 insertions(+), 4 deletions(-)"
        const insertMatch = diffSummary.match(/(\d+)\s+insertion/);
        const deleteMatch = diffSummary.match(/(\d+)\s+deletion/);
        if (insertMatch) linesAdded = parseInt(insertMatch[1], 10);
        if (deleteMatch) linesRemoved = parseInt(deleteMatch[1], 10);
      }
    }

    const passed = sensitiveFilesModified.length === 0;

    return {
      status: passed ? "passed" : "failed",
      score: passed ? 1.0 : 0.0,
      details: {
        filesChangedCount: filesChanged.length,
        filesChanged,
        linesAdded,
        linesRemoved,
        sensitiveFilesModified,
        diffSummary
      }
    };
  }
}
