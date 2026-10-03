import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  FailureClassifier,
  LoopDetector,
  RecoveryEngine,
  RetryStrategy,
  InspectStrategy,
  ReplanStrategy,
  RollbackStrategy,
  AbortStrategy
} from "../recovery";
import { SnapshotManager } from "../snapshots";
import { Agent } from "../agent";
import { ChatModelClient, Message, ToolCall } from "../client";

describe("Recovery Engine & Loop Detection Subsystem (Spec §29, §30, §34)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Failure Classifier Tests
  // ─────────────────────────────────────────────────────────────
  describe("FailureClassifier", () => {
    test("classifies automated test execution failures", () => {
      const res1 = FailureClassifier.classify({
        toolName: "run_command",
        toolArgs: { command: "npm test" },
        exitCode: 1,
        output: "FAIL src/app.test.ts\n✕ adds two numbers (5 ms)"
      });
      expect(res1).toBe("TEST_FAILURE");

      const res2 = FailureClassifier.classify({
        toolName: "run_command",
        toolArgs: { command: "bun test" },
        output: "AssertionError: expected 'bar' to equal 'foo'"
      });
      expect(res2).toBe("TEST_FAILURE");
    });

    test("classifies typecheck failures", () => {
      const res1 = FailureClassifier.classify({
        toolName: "run_command",
        toolArgs: { command: "tsc --noEmit" },
        exitCode: 2,
        output: "src/index.ts:14:5 - error TS2322: Type 'string' is not assignable to type 'number'."
      });
      expect(res1).toBe("TYPECHECK_FAILURE");

      const res2 = FailureClassifier.classify({
        toolName: "run_command",
        toolArgs: { command: "npm run typecheck" },
        exitCode: 1
      });
      expect(res2).toBe("TYPECHECK_FAILURE");
    });

    test("classifies build and compilation failures", () => {
      const res = FailureClassifier.classify({
        toolName: "run_command",
        toolArgs: { command: "npm run build" },
        exitCode: 1,
        output: "Build failed with 1 error: Cannot find module './missing'"
      });
      expect(res).toBe("BUILD_FAILURE");
    });

    test("classifies security guardrail policy blocks", () => {
      const res1 = FailureClassifier.classify({
        policyDecision: "DENY",
        error: "Guardrail blocked access to .env"
      });
      expect(res1).toBe("POLICY_BLOCK");

      const res2 = FailureClassifier.classify({
        output: "Error: Permission denied by user for executing 'run_command'."
      });
      expect(res2).toBe("POLICY_BLOCK");
    });

    test("classifies model and provider failures", () => {
      const res1 = FailureClassifier.classify({
        error: "429 Too Many Requests: Rate limit exceeded"
      });
      expect(res1).toBe("MODEL_FAILURE");

      const res2 = FailureClassifier.classify({
        error: "Failed to parse tool arguments for 'edit_file' as valid JSON."
      });
      expect(res2).toBe("MODEL_FAILURE");
    });

    test("classifies timeout, stall, and budget exhaustion", () => {
      expect(FailureClassifier.classify({ timeout: true })).toBe("TIMEOUT");
      expect(FailureClassifier.classify({ error: "Operation timed out after 30000ms" })).toBe(
        "TIMEOUT"
      );
      expect(FailureClassifier.classify({ stall: true })).toBe("STALL");
      expect(FailureClassifier.classify({ budgetExceeded: true })).toBe("BUDGET_EXCEEDED");
      expect(
        FailureClassifier.classify({ error: "Max iterations cap of 30 reached." })
      ).toBe("BUDGET_EXCEEDED");
    });

    test("classifies loop detection as REPEATED_FAILURE", () => {
      const res = FailureClassifier.classify({
        loopDetected: true,
        toolName: "edit_file",
        output: "Error: Target content not found"
      });
      expect(res).toBe("REPEATED_FAILURE");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Loop Detector Tests (Spec §30)
  // ─────────────────────────────────────────────────────────────
  describe("LoopDetector", () => {
    test("detects identical consecutive tool failures exceeding threshold", () => {
      const detector = new LoopDetector({ identicalFailureThreshold: 3 });

      // First failure
      let check = detector.recordAction(
        "edit_file",
        { path: "src/app.ts", find: "foo" },
        "failure",
        "Error: target content not found"
      );
      expect(check.loopDetected).toBe(false);

      // Second failure
      check = detector.recordAction(
        "edit_file",
        { path: "src/app.ts", find: "foo" },
        "failure",
        "Error: target content not found"
      );
      expect(check.loopDetected).toBe(false);

      // Third failure -> triggers identical tool failure loop
      check = detector.recordAction(
        "edit_file",
        { path: "src/app.ts", find: "foo" },
        "failure",
        "Error: target content not found"
      );
      expect(check.loopDetected).toBe(true);
      expect(check.loopType).toBe("identical_tool_failure");
      expect(check.count).toBe(3);
    });

    test("resets failure counter upon a successful tool call", () => {
      const detector = new LoopDetector({ identicalFailureThreshold: 2 });

      detector.recordAction("edit_file", { path: "a.ts" }, "failure", "Error");
      expect(detector.checkLoop().loopDetected).toBe(false);

      // Intervening success
      detector.recordAction("read_file", { path: "a.ts" }, "success");

      // Failure after success is counted as 1, not 2
      const check = detector.recordAction("edit_file", { path: "a.ts" }, "failure", "Error");
      expect(check.loopDetected).toBe(false);
    });

    test("detects repeated test failures", () => {
      const detector = new LoopDetector({ identicalFailureThreshold: 2 });

      detector.recordAction("run_command", { command: "npm test" }, "failure", "FAIL app.test.ts");
      const check = detector.recordAction(
        "run_command",
        { command: "npm test" },
        "failure",
        "FAIL app.test.ts"
      );

      expect(check.loopDetected).toBe(true);
      expect(check.loopType).toBe("repeated_test_failure");
    });

    test("detects cyclic multi-step patterns (read -> edit -> test -> read -> edit -> test)", () => {
      const detector = new LoopDetector({ cycleThreshold: 2 });

      // Cycle 1
      detector.recordAction("read_file", { path: "main.ts" }, "success");
      detector.recordAction("edit_file", { path: "main.ts" }, "success");
      detector.recordAction("run_command", { command: "npm test" }, "failure", "FAIL");

      // Cycle 2 (repeats the pattern)
      detector.recordAction("read_file", { path: "main.ts" }, "success");
      detector.recordAction("edit_file", { path: "main.ts" }, "success");
      const check = detector.recordAction(
        "run_command",
        { command: "npm test" },
        "failure",
        "FAIL"
      );

      expect(check.loopDetected).toBe(true);
      expect(check.loopType).toBe("cyclic_edits");
      expect(check.pattern).toContain("read_file -> edit_file -> run_command");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Recovery Strategies Tests
  // ─────────────────────────────────────────────────────────────
  describe("Recovery Strategies", () => {
    test("RetryStrategy halts infinite retries when limit is reached", async () => {
      const retry = new RetryStrategy();
      let consecutive = 1;

      const mockEngineContext: any = {
        limits: { maxConsecutiveRetries: 2, maxTotalRecoveries: 10, maxRollbacks: 3 },
        getConsecutiveFailures: () => consecutive
      };

      // Attempt 1: allowed
      const res1 = await retry.execute(
        { failureClass: "TOOL_FAILURE", description: "edit failed" },
        mockEngineContext
      );
      expect(res1.action).toBe("RETRY");
      expect(res1.success).toBe(true);

      // Attempt 2: threshold exceeded
      consecutive = 2;
      const res2 = await retry.execute(
        { failureClass: "TOOL_FAILURE", description: "edit failed" },
        mockEngineContext
      );
      expect(res2.action).toBe("RETRY");
      expect(res2.success).toBe(false);
      expect(res2.instructionForAgent).toContain("Do NOT retry");
    });

    test("InspectStrategy produces tailored diagnostic instructions", async () => {
      const inspect = new InspectStrategy();
      const mockEngineContext: any = { limits: {} };

      const resTest = await inspect.execute(
        { failureClass: "TEST_FAILURE", description: "tests failed" },
        mockEngineContext
      );
      expect(resTest.action).toBe("INSPECT");
      expect(resTest.instructionForAgent).toContain("Read the failing test file");

      const resPolicy = await inspect.execute(
        { failureClass: "POLICY_BLOCK", description: "forbidden path" },
        mockEngineContext
      );
      expect(resPolicy.instructionForAgent).toContain("BLOCKED by harness security policy");
    });

    test("ReplanStrategy formulates structured replanning steps", async () => {
      const replan = new ReplanStrategy();
      const res = await replan.execute(
        {
          failureClass: "REPEATED_FAILURE",
          description: "Stuck in edit loop",
          loopDetected: true,
          loopPattern: "read -> edit"
        },
        {} as any
      );
      expect(res.action).toBe("REPLAN");
      expect(res.success).toBe(true);
      expect(res.replannedSteps).toBeDefined();
      expect(res.instructionForAgent).toContain("Update your plan using 'todo_write'");
    });

    test("RollbackStrategy reverts workspace using SnapshotManager", async () => {
      const snapManager = new SnapshotManager(tempDir);
      fs.writeFileSync(path.join(tempDir, "file.txt"), "Original content");
      const snapshot = await snapManager.createSnapshot({ description: "Initial safe state" });

      // Simulate agent making destructive/broken changes
      fs.writeFileSync(path.join(tempDir, "file.txt"), "Broken code");
      fs.writeFileSync(path.join(tempDir, "untracked.ts"), "bad file");

      const rollback = new RollbackStrategy();
      const mockEngineContext: any = {
        snapshotManager: snapManager,
        limits: { maxRollbacks: 3 },
        getRollbackCount: () => 0
      };

      const res = await rollback.execute(
        {
          failureClass: "TEST_FAILURE",
          description: "Fatal regression",
          lastSnapshotId: snapshot.id
        },
        mockEngineContext
      );

      expect(res.action).toBe("ROLLBACK");
      expect(res.success).toBe(true);
      expect(fs.readFileSync(path.join(tempDir, "file.txt"), "utf-8")).toBe("Original content");
      expect(fs.existsSync(path.join(tempDir, "untracked.ts"))).toBe(false);
    });

    test("AbortStrategy halts cleanly when non-recoverable error occurs", async () => {
      const abort = new AbortStrategy();
      const res = await abort.execute(
        { failureClass: "BUDGET_EXCEEDED", description: "Token limit exceeded" },
        { getTotalRecoveries: () => 4 } as any
      );
      expect(res.action).toBe("ABORT");
      expect(res.success).toBe(true);
      expect(res.abortReason).toContain("Non-recoverable failure");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. RecoveryEngine Orchestration Tests
  // ─────────────────────────────────────────────────────────────
  describe("RecoveryEngine Escalation Ladder", () => {
    test("escalates through RETRY -> INSPECT -> REPLAN -> ROLLBACK", async () => {
      const snapManager = new SnapshotManager(tempDir);
      fs.writeFileSync(path.join(tempDir, "index.ts"), "export const a = 1;");
      await snapManager.createSnapshot({ description: "Baseline snapshot" });

      const engine = new RecoveryEngine({
        workspaceDir: tempDir,
        snapshotManager: snapManager,
        limits: { maxConsecutiveRetries: 1, maxTotalRecoveries: 10, maxRollbacks: 2 }
      });

      // 1. First failure of tool -> RETRY
      const res1 = await engine.handleIncident({
        toolName: "edit_file",
        toolArgs: { path: "index.ts" },
        error: "Target content not found"
      });
      expect(res1.action).toBe("RETRY");

      // 2. Second failure of same tool -> INSPECT
      const res2 = await engine.handleIncident({
        toolName: "edit_file",
        toolArgs: { path: "index.ts" },
        error: "Target content not found"
      });
      expect(res2.action).toBe("INSPECT");

      // 3. Third failure of same tool -> REPLAN
      const res3 = await engine.handleIncident({
        toolName: "edit_file",
        toolArgs: { path: "index.ts" },
        error: "Target content not found"
      });
      expect(res3.action).toBe("REPLAN");

      // 4. Repeated test failure loop -> ROLLBACK to clean snapshot
      engine.recordAction("run_command", { command: "npm test" }, "failure", "FAIL");
      engine.recordAction("run_command", { command: "npm test" }, "failure", "FAIL");
      engine.recordAction("run_command", { command: "npm test" }, "failure", "FAIL");

      const res4 = await engine.handleIncident({
        toolName: "run_command",
        toolArgs: { command: "npm test" },
        output: "FAIL: Tests failed"
      });
      expect(res4.action).toBe("ROLLBACK");
      expect(res4.success).toBe(true);
      expect(engine.getRollbackCount()).toBe(1);
    });

    test("immediately aborts on BUDGET_EXCEEDED", async () => {
      const engine = new RecoveryEngine({ workspaceDir: tempDir });
      const res = await engine.handleIncident({
        budgetExceeded: true,
        error: "Max iterations cap reached"
      });
      expect(res.action).toBe("ABORT");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Agent Integration Tests (Spec §34 Test 7)
  // ─────────────────────────────────────────────────────────────
  describe("Agent Integration with Recovery", () => {
    test("triggers recovery and injects steering instructions when a loop occurs", async () => {
      const snapManager = new SnapshotManager(tempDir);
      fs.writeFileSync(path.join(tempDir, "code.ts"), "let x = 1;");
      await snapManager.createSnapshot({ description: "Clean baseline" });

      const mockClient: ChatModelClient = {
        chat: async () => ({ role: "assistant", content: "Done" }),
        chatStream: async (_msgs, _tools, cb) => {
          cb?.({ content: "Calling edit tool" });
          // Emits identical failing tool calls consecutively
          return {
            role: "assistant",
            content: "I will edit the file",
            tool_calls: [
              {
                id: "call-1",
                function: {
                  name: "edit_file",
                  arguments: JSON.stringify({
                    path: path.join(tempDir, "code.ts"),
                    search: "non_existent_string",
                    replace: "new_string"
                  })
                }
              }
            ]
          };
        }
      };

      const agent = new Agent({
        client: mockClient,
        cwd: tempDir,
        headless: true,
        autoConfirm: true,
        snapshotManager: snapManager,
        maxIterations: 4
      });

      let recoveryStartedCount = 0;
      let recoveryCompletedCount = 0;

      try {
        await agent.run("Fix the code", {
          onRecoveryStarted: () => {
            recoveryStartedCount++;
          },
          onRecoveryCompleted: () => {
            recoveryCompletedCount++;
          }
        });
      } catch (err: any) {
        // May reach max iterations after loop
      }

      expect(recoveryStartedCount).toBeGreaterThan(0);
      expect(recoveryCompletedCount).toBeGreaterThan(0);

      // Verify that recovery system instructions were injected into conversation context
      const history = agent.getHistory();
      const hasRecoveryMessage = history.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("[Harness Recovery System]")
      );
      expect(hasRecoveryMessage).toBe(true);
    });
  });
});
