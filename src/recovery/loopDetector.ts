/**
 * Loop Detector
 * Detects repeated behavior, cyclical tool patterns, and repeated identical failures.
 * Specification Reference: Section 30 and Section 34 (Integration Test 7).
 */

import { LoopDetectionResult, LoopDetectorEntry } from "./types";

export interface LoopDetectorOptions {
  /** Maximum number of history entries to maintain in memory (default: 25) */
  maxHistory?: number;
  /** Number of identical consecutive tool failures that trigger loop detection (default: 3) */
  identicalFailureThreshold?: number;
  /** Number of cycles that trigger cyclic loop detection (default: 2) */
  cycleThreshold?: number;
}

export class LoopDetector {
  private history: LoopDetectorEntry[] = [];
  private maxHistory: number;
  private identicalFailureThreshold: number;
  private cycleThreshold: number;
  private consecutiveFailureMap: Map<string, number> = new Map();

  constructor(options: LoopDetectorOptions = {}) {
    this.maxHistory = options.maxHistory || 25;
    this.identicalFailureThreshold = options.identicalFailureThreshold || 3;
    this.cycleThreshold = options.cycleThreshold || 2;
  }

  /**
   * Normalize tool arguments to extract a stable target identifier.
   */
  public static normalizeArgs(toolName: string, args: any): string {
    if (!args || typeof args !== "object") {
      return String(args || "");
    }
    if (args.command) {
      return args.command.trim().replace(/\s+/g, " ");
    }
    if (args.path) {
      return args.path.trim().replace(/\\/g, "/");
    }
    if (args.pattern) {
      return args.pattern.trim();
    }
    if (args.url) {
      return args.url.trim();
    }
    // Fallback: simplified sorted keys
    try {
      const keys = Object.keys(args).sort();
      return keys.map((k) => `${k}:${String(args[k]).slice(0, 40)}`).join(";");
    } catch {
      return "";
    }
  }

