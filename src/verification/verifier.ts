/**
 * Verification Engine
 * Executes deterministic acceptance checks (build, typecheck, tests, forbidden paths)
 * to verify whether the agent's changes actually succeeded before task completion.
 * Specification Reference: Section 2, Section 4, Section 34 (Integration Tests 1 & 2).
 */

import * as path from "path";
import { runCommand, ExecResult } from "../evals/execHelper";
import {
  VerificationCheckResult,
  VerificationConfig,
  VerificationResult
} from "./types";

export interface VerifierOptions {
  workspaceDir?: string;
  config?: VerificationConfig;
  customRunner?: (cmd: string, cwd: string, timeoutMs?: number) => Promise<ExecResult>;
}

export class Verifier {
  private workspaceDir: string;
  private config: VerificationConfig;
  private runner: (cmd: string, cwd: string, timeoutMs?: number) => Promise<ExecResult>;

  constructor(options: VerifierOptions = {}) {
    this.workspaceDir = path.resolve(options.workspaceDir || process.cwd());
    this.config = options.config || {};
    this.runner = options.customRunner || runCommand;
  }

  public setConfig(config: VerificationConfig): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): VerificationConfig {
    return { ...this.config };
  }

  /**
   * Run all configured verification checks against the workspace.
   */
  public async verify(
    changedFiles: string[] = [],
    cycle: number = 1
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const checks: VerificationCheckResult[] = [];
    const timeoutMs = this.config.timeoutMs || 60000;

    // 1. Check Forbidden Paths
    const forbiddenViolations = this.checkForbiddenPaths(changedFiles);
    if (forbiddenViolations.length > 0) {
      checks.push({
        name: "forbidden_paths",
        status: "failed",
        error: `Forbidden files were modified: ${forbiddenViolations.join(", ")}`,
        durationMs: 0
      });
    } else if (this.config.forbiddenPaths && this.config.forbiddenPaths.length > 0) {
      checks.push({
        name: "forbidden_paths",
        status: "passed",
        durationMs: 0
      });
    }

    // 2. Build Check
    if (this.config.buildCommand) {
      const buildRes = await this.runCheck("build", this.config.buildCommand, timeoutMs);
      checks.push(buildRes);
    }

    // 3. Typecheck Check
    if (this.config.typecheckCommand) {
      const tcRes = await this.runCheck("typecheck", this.config.typecheckCommand, timeoutMs);
      checks.push(tcRes);
    }

    // 4. Test Suite Check
    if (this.config.testCommand) {
      const testRes = await this.runCheck("tests", this.config.testCommand, timeoutMs);
      checks.push(testRes);
    }

    // 5. Lint Check
    if (this.config.lintCommand) {
      const lintRes = await this.runCheck("lint", this.config.lintCommand, timeoutMs);
      checks.push(lintRes);
    }

    // 6. Custom Commands
    if (this.config.customCommands) {
      for (const cmd of this.config.customCommands) {
        const customRes = await this.runCheck("custom", cmd, timeoutMs);
        checks.push(customRes);
      }
    }

    const durationMs = Date.now() - startTime;
    const passed = checks.length > 0 && checks.every((c) => c.status === "passed");

    let failureSummary: string | undefined;
    if (!passed) {
      const failedChecks = checks.filter((c) => c.status === "failed");
      failureSummary = failedChecks
        .map((c) => {
          const detail = [c.error, c.output].filter(Boolean).join("\n");
          return `[${c.name.toUpperCase()}] ${detail || "Failed"}`;
        })
        .join("\n\n");
    }

    return {
      passed,
      timestamp: new Date().toISOString(),
      cycle,
      durationMs,
      checks,
      failureSummary
    };
  }

  private async runCheck(
    name: VerificationCheckResult["name"],
    command: string,
    timeoutMs: number
  ): Promise<VerificationCheckResult> {
    const res = await this.runner(command, this.workspaceDir, timeoutMs);
    const combinedOutput = `${res.stdout}\n${res.stderr}`.trim();
    const passed = res.exitCode === 0;

    return {
      name,
      command,
      status: passed ? "passed" : "failed",
      exitCode: res.exitCode,
      output: combinedOutput.slice(0, 4000),
      error: passed ? undefined : `Command '${command}' exited with code ${res.exitCode}`,
      durationMs: res.durationMs
    };
  }

  private checkForbiddenPaths(changedFiles: string[]): string[] {
    if (!this.config.forbiddenPaths || this.config.forbiddenPaths.length === 0) {
      return [];
    }

    const violations: string[] = [];
    for (const changed of changedFiles) {
      const normalized = changed.replace(/\\/g, "/");
      for (const forbidden of this.config.forbiddenPaths) {
        const normForbidden = forbidden.replace(/\\/g, "/");
        if (
          normalized === normForbidden ||
          normalized.startsWith(normForbidden + "/") ||
          (normForbidden.startsWith("*.") && normalized.endsWith(normForbidden.slice(1)))
        ) {
          violations.push(changed);
        }
      }
    }

    return violations;
  }

  /**
   * Formats a clear diagnostic message to steer the agent when verification fails.
   */
  public static formatFeedbackForAgent(result: VerificationResult): string {
    let msg = `### ❌ Harness Verification Failed (Cycle ${result.cycle})\n`;
    msg += `The agent proposed completion, but harness objective verification detected failures.\n`;
    msg += `The task is **NOT** complete. You must fix these issues before finishing.\n\n`;

    for (const check of result.checks) {
      const icon = check.status === "passed" ? "✓" : "✗";
      msg += `#### ${icon} Check: ${check.name.toUpperCase()}`;
      if (check.command) {
        msg += ` (\`${check.command}\`)`;
      }
      msg += `\n`;

      if (check.status === "failed") {
        if (check.error) {
          msg += `**Error:** ${check.error}\n`;
        }
        if (check.output) {
          msg += `\`\`\`text\n${check.output.slice(0, 1500)}\n\`\`\`\n`;
        }
      }
    }

    msg += `\n**Next Steps:**\n`;
    msg += `1. Inspect the error messages and failing assertions above.\n`;
    msg += `2. Use 'read_file' to examine the offending lines.\n`;
    msg += `3. Modify the code to address the errors.\n`;
    msg += `4. Run verification commands to ensure the fix passes before completing.`;

    return msg;
  }
}
