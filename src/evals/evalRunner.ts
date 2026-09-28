import * as fs from "fs";
import * as path from "path";
import { EvalResult, EvalTask, EvaluatorContext, EvaluatorResult, TaskRunMetrics } from "./types";
import { EvaluatorRegistry } from "./evaluatorRegistry";
import { TaskLoader } from "./taskLoader";
import { Agent } from "../agent";
import { ChatModelClient } from "../client";

export interface EvalRunnerOptions {
  taskLoader?: TaskLoader;
  registry?: EvaluatorRegistry;
  resultsDir?: string;
  retainWorkspace?: boolean;
  client?: ChatModelClient;
  maxIterations?: number;
}

export interface TaskAgentExecutionResult {
  output: string;
  filesChanged: string[];
  metrics: TaskRunMetrics;
}

export class EvalRunner {
  private taskLoader: TaskLoader;
  private registry: EvaluatorRegistry;
  private resultsDir: string;
  private retainWorkspace: boolean;
  private client?: ChatModelClient;
  private defaultMaxIterations: number;

  constructor(options: EvalRunnerOptions = {}) {
    this.taskLoader = options.taskLoader || new TaskLoader();
    this.registry = options.registry || new EvaluatorRegistry();
    this.resultsDir = path.resolve(options.resultsDir || path.resolve(process.cwd(), ".eval_results"));
    this.retainWorkspace = options.retainWorkspace || false;
    this.client = options.client;
    this.defaultMaxIterations = options.maxIterations || 30;

    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  /**
   * Run evaluation for a given task
   */
  async runTask(
    task: EvalTask,
    agentExecutor?: (workspaceDir: string, task: EvalTask) => Promise<TaskAgentExecutionResult>
  ): Promise<EvalResult> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = new Date().toISOString();
    const startTime = Date.now();

    // 1. Create clean isolated workspace
    const workspaceDir = this.taskLoader.createIsolatedWorkspace(task, runId);

    let executionResult: TaskAgentExecutionResult = {
      output: "",
      filesChanged: [],
      metrics: {
        iterations: 0,
        toolCalls: 0,
        tokens: 0,
        durationMs: 0,
        filesChanged: 0
      }
    };

    let executionError: string | undefined;

    try {
      // 2. Run agent in the isolated workspace (WITHOUT hidden tests)
      if (agentExecutor) {
        executionResult = await agentExecutor(workspaceDir, task);
      } else if (this.client) {
        executionResult = await this.runBuiltinAgent(workspaceDir, task);
      } else {
        // No agent runner provided - evaluate workspace in current state
        executionResult.metrics.durationMs = Date.now() - startTime;
      }
    } catch (err: any) {
      executionError = `Agent execution error: ${err.message}`;
    }

    // 3. Post-execution: Inject hidden tests into the workspace for verification
    this.taskLoader.injectHiddenTests(workspaceDir, task);

    // If task has hidden test commands, append them to verification test commands
    if (task.hiddenTests?.commands && task.hiddenTests.commands.length > 0) {
      if (!task.verification) {
        task.verification = {};
      }
      const existingCmd = task.verification.testCommand;
      const hiddenCmd = task.hiddenTests.commands.join(" && ");
      task.verification.testCommand = existingCmd ? `${existingCmd} && ${hiddenCmd}` : hiddenCmd;
    }

    // 4. Run evaluators
    const evalContext: EvaluatorContext = {
      task,
      workspaceDir,
      filesChanged: executionResult.filesChanged,
      metrics: executionResult.metrics
    };

    const evaluatorResults: Record<string, EvaluatorResult> = await this.registry.evaluateAll(evalContext);

    // 5. Determine overall pass / fail status
    // Failed if any active evaluator failed or errored, or if agent crashed
    let overallPassed = !executionError;
    for (const [_, res] of Object.entries(evaluatorResults)) {
      if (res.status === "failed" || res.status === "error") {
        overallPassed = false;
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    executionResult.metrics.durationMs = durationMs;

    const result: EvalResult = {
      runId,
      timestamp,
      taskId: task.id,
      taskDescription: task.description,
      status: overallPassed ? "passed" : "failed",
      evaluators: evaluatorResults,
      metrics: executionResult.metrics,
      error: executionError
    };

    // 6. Save result to disk
    this.saveResult(result);

    // 7. Cleanup workspace unless retention requested
    if (!this.retainWorkspace) {
      this.taskLoader.cleanupWorkspace(workspaceDir);
    }

    return result;
  }

  /**
   * Run the built-in Agent in the isolated workspace
   */
  private async runBuiltinAgent(
    workspaceDir: string,
    task: EvalTask
  ): Promise<TaskAgentExecutionResult> {
    if (!this.client) {
      throw new Error("ChatModelClient required to run built-in agent.");
    }

    const originalCwd = process.cwd();
    let toolCallsCount = 0;

    try {
      const agent = new Agent({
        client: this.client,
        cwd: workspaceDir,
        headless: true,
        autoConfirm: true,
        maxIterations: task.limits?.maxIterations || this.defaultMaxIterations,
        tokenThreshold: 8000
      });

      // Construct prompt with visible requirements
      let fullPrompt = task.prompt;
      if (task.requirements && task.requirements.length > 0) {
        fullPrompt += "\n\nRequirements:\n" + task.requirements.map((r) => `- ${r}`).join("\n");
      }

      const output = await agent.run(fullPrompt, {
        onToolCall: () => {
          toolCallsCount++;
        }
      });

      const changed = agent.getFilesChanged();

      return {
        output,
        filesChanged: changed,
        metrics: {
          iterations: 1, // Agent executes run loop
          toolCalls: toolCallsCount,
          tokens: agent.getTotalTokens(),
          durationMs: 0,
          filesChanged: changed.length
        }
      };
    } finally {
      process.chdir(originalCwd);
    }
  }

  /**
   * Save structured result JSON to results directory
   */
  private saveResult(result: EvalResult): void {
    try {
      const runDir = path.join(this.resultsDir, result.runId);
      if (!fs.existsSync(runDir)) {
        fs.mkdirSync(runDir, { recursive: true });
      }
      const filePath = path.join(runDir, `${result.taskId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
    } catch {
      // Ignore write errors in eval runner
    }
  }

  /**
   * Retrieve saved results by run ID or all results
   */
  getSavedResults(runId?: string): EvalResult[] {
    const results: EvalResult[] = [];
    if (!fs.existsSync(this.resultsDir)) {
      return results;
    }

    const runDirs = runId
      ? [path.join(this.resultsDir, runId)]
      : fs.readdirSync(this.resultsDir).map((d) => path.join(this.resultsDir, d));

    for (const d of runDirs) {
      if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
        const files = fs.readdirSync(d).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(d, file), "utf-8");
            results.push(JSON.parse(content) as EvalResult);
          } catch {
            // Ignore
          }
        }
      }
    }

    return results;
  }
}