  /**
   * Simplify error message to capture core essence while ignoring variable timestamps or memory addresses.
   */
  public static normalizeError(error?: string): string {
    if (!error) return "";
    return error
      .replace(/0x[a-fA-F0-9]+/g, "0xADDR")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/g, "TIMESTAMP")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim();
  }

  /**
   * Record a tool execution event and immediately check if it triggered a loop.
   */
  public recordAction(
    toolName: string,
    args: any,
    outcome: "success" | "failure",
    errorOrOutput?: string
  ): LoopDetectionResult {
    const argsSig = LoopDetector.normalizeArgs(toolName, args);
    const errSig = LoopDetector.normalizeError(errorOrOutput);
    const entry: LoopDetectorEntry = {
      toolName,
      argsSignature: argsSig,
      outcome,
      errorSignature: errSig,
      timestamp: Date.now()
    };

    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    const actionSig = `${toolName}:${argsSig}`;
    if (outcome === "failure") {
      const current = (this.consecutiveFailureMap.get(actionSig) || 0) + 1;
      this.consecutiveFailureMap.set(actionSig, current);
    } else {
      this.consecutiveFailureMap.set(actionSig, 0);
    }

    return this.checkLoop();
  }

  /**
   * Inspect current history to detect identical consecutive failures or repeated cycles.
   */
  public checkLoop(): LoopDetectionResult {
    if (this.history.length === 0) {
      return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
    }

    // 1. Check for repeated failing test commands
    const testResult = this.checkRepeatedTestFailures();
    if (testResult.loopDetected) {
      return testResult;
    }

    // 2. Check for identical consecutive tool failure
    const identicalResult = this.checkIdenticalFailures();
    if (identicalResult.loopDetected) {
      return identicalResult;
    }

    // 3. Check for cyclic patterns (e.g., read -> edit -> test -> read -> edit -> test)
    const cyclicResult = this.checkCyclicPattern();
    if (cyclicResult.loopDetected) {
      return cyclicResult;
    }

    return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
  }

  /**
   * Detect if the last N actions were identical failing calls to the same tool with same args.
   */
  private checkIdenticalFailures(): LoopDetectionResult {
    if (this.history.length < this.identicalFailureThreshold) {
      return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
    }

    const lastEntry = this.history[this.history.length - 1];
    if (lastEntry.outcome !== "failure") {
      return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
    }

    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i];
      if (
        entry.outcome === "failure" &&
        entry.toolName === lastEntry.toolName &&
        entry.argsSignature === lastEntry.argsSignature
      ) {
        count++;
      } else {
        break;
      }
    }

    if (count >= this.identicalFailureThreshold) {
      const pattern = `${lastEntry.toolName}("${lastEntry.argsSignature}")`;
      const isTest =
        lastEntry.toolName === "run_command" &&
        /(?:npm|bun|yarn|pnpm)\s+test|jest|vitest|pytest|mocha\b/i.test(lastEntry.argsSignature);

      return {
        loopDetected: true,
        count,
        pattern,
        loopType: isTest ? "repeated_test_failure" : "identical_tool_failure",
        suggestion: `Repeated tool failure detected: '${pattern}' failed ${count} times consecutively. Do not retry identical arguments. Inspect diagnostics or replan.`
      };
    }

    return { loopDetected: false, count, pattern: "", loopType: "none" };
  }

  /**
   * Detect if a test command has failed repeatedly without progress.
   */
  private checkRepeatedTestFailures(): LoopDetectionResult {
    const testFailures = this.history.filter(
      (h) =>
        h.outcome === "failure" &&
        h.toolName === "run_command" &&
        /(?:npm|bun|yarn|pnpm)\s+test|jest|vitest|pytest|mocha\b/i.test(h.argsSignature)
    );

    if (testFailures.length >= this.identicalFailureThreshold) {
      const last = this.history[this.history.length - 1];
      if (
        last.outcome === "failure" &&
        last.toolName === "run_command" &&
        /(?:npm|bun|yarn|pnpm)\s+test|jest|vitest|pytest|mocha\b/i.test(last.argsSignature)
      ) {
        return {
          loopDetected: true,
          count: testFailures.length,
          pattern: last.argsSignature,
          loopType: "repeated_test_failure",
          suggestion: `Verification test '${last.argsSignature}' has failed ${testFailures.length} times. Triggering replan/rollback.`
        };
      }
    }

    return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
  }

  /**
   * Detect repeating multi-step cycles, e.g. [A, B, C, A, B, C]
   */
  private checkCyclicPattern(): LoopDetectionResult {
    const actions = this.history.map((h) => `${h.toolName}:${h.argsSignature}:${h.outcome}`);
    const n = actions.length;

    for (let cycleLen = 2; cycleLen <= 5; cycleLen++) {
      const requiredHistory = cycleLen * this.cycleThreshold;
      if (n < requiredHistory) continue;

      const baseCycle = actions.slice(n - cycleLen);
      let isRepeating = true;

      for (let c = 1; c < this.cycleThreshold; c++) {
        const start = n - (c + 1) * cycleLen;
        const compareCycle = actions.slice(start, start + cycleLen);
        for (let i = 0; i < cycleLen; i++) {
          if (baseCycle[i] !== compareCycle[i]) {
            isRepeating = false;
            break;
          }
        }
        if (!isRepeating) break;
      }

      if (isRepeating) {
        const hasFailure = this.history
          .slice(n - requiredHistory)
          .some((h) => h.outcome === "failure");

        if (hasFailure) {
          const patternNames = this.history
            .slice(n - cycleLen)
            .map((h) => h.toolName)
            .join(" -> ");
          return {
            loopDetected: true,
            count: this.cycleThreshold,
            pattern: patternNames,
            loopType: "cyclic_edits",
            suggestion: `Cyclic loop detected repeating pattern (${patternNames}) ${this.cycleThreshold} times with failures. Rollback to safe state and replan.`
          };
        }
      }
    }

    return { loopDetected: false, count: 0, pattern: "", loopType: "none" };
  }

  /**
   * Get consecutive failure count for an action signature
   */
  public getConsecutiveFailures(signature: string): number {
    return this.consecutiveFailureMap.get(signature) || 0;
  }

  /**
   * Reset all history and counters
   */
  public reset(): void {
    this.history = [];
    this.consecutiveFailureMap.clear();
  }
}
