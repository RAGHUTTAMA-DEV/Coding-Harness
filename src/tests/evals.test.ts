import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { TaskLoader } from "../evals/taskLoader";
import { EvaluatorRegistry } from "../evals/evaluatorRegistry";
import { TestEvaluator } from "../evals/evaluators/tests";
import { FilesEvaluator } from "../evals/evaluators/files";
import { DiffEvaluator } from "../evals/evaluators/diff";
import { SecurityEvaluator } from "../evals/evaluators/security";
import { RequirementsEvaluator } from "../evals/evaluators/requirements";
import { ReportGenerator } from "../evals/reports/reportGenerator";
import { EvalRunner } from "../evals/evalRunner";
import { EvalResult, EvalTask } from "../evals/types";

describe("Evaluation Framework Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-test-"));
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup
    }
  });

  test("TaskLoader discovers tasks and creates isolated workspace with hidden tests", () => {
    const loader = new TaskLoader();
    const tasks = loader.loadDataset("coding-harness-v1");
    expect(tasks.length).toBeGreaterThan(0);

    const bugTask = tasks.find((t) => t.id === "BUG-001");
    expect(bugTask).toBeDefined();
    expect(bugTask?.category).toBe("bug-fix");

    // Test isolated workspace creation
    const isolatedDir = loader.createIsolatedWorkspace(bugTask!, "test-run-1");
    expect(fs.existsSync(isolatedDir)).toBe(true);

    // Prior to hidden test injection, chunk.test.ts must not exist
    const hiddenTestPath = path.join(isolatedDir, "chunk.test.ts");
    expect(fs.existsSync(hiddenTestPath)).toBe(false);

    // Inject hidden tests
    loader.injectHiddenTests(isolatedDir, bugTask!);
    expect(fs.existsSync(hiddenTestPath)).toBe(true);
    expect(fs.readFileSync(hiddenTestPath, "utf-8")).toContain("chunkArray");

    // Clean up
    loader.cleanupWorkspace(isolatedDir);
    expect(fs.existsSync(isolatedDir)).toBe(false);
  });

  test("FilesEvaluator detects forbidden file modifications and missing required files", async () => {
    const evaluator = new FilesEvaluator();
    const task: EvalTask = {
      id: "TEST-01",
      category: "bug-fix",
      description: "Test task",
      prompt: "Do test",
      constraints: {
        forbiddenPaths: [".env", "secret/key.txt"],
        requiredPaths: ["src/index.ts"]
      }
    };

    // Case 1: Violation - forbidden path modified and required file missing
    const res1 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: [".env", "src/foo.ts"]
    });

    expect(res1.status).toBe("failed");
    expect(res1.score).toBeLessThan(1.0);
    expect(res1.details?.violations.length).toBe(1);
    expect(res1.details?.missingRequired.length).toBe(1);

    // Case 2: Success - required file created, forbidden untouched
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "export const x = 1;");

    const res2 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: ["src/index.ts"]
    });

    expect(res2.status).toBe("passed");
    expect(res2.score).toBe(1.0);
    expect(res2.details?.violations.length).toBe(0);
  });

  test("SecurityEvaluator detects hardcoded API secrets", async () => {
    const evaluator = new SecurityEvaluator();
    const task: EvalTask = {
      id: "SEC-01",
      category: "security",
      description: "Security test",
      prompt: "Scan test"
    };

    // Create file containing OpenAI secret key
    const secretFile = path.join(tempDir, "config.ts");
    fs.writeFileSync(secretFile, 'export const KEY = "sk-abcdefghijklmnopqrstuvwxyz1234567890";');

    const res1 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: ["config.ts"]
    });

    expect(res1.status).toBe("failed");
    expect(res1.score).toBe(0.0);
    expect(res1.details?.findings.length).toBeGreaterThan(0);
    expect(res1.details?.findings[0]).toContain("OpenAI API Key");

    // Clean file
    fs.writeFileSync(secretFile, 'export const KEY = process.env.KEY;');
    const res2 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: ["config.ts"]
    });

    expect(res2.status).toBe("passed");
    expect(res2.score).toBe(1.0);
  });

  test("DiffEvaluator flags sensitive credential files", async () => {
    const evaluator = new DiffEvaluator();
    const task: EvalTask = {
      id: "DIFF-01",
      category: "refactor",
      description: "Diff test",
      prompt: "Diff test"
    };

    const res1 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: ["src/app.ts", ".env.production"]
    });

    expect(res1.status).toBe("failed");
    expect(res1.details?.sensitiveFilesModified).toContain(".env.production");

    const res2 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: ["src/app.ts", "src/helper.ts"]
    });

    expect(res2.status).toBe("passed");
    expect(res2.details?.filesChangedCount).toBe(2);
  });

  test("TestEvaluator parses test output counts and calculates score", async () => {
    const evaluator = new TestEvaluator();
    const task: EvalTask = {
      id: "TEST-EVAL",
      category: "testing",
      description: "Test run",
      prompt: "Run tests",
      verification: {
        testCommand: "bun test"
      }
    };

    // Mock custom runner passing 10 tests
    const res1 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: [],
      runCommand: async () => ({
        stdout: "10 pass\n0 fail\nRan 10 tests across 1 files.",
        stderr: "",
        exitCode: 0
      })
    });

    expect(res1.status).toBe("passed");
    expect(res1.score).toBe(1.0);
    expect(res1.passed).toBe(10);
    expect(res1.failed).toBe(0);

    // Mock custom runner with 2 failures
    const res2 = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: [],
      runCommand: async () => ({
        stdout: "8 pass\n2 fail\nRan 10 tests across 1 files.",
        stderr: "",
        exitCode: 1
      })
    });

    expect(res2.status).toBe("failed");
    expect(res2.passed).toBe(8);
    expect(res2.failed).toBe(2);
    expect(res2.score).toBe(0.8);
  });

  test("RequirementsEvaluator checks verification commands", async () => {
    const evaluator = new RequirementsEvaluator();
    const task: EvalTask = {
      id: "REQ-01",
      category: "feature",
      description: "Check verification commands",
      prompt: "Verify",
      verification: {
        commands: ["echo ok", "check-something"]
      }
    };

    const res = await evaluator.evaluate({
      task,
      workspaceDir: tempDir,
      filesChanged: [],
      runCommand: async (cmd) => ({
        stdout: "ok",
        stderr: "",
        exitCode: cmd === "echo ok" ? 0 : 1
      })
    });

    expect(res.status).toBe("failed");
    expect(res.score).toBe(0.5);
    expect(res.details?.commandResults.length).toBe(2);
  });

  test("ReportGenerator generates formatted verification and execution summary", () => {
    const evalResult: EvalResult = {
      runId: "run-test-123",
      timestamp: new Date().toISOString(),
      taskId: "auth-jwt-001",
      taskDescription: "Add JWT authentication",
      status: "passed",
      evaluators: {
        tests: { status: "passed", score: 1.0, passed: 24, failed: 0, total: 24 },
        typecheck: { status: "passed", score: 1.0 },
        build: { status: "passed", score: 1.0 },
        requirements: { status: "passed", score: 0.95 },
        security: { status: "passed", score: 1.0 }
      },
      metrics: {
        iterations: 17,
        toolCalls: 32,
        tokens: 28000,
        durationMs: 143000,
        filesChanged: 6,
        recoveryAttempts: 1,
        rollbackCount: 0,
        guardrailBlocks: 1,
        mcpCalls: 3
      }
    };

    const report = ReportGenerator.generateReport(evalResult, false);
    expect(report).toContain("CODING-HARNESS EVALUATION");
    expect(report).toContain("Add JWT authentication");
    expect(report).toContain("✓ PASSED");
    expect(report).toContain("Tests             24/24 ✓");
    expect(report).toContain("Typecheck         PASS ✓");
    expect(report).toContain("Build             PASS ✓");
    expect(report).toContain("Requirements      95% ✓");
    expect(report).toContain("Security          PASS ✓");
    expect(report).toContain("Iterations        17");
    expect(report).toContain("Tool Calls        32");
    expect(report).toContain("MCP Calls         3");
    expect(report).toContain("Tokens            28,000");
    expect(report).toContain("Files Changed     6");
    expect(report).toContain("VERIFIED ✓");

    const summary = ReportGenerator.generateSummary([evalResult]);
    expect(summary).toContain("auth-jwt-001");
    expect(summary).toContain("PASS");
    expect(summary).toContain("Total Tasks: 1 | Passed: 1 (100%)");
  });

  test("EvalRunner orchestrates isolated workspace execution, hidden tests, and evaluators", async () => {
    const runner = new EvalRunner({
      resultsDir: path.join(tempDir, "results")
    });

    const task: EvalTask = {
      id: "MOCK-001",
      category: "bug-fix",
      description: "Mock evaluation task",
      prompt: "Write mock file",
      constraints: {
        requiredPaths: ["result.txt"]
      },
      hiddenTests: {
        files: [
          { path: "hidden_verifier.txt", content: "VERIFIED" }
        ]
      }
    };

    const result = await runner.runTask(task, async (workspaceDir) => {
      // Mock agent implementation creates result.txt
      fs.writeFileSync(path.join(workspaceDir, "result.txt"), "Done");
      return {
        output: "Completed task",
        filesChanged: ["result.txt"],
        metrics: {
          iterations: 2,
          toolCalls: 3,
          tokens: 500,
          durationMs: 100,
          filesChanged: 1
        }
      };
    });

    expect(result.status).toBe("passed");
    expect(result.evaluators.files.status).toBe("passed");
    expect(result.metrics.toolCalls).toBe(3);
    expect(result.metrics.filesChanged).toBe(1);

    // Verify saved results can be retrieved
    const saved = runner.getSavedResults(result.runId);
    expect(saved.length).toBe(1);
    expect(saved[0].taskId).toBe("MOCK-001");
  });
});
