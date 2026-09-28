import * as fs from "fs";
import * as path from "path";
import { Evaluator, EvaluatorContext, EvaluatorResult } from "../types";

export class FilesEvaluator implements Evaluator {
  name = "files";
  description = "Verifies required files exist and forbidden files were not modified.";

  async evaluate(context: EvaluatorContext): Promise<EvaluatorResult> {
    const { task, workspaceDir, filesChanged } = context;
    const violations: string[] = [];
    const missingRequired: string[] = [];

    // Normalize paths
    const normalizedChanged = filesChanged.map((f) => f.replace(/\\/g, "/").toLowerCase());

    // 1. Check forbidden paths
    const forbidden = task.constraints?.forbiddenPaths || [];
    for (const forbiddenPath of forbidden) {
      const normForbidden = forbiddenPath.replace(/\\/g, "/").toLowerCase();
      for (const changed of normalizedChanged) {
        if (
          changed === normForbidden ||
          changed.startsWith(normForbidden + "/") ||
          changed.endsWith("/" + normForbidden)
        ) {
          violations.push(`Forbidden path modified: "${forbiddenPath}" (matched "${changed}")`);
        }
      }
    }

    // 2. Check required paths
    const required = task.constraints?.requiredPaths || [];
    for (const reqPath of required) {
      const fullPath = path.resolve(workspaceDir, reqPath);
      if (!fs.existsSync(fullPath)) {
        missingRequired.push(`Required file missing: "${reqPath}"`);
      }
    }

    const totalChecks = forbidden.length + required.length;
    if (totalChecks === 0) {
      return {
        status: "passed",
        score: 1.0,
        details: { message: "No file constraints configured." }
      };
    }

    const failuresCount = violations.length + missingRequired.length;
    const passed = failuresCount === 0;
    const score = Math.max(0, (totalChecks - failuresCount) / totalChecks);

    return {
      status: passed ? "passed" : "failed",
      score,
      details: {
        violations,
        missingRequired,
        forbiddenChecked: forbidden,
        requiredChecked: required
      }
    };
  }
}
