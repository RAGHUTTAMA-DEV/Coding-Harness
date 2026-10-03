import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  TaskAnalyzer,
  TaskPlanner,
  Verifier,
  VerificationConfig
} from "../verification";
import { Agent } from "../agent";
import { ChatModelClient, Message } from "../client";
import { SnapshotManager } from "../snapshots";

describe("Verification-Driven Completion Loop Subsystem (Spec §2, §4, §34)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verification-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Task Analyzer Tests
  // ─────────────────────────────────────────────────────────────
  describe("TaskAnalyzer", () => {
    test("classifies different task types based on prompt content", () => {
      const analyzer = new TaskAnalyzer({ workspaceDir: tempDir });

      expect(analyzer.classifyTaskType("Fix broken login endpoint returning 500")).toBe("bug_fix");
      expect(analyzer.classifyTaskType("Add JWT authentication middleware to express")).toBe("security");
      expect(analyzer.classifyTaskType("Implement pagination for GET /products")).toBe("feature");
      expect(analyzer.classifyTaskType("Refactor database queries to use connection pool")).toBe("refactor");
      expect(analyzer.classifyTaskType("Write unit tests for user service")).toBe("testing");
      expect(analyzer.classifyTaskType("Where is the database configuration stored?")).toBe("repo_navigation");
    });

    test("discovers package.json test, typecheck, and build commands", () => {
      const packageJson = {
        name: "test-app",
        scripts: {
          test: "jest",
          typecheck: "tsc --noEmit",
          build: "vite build"
        }
      };
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify(packageJson, null, 2));

      const analyzer = new TaskAnalyzer({ workspaceDir: tempDir });
      const discovered = analyzer.discoverWorkspaceVerification();

      expect(discovered.testCommand).toContain("test");
      expect(discovered.typecheckCommand).toBe("npm run typecheck");
      expect(discovered.buildCommand).toBe("npm run build");
    });

    test("extracts explicit requirements and forbidden paths", () => {
      const analyzer = new TaskAnalyzer({ workspaceDir: tempDir });
      const prompt = `Add pagination to /users
- Return page and limit in response
- Support page=2&limit=10
- Throw 400 on invalid page number`;

      const analysis = analyzer.analyze(prompt, { forbiddenPaths: [".env.production"] });

      expect(analysis.taskType).toBe("feature");
      expect(analysis.requirements.length).toBe(3);
      expect(analysis.requirements[0]).toBe("Return page and limit in response");
      expect(analysis.forbiddenPaths).toContain(".env.production");
      expect(analysis.forbiddenPaths).toContain(".env");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Task Planner Tests
  // ─────────────────────────────────────────────────────────────
  describe("TaskPlanner", () => {
    test("generates structured execution plan and acceptance criteria", () => {
      const analyzer = new TaskAnalyzer({ workspaceDir: tempDir });
      const analysis = analyzer.analyze("Fix broken auth token parser\n- Must validate exp claim");
      const plan = TaskPlanner.plan(analysis);

      expect(plan.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(plan.todoItems.length).toBeGreaterThan(0);
      expect(plan.formattedBriefing).toContain("Harness Verification Standard");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Verifier Engine Tests
  // ─────────────────────────────────────────────────────────────
  describe("Verifier Engine", () => {
    test("passes when verification commands exit with 0", async () => {
      const customRunner = async (cmd: string) => {
        return { stdout: "Tests passed: 5/5", stderr: "", exitCode: 0, durationMs: 15 };
      };

      const verifier = new Verifier({
        workspaceDir: tempDir,
        config: { testCommand: "bun test" },
        customRunner
      });

      const res = await verifier.verify([]);
      expect(res.passed).toBe(true);
      expect(res.checks[0].status).toBe("passed");
      expect(res.checks[0].name).toBe("tests");
    });

    test("fails and captures output when verification command exits with non-zero code", async () => {
      const customRunner = async (cmd: string) => {
        return {
          stdout: "FAIL auth.test.ts\nExpected 200 but received 401",
          stderr: "",
          exitCode: 1,
          durationMs: 20
        };
      };

      const verifier = new Verifier({
        workspaceDir: tempDir,
        config: { testCommand: "npm test" },
        customRunner
      });

      const res = await verifier.verify([]);
      expect(res.passed).toBe(false);
      expect(res.checks[0].status).toBe("failed");
      expect(res.failureSummary).toContain("Expected 200 but received 401");

      const feedback = Verifier.formatFeedbackForAgent(res);
      expect(feedback).toContain("Harness Verification Failed");
      expect(feedback).toContain("Expected 200 but received 401");
    });

    test("detects forbidden paths modifications and flags failure", async () => {
      const verifier = new Verifier({
        workspaceDir: tempDir,
        config: {
          testCommand: "echo ok",
          forbiddenPaths: [".env", "config/secrets.json"]
        },
        customRunner: async () => ({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 5 })
      });

      const res = await verifier.verify([".env", "src/index.ts"]);
      expect(res.passed).toBe(false);
      const forbiddenCheck = res.checks.find((c) => c.name === "forbidden_paths");
      expect(forbiddenCheck).toBeDefined();
      expect(forbiddenCheck?.status).toBe("failed");
      expect(forbiddenCheck?.error).toContain(".env");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Verification-Driven Agent Loop (Spec §34 Test 1 & Test 2)
  // ─────────────────────────────────────────────────────────────
  describe("Verification-Driven Completion Loop Integration", () => {
    test("Spec Test 1: Agent modifies repository and verification detects success", async () => {
      const snapManager = new SnapshotManager(tempDir);
      fs.writeFileSync(path.join(tempDir, "app.ts"), "export const hello = () => 'world';");
      await snapManager.createSnapshot({ description: "Initial baseline" });

      let verificationCalled = false;
      const customVerifier = new Verifier({
        workspaceDir: tempDir,
        config: { testCommand: "npm test" },
        customRunner: async () => {
          verificationCalled = true;
          return { stdout: "Tests: 1 passed, 1 total", stderr: "", exitCode: 0, durationMs: 10 };
        }
      });

      const mockClient: ChatModelClient = {
        chat: async () => ({ role: "assistant", content: "Done" }),
        chatStream: async (_msgs, _tools, cb) => {
          cb?.({ content: "Task complete" });
          // Agent stops calling tools immediately, proposing completion
          return {
            role: "assistant",
            content: "I have finished the task."
          };
        }
      };

      const agent = new Agent({
        client: mockClient,
        cwd: tempDir,
        headless: true,
        autoConfirm: true,
        snapshotManager: snapManager,
        verifier: customVerifier,
        enableVerification: true
      });

      let verificationSuccessEvent = false;
      await agent.run("Implement greeting feature", {
        onVerificationCompleted: (res) => {
          verificationSuccessEvent = res.passed;
        }
      });

      expect(verificationCalled).toBe(true);
      expect(verificationSuccessEvent).toBe(true);

      // Verify harness created an 'after_successful_verification' checkpoint
      const checkpoints = await snapManager.listCheckpoints();
      const verifiedCheckpoint = checkpoints.find(
        (c) => c.reason === "after_successful_verification"
      );
      expect(verifiedCheckpoint).toBeDefined();
    });

    test("Spec Test 2: Premature completion is rejected on failing tests -> agent fixes -> verification passes", async () => {
      const snapManager = new SnapshotManager(tempDir);
      fs.writeFileSync(path.join(tempDir, "calc.ts"), "export const add = (a, b) => a - b;"); // Bug: minus instead of plus
      await snapManager.createSnapshot({ description: "Initial code" });

      let testRuns = 0;
      // First verification fails; second verification (after fix) passes!
      const customVerifier = new Verifier({
        workspaceDir: tempDir,
        config: { testCommand: "npm test" },
        customRunner: async () => {
          testRuns++;
          if (testRuns === 1) {
            return {
              stdout: "FAIL calc.test.ts\nExpected 5, received -1",
              stderr: "",
              exitCode: 1,
              durationMs: 12
            };
          } else {
            return {
              stdout: "PASS calc.test.ts\nAll tests passed",
              stderr: "",
              exitCode: 0,
              durationMs: 10
            };
          }
        }
      });

      let turn = 0;
      const mockClient: ChatModelClient = {
        chat: async () => ({ role: "assistant", content: "Done" }),
        chatStream: async (messages: Message[]) => {
          turn++;
          if (turn === 1) {
            // First turn: agent prematurely claims it is done without fixing
            return {
              role: "assistant",
              content: "I am done!"
            };
          } else if (turn === 2) {
            // Second turn: agent received harness verification failure feedback in messages!
            const hasVerificationFeedback = messages.some(
              (m) => typeof m.content === "string" && m.content.includes("Harness Verification Failed")
            );
            expect(hasVerificationFeedback).toBe(true);

            // Now agent fixes the file using edit_file
            return {
              role: "assistant",
              content: "I see the test failed. Let me fix the bug.",
              tool_calls: [
                {
                  id: "edit-1",
                  function: {
                    name: "edit_file",
                    arguments: JSON.stringify({
                      path: path.join(tempDir, "calc.ts"),
                      search: "a - b",
                      replace: "a + b"
                    })
                  }
                }
              ]
            };
          } else {
            // Third turn: after edit tool execution, agent proposes completion again
            return {
              role: "assistant",
              content: "I have fixed the calculation bug. Everything is ready."
            };
          }
        }
      };

      const agent = new Agent({
        client: mockClient,
        cwd: tempDir,
        headless: true,
        autoConfirm: true,
        snapshotManager: snapManager,
        verifier: customVerifier,
        enableVerification: true,
        maxVerificationCycles: 3
      });

      let verificationFailedCount = 0;
      let verificationCompletedCount = 0;

      await agent.run("Fix calculation bug", {
        onVerificationFailed: () => {
          verificationFailedCount++;
        },
        onVerificationCompleted: () => {
          verificationCompletedCount++;
        }
      });

      // Verification intercepted turn 1, failed, forced turn 2, then passed on turn 3!
      expect(testRuns).toBe(2);
      expect(verificationFailedCount).toBe(1);
      expect(verificationCompletedCount).toBe(1);

      // Verify the file was fixed
      const finalCode = fs.readFileSync(path.join(tempDir, "calc.ts"), "utf-8");
      expect(finalCode).toContain("a + b");
    });
  });
});
