import { EvalResult } from "../types";

export class ReportGenerator {
  /**
   * Generates a single task evaluation report adhering to the spec format
   */
  static generateReport(result: EvalResult, colorize: boolean = true): string {
    const isPassed = result.status === "passed";
    const statusSymbol = isPassed ? "✓ PASSED" : "✗ FAILED";
    const bannerColor = colorize
      ? isPassed
        ? "\x1b[32m\x1b[1m"
        : "\x1b[31m\x1b[1m"
      : "";
    const resetColor = colorize ? "\x1b[0m" : "";
    const boldColor = colorize ? "\x1b[1m" : "";

    const lines: string[] = [];

    lines.push("══════════════════════════════════════");
    lines.push("       CODING-HARNESS EVALUATION      ");
    lines.push("══════════════════════════════════════");
    lines.push("");
    lines.push("Task:");
    lines.push(result.taskDescription || result.taskId);
    lines.push("");
    lines.push("Status:");
    lines.push(`${bannerColor}${statusSymbol}${resetColor}`);
    lines.push("");
    lines.push("Verification:");
    lines.push("");

    // Evaluator lines
    for (const [name, ev] of Object.entries(result.evaluators)) {
      const capName = name.charAt(0).toUpperCase() + name.slice(1);
      let metricStr = "";

      if (ev.status === "skipped") {
        metricStr = "SKIPPED -";
      } else if (name === "tests" && ev.total !== undefined && ev.total > 0) {
        metricStr = `${ev.passed || 0}/${ev.total} ${ev.status === "passed" ? "✓" : "✗"}`;
      } else if (name === "requirements" && ev.score !== undefined) {
        metricStr = `${Math.round(ev.score * 100)}% ${ev.status === "passed" ? "✓" : "✗"}`;
      } else {
        const passText = ev.status === "passed" ? "PASS ✓" : "FAIL ✗";
        metricStr = passText;
      }

      const paddedName = capName.padEnd(18, " ");
      lines.push(`${paddedName}${metricStr}`);
    }

    lines.push("");
    lines.push("Execution:");
    lines.push("");

    const m = result.metrics;
    lines.push(`Iterations        ${m.iterations}`);
    lines.push(`Tool Calls        ${m.toolCalls}`);
    if (m.mcpCalls !== undefined) lines.push(`MCP Calls         ${m.mcpCalls}`);
    if (m.recoveryAttempts !== undefined) lines.push(`Recoveries        ${m.recoveryAttempts}`);
    if (m.rollbackCount !== undefined) lines.push(`Rollbacks         ${m.rollbackCount}`);
    if (m.guardrailBlocks !== undefined) lines.push(`Guardrail Blocks  ${m.guardrailBlocks}`);

    lines.push("");
    lines.push(`Tokens            ${m.tokens.toLocaleString()}`);
    lines.push(`Duration          ${this.formatDuration(m.durationMs)}`);
    lines.push("");
    lines.push(`Files Changed     ${m.filesChanged}`);
    lines.push("");

    const footerText = isPassed ? "VERIFIED ✓" : "FAILED ✗";
    lines.push("══════════════════════════════════════");
    lines.push(`             ${footerText}            `);
    lines.push("══════════════════════════════════════");

    return lines.join("\n");
  }

  /**
   * Generates a multi-task summary table
   */
  static generateSummary(results: EvalResult[]): string {
    const lines: string[] = [];
    lines.push("─────────────────────────────────────────────────────────────────────────────");
    lines.push(" TASK ID         | STATUS | TESTS    | DURATION | TOKENS   | FILES CHANGED   ");
    lines.push("─────────────────────────────────────────────────────────────────────────────");

    let totalPassed = 0;

    for (const r of results) {
      if (r.status === "passed") totalPassed++;
      const idStr = r.taskId.padEnd(16, " ").slice(0, 16);
      const statusStr = (r.status === "passed" ? "PASS" : "FAIL").padEnd(7, " ");

      const testEv = r.evaluators.tests;
      let testStr = "N/A";
      if (testEv && testEv.total !== undefined && testEv.total > 0) {
        testStr = `${testEv.passed}/${testEv.total}`;
      }
      testStr = testStr.padEnd(9, " ");

      const durStr = this.formatDuration(r.metrics.durationMs).padEnd(9, " ");
      const tokStr = r.metrics.tokens.toLocaleString().padEnd(9, " ");
      const filesStr = r.metrics.filesChanged.toString().padEnd(15, " ");

      lines.push(` ${idStr}| ${statusStr}| ${testStr}| ${durStr}| ${tokStr}| ${filesStr}`);
    }

    lines.push("─────────────────────────────────────────────────────────────────────────────");
    const passRate = results.length > 0 ? Math.round((totalPassed / results.length) * 100) : 0;
    lines.push(`Total Tasks: ${results.length} | Passed: ${totalPassed} (${passRate}%)`);
    lines.push("─────────────────────────────────────────────────────────────────────────────");

    return lines.join("\n");
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }
}
