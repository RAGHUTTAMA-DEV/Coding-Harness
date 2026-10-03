import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ChatModelClient, Message, ToolCall } from "./client";
import { getToolByName, getToolDefinitions, setActiveClient, tools } from "./tools";
import { PermissionGate } from "./permissions/permissionGate";
import { ContextManager } from "./context/contextManager";
import { PolicyEngine } from "./guardrails/policyEngine";
import { McpManager } from "./mcp/manager";
import { Tool } from "./tools/types";
import { SnapshotManager, SnapshotMetadata, CheckpointMetadata, CheckpointReason, RollbackResult } from "./snapshots";
import { setActiveSnapshotManager } from "./tools/checkpoint";
import {
  RecoveryEngine,
  FailureContext,
  RecoveryAction,
  RecoveryStrategyResult,
  LoopDetectionResult
} from "./recovery";
import {
  Verifier,
  TaskAnalyzer,
  TaskPlanner,
  VerificationConfig,
  VerificationResult,
  TaskAnalysis
} from "./verification";

export interface AgentEvents {
  onTextChunk?: (text: string) => void;
  onThinkingChunk?: (text: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCall: ToolCall, result: string) => void;
  onCompaction?: (summary: string) => void;
  onStaleReadInvalidated?: (filePath: string) => void;
  onRecoveryStarted?: (context: FailureContext, action: RecoveryAction) => void;
  onRecoveryCompleted?: (result: RecoveryStrategyResult) => void;
  onLoopDetected?: (result: LoopDetectionResult) => void;
  onVerificationCompleted?: (result: VerificationResult) => void;
  onVerificationFailed?: (result: VerificationResult) => void;
  onTaskAnalyzed?: (analysis: TaskAnalysis) => void;
}

export class Agent {
  private client: ChatModelClient;
  private contextManager: ContextManager;
  private rl?: readline.Interface;
  private systemPrompt: string;
  public isInterrupted: boolean = false;
  public isRunning: boolean = false;
  private isSubAgent: boolean = false;
  private toolExecutionMode: "sequential" | "parallel";
  private headless: boolean = false;
  private autoConfirm: boolean = false;
  private maxIterations?: number;
  private cwd?: string;
  private filesChanged: Set<string> = new Set();
  private policyEngine?: PolicyEngine;
  private mcpManager?: McpManager;
  private snapshotManager: SnapshotManager;
  private autoSnapshot: boolean = false;
  private recoveryEngine: RecoveryEngine;
  private verifier?: Verifier;
  private taskAnalyzer: TaskAnalyzer;
  private enableVerification: boolean = true;
  private maxVerificationCycles: number = 4;

  constructor(options: {
    client: ChatModelClient;
    rl?: readline.Interface;
    systemPrompt?: string;
    tokenThreshold?: number;
    isSubAgent?: boolean;
    toolExecutionMode?: "sequential" | "parallel";
    headless?: boolean;
    autoConfirm?: boolean;
    maxIterations?: number;
    cwd?: string;
    policyEngine?: PolicyEngine;
    mcpManager?: McpManager;
    snapshotManager?: SnapshotManager;
    autoSnapshot?: boolean;
    recoveryEngine?: RecoveryEngine;
    verifier?: Verifier;
    verificationConfig?: VerificationConfig;
    enableVerification?: boolean;
    maxVerificationCycles?: number;
    taskAnalyzer?: TaskAnalyzer;
  }) {
    this.client = options.client;
    this.rl = options.rl;
    this.isSubAgent = options.isSubAgent || false;
    this.toolExecutionMode = options.toolExecutionMode || "parallel";
    this.headless = options.headless || false;
    this.autoConfirm = options.autoConfirm || false;
    this.maxIterations = options.maxIterations;
    this.policyEngine = options.policyEngine;
    this.mcpManager = options.mcpManager;
    this.autoSnapshot = options.autoSnapshot || false;
    this.enableVerification =
      options.enableVerification ??
      (options.verificationConfig !== undefined || options.verifier !== undefined);
    this.maxVerificationCycles = options.maxVerificationCycles ?? 4;

    if (this.mcpManager) {
      this.mcpManager.registerToolsWithHarness();
    }

    if (options.cwd) {
      this.cwd = path.resolve(options.cwd);
      process.chdir(this.cwd);
    } else {
      this.cwd = process.cwd();
    }

    this.snapshotManager = options.snapshotManager || new SnapshotManager(this.cwd);
    setActiveSnapshotManager(this.snapshotManager);

    this.recoveryEngine =
      options.recoveryEngine ||
      new RecoveryEngine({
        workspaceDir: this.cwd,
        snapshotManager: this.snapshotManager,
        headless: this.headless,
        rl: this.rl
      });

    this.taskAnalyzer = options.taskAnalyzer || new TaskAnalyzer({ workspaceDir: this.cwd });

    if (options.verifier) {
      this.verifier = options.verifier;
    } else if (options.verificationConfig) {
      this.verifier = new Verifier({ workspaceDir: this.cwd, config: options.verificationConfig });
    } else if (this.enableVerification) {
      this.verifier = new Verifier({ workspaceDir: this.cwd });
    }

    setActiveClient(this.client);
    
    this.systemPrompt = options.systemPrompt || this.buildDefaultSystemPrompt();

    let projectMemory: string | null = null;
    try {
      const agentMdPath = path.resolve(process.cwd(), "AGENT.md");
      if (fs.existsSync(agentMdPath)) {
        projectMemory = fs.readFileSync(agentMdPath, "utf-8");
      }
    } catch (e) {
    }

    this.contextManager = new ContextManager({
      client: this.client,
      systemPrompt: this.systemPrompt,
      projectMemory,
      tokenThreshold: options.tokenThreshold
    });
  }

  setClient(client: ChatModelClient) {
    this.client = client;
    this.contextManager.setClient(client);
    setActiveClient(client);
  }

  getToolExecutionMode(): "sequential" | "parallel" {
    return this.toolExecutionMode;
  }

  setToolExecutionMode(mode: "sequential" | "parallel") {
    this.toolExecutionMode = mode;
  }

  /**
   * Return the history of messages
   */
  getHistory(): Message[] {
    return this.contextManager.getHistory();
  }

  /**
   * Reset message history
   */
  clearHistory() {
    this.contextManager.clearHistory();
  }

  /**
   * Set message history directly (useful for resuming sessions)
   */
  setHistory(msgs: Message[]) {
    this.contextManager.setHistory(msgs);
  }

  getTotalTokens(): number {
    return this.contextManager.getTotalTokens();
  }

  getTokenThreshold(): number {
    return this.contextManager.getTokenThreshold();
  }

  getFilesChanged(): string[] {
    return Array.from(this.filesChanged);
  }

  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager;
  }

  getRecoveryEngine(): RecoveryEngine {
    return this.recoveryEngine;
  }

  getVerifier(): Verifier | undefined {
    return this.verifier;
  }

  getTaskAnalyzer(): TaskAnalyzer {
    return this.taskAnalyzer;
  }

  setVerificationConfig(config: VerificationConfig): void {
    if (!this.verifier) {
      this.verifier = new Verifier({ workspaceDir: this.cwd, config });
    } else {
      this.verifier.setConfig(config);
    }
  }

  private async handleToolResultRecovery(
    toolName: string,
    toolArgs: any,
    result: string,
    events: AgentEvents
  ): Promise<{ shouldAbort: boolean }> {
    const isError = result.startsWith("Error:") || result.includes("Permission denied by user");
    const isTestCommand =
      toolName === "run_command" &&
      /(?:npm|bun|yarn|pnpm)\s+(?:test|run\s+test)|jest|vitest|pytest|mocha\b/i.test(toolArgs?.command || "");
    const isTestFailure =
      isTestCommand &&
      /\b(?:FAIL|FAILED|Tests:\s+\d+\s+failed|AssertionError|expect\(.*?\)\.to|Assertion failed)\b/i.test(result);

    const isFailure = isError || isTestFailure;

    const loopResult = this.recoveryEngine.recordAction(
      toolName,
      toolArgs,
      isFailure ? "failure" : "success",
      result
    );

    if (loopResult.loopDetected && events.onLoopDetected) {
      events.onLoopDetected(loopResult);
    }

    if (isFailure || loopResult.loopDetected) {
      const recoveryResult = await this.recoveryEngine.handleIncident({
        error: isError ? result : undefined,
        output: result,
        toolName,
        toolArgs,
        policyDecision: result.includes("Permission denied") ? "DENY" : undefined,
        loopDetected: loopResult.loopDetected
      });

      if (events.onRecoveryCompleted) {
        events.onRecoveryCompleted(recoveryResult);
      }

      if (recoveryResult.instructionForAgent) {
        this.contextManager.addMessage({
          role: "user",
          content: `[Harness Recovery System]: ${recoveryResult.instructionForAgent}`
        });
      }

      if (recoveryResult.action === "ROLLBACK" && recoveryResult.success) {
        if (recoveryResult.customData?.deletedUntrackedFiles) {
          for (const f of recoveryResult.customData.deletedUntrackedFiles) {
            this.filesChanged.delete(f);
          }
        }
      }

      if (recoveryResult.action === "ABORT") {
        return { shouldAbort: true };
      }
    }

    return { shouldAbort: false };
  }

  async createSnapshot(description: string = "Agent snapshot"): Promise<SnapshotMetadata> {
    return this.snapshotManager.createSnapshot({ description, creator: "agent" });
  }

  async createCheckpoint(
    reason: CheckpointReason,
    description?: string
  ): Promise<CheckpointMetadata> {
    return this.snapshotManager.createCheckpoint({
      reason,
      description: description || `Agent checkpoint (${reason})`,
      conversationState: {
        messages: this.getHistory(),
        totalTokens: this.getTotalTokens()
      },
      metrics: {
        filesChanged: this.getFilesChanged()
      }
    });
  }

  async restoreCheckpoint(
    checkpointId: string
  ): Promise<{ rollbackResult: RollbackResult; checkpoint: CheckpointMetadata }> {
    const res = await this.snapshotManager.restoreCheckpoint(checkpointId);
    if (res.checkpoint.conversationState?.messages) {
      this.setHistory(res.checkpoint.conversationState.messages);
    }
    return res;
  }

  /**
   * Dynamically constructs the system prompt to include all current tools,
   * specifically highlighting external MCP tools (like web search).
   */
  public buildDefaultSystemPrompt(): string {
    const cwd = this.cwd || process.cwd();
    const platform = process.platform;

    // List all registered tools with descriptions
    const toolList = tools.map((t) => `- '${t.name}': ${t.description}`).join("\n");

    const mcpTools = tools.filter((t) => t.name.startsWith("mcp_"));
    const mcpGuidance =
      mcpTools.length > 0
        ? `\n\nExternal MCP Tools Configured:\n${mcpTools
            .map((t) => `- '${t.name}': ${t.description}`)
            .join("\n")}\n* CRITICAL INSTRUCTION FOR EXTERNAL TOOLS: When the user asks you to search the web, lookup real-time information, research an API, or find anything on the internet, YOU MUST invoke the external web search tool ('mcp_duckduckgo_web_search') instead of refusing or saying you lack web access!`
        : "";

    return `You are an advanced agentic coding assistant called Coding-Harness.
You are running on the user's host machine.
Current Working Directory: ${cwd}
Platform: ${platform}

You have direct access to the following tools:
${toolList}${mcpGuidance}

Strict Guidelines:
1. Be direct, professional, and clear. Avoid verbose pleasantries.
2. Systematic Exploration: NEVER guess the layout of the codebase, directory structures, or file names. Always use the 'glob' or 'grep' tools first to discover files, locate directories, and explore the workspace before attempting to read or edit.
3. Plan and Track Tasks: For any multi-step task, start by reading the current TODO checklist using 'todo_read'. If it does not exist, create it with 'todo_write' to list the steps. Keep the checklist updated as you execute tasks.
4. Read Before Editing: Always use 'read_file' on a file before trying to edit it with 'edit_file'. This ensures you know the exact line numbers, code contents, and indentation, avoiding find-and-replace failures.
5. Verify Modifications: Always run 'check_syntax' after writing or editing a JavaScript or TypeScript file. For other files or codebases, run tests or verify builds using 'run_command'.
6. Complete Code: Write fully-functional code. Do not use placeholders, shorthand, or leave sections for the user to implement.
7. Immediate Tool Execution: You MUST call tools in the same turn to execute your planned changes. Never explain what you are about to do in text and stop without outputting the tool call. If you say "Let me make these changes" or "I will write this file", you must output the corresponding tool call in the same response block.
8. Safe Recovery: If a tool call fails, inspect the error output, diagnose the issue, and try an alternative approach.
9. Web Search & External Tools: When the user asks to search or lookup information online, immediately call 'mcp_duckduckgo_web_search'. Never apologize or claim you do not have web access.
`;
  }

  /**
   * Refreshes harness tools and updates the system prompt in contextManager.
   */
  public refreshToolsAndSystemPrompt(): void {
    if (this.mcpManager) {
      this.mcpManager.registerToolsWithHarness();
    }
    this.systemPrompt = this.buildDefaultSystemPrompt();
    this.contextManager.setSystemPrompt(this.systemPrompt);
  }

  /**
   * Returns tool definitions available to the agent.
   * If running as a sub-agent, restricts definitions to safe, read-only tools.
   */
  private getAvailableToolDefinitions(): any[] {
    let filteredTools = tools;
    if (this.isSubAgent) {
      filteredTools = tools.filter(t => !t.isMutating);
    }
    return filteredTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }));
  }

  private async checkToolPermission(tool: Tool, toolArgs: any): Promise<boolean> {
    if (this.policyEngine) {
      return await this.policyEngine.checkPermission(
        tool.name,
        toolArgs,
        {
          workspaceDir: this.cwd || process.cwd(),
          autoConfirm: this.autoConfirm
        },
        this.rl
      );
    }
    if (tool.isMutating) {
      return await PermissionGate.checkPermission(
        tool.name,
        toolArgs,
        this.rl,
        this.autoConfirm
      );
    }
    return true;
  }

  /**
   * Run a single turn of the agent loop
   */
  async run(userInput: string, events: AgentEvents = {}): Promise<string> {
    this.isRunning = true;
    this.filesChanged.clear();
    this.recoveryEngine.setEventCallbacks({
      onRecoveryStarted: events.onRecoveryStarted,
      onRecoveryCompleted: events.onRecoveryCompleted
    });
    try {
      if (this.autoSnapshot) {
        try {
          await this.createSnapshot(`Task start: ${userInput.slice(0, 80)}`);
        } catch {
          // Continue execution even if initial auto-snapshot fails
        }
      }

      // Add user message to history
      this.contextManager.addMessage({
        role: "user",
        content: userInput
      });

      // Analyze task requirements and auto-discover verification if needed
      const analysis = this.taskAnalyzer.analyze(userInput);
      if (events.onTaskAnalyzed) {
        events.onTaskAnalyzed(analysis);
      }

      if (this.verifier && this.enableVerification) {
        const curConfig = this.verifier.getConfig();
        if (!curConfig.testCommand && analysis.discoveredVerification.testCommand) {
          curConfig.testCommand = analysis.discoveredVerification.testCommand;
        }
        if (!curConfig.typecheckCommand && analysis.discoveredVerification.typecheckCommand) {
          curConfig.typecheckCommand = analysis.discoveredVerification.typecheckCommand;
        }
        if (!curConfig.buildCommand && analysis.discoveredVerification.buildCommand) {
          curConfig.buildCommand = analysis.discoveredVerification.buildCommand;
        }
        if (!curConfig.forbiddenPaths || curConfig.forbiddenPaths.length === 0) {
          curConfig.forbiddenPaths = analysis.forbiddenPaths;
        }
        this.verifier.setConfig(curConfig);
      }

      let keepLooping = true;
      let finalAssistantText = "";
      let iterations = 0;
      let verificationCycle = 1;

      while (keepLooping) {
        iterations++;
        if (this.maxIterations !== undefined && iterations > this.maxIterations) {
          throw new Error(`Max iterations cap of ${this.maxIterations} reached.`);
        }
        // Handle user steering interruption
        if (this.isInterrupted) {
          this.isInterrupted = false;
          if (this.rl) {
            console.log("\n\x1b[1m\x1b[33m🛸 Agent Loop Interrupted by User!\x1b[0m");
            const steeringInput = await new Promise<string>((resolve) => {
              this.rl!.question(
                "\x1b[1m\x1b[35msteer instruction (or press Enter to resume)>\x1b[0m ",
                (answer) => resolve(answer.trim())
              );
            });

            if (steeringInput !== "") {
              console.log(`\x1b[90mInjecting steering instruction: "${steeringInput}"\x1b[0m\n`);
              this.contextManager.addMessage({
                role: "user",
                content: `[User Steering Instruction]: ${steeringInput}`
              });
            } else {
              console.log("\x1b[90mResuming agent execution...\x1b[0m\n");
            }
          }
        }
        const payload = this.contextManager.getPayload();

        // Stream the response from the LLM 
        let assistantMessage;
        const maxRetries = 3;
        let attempt = 0;
        while (attempt < maxRetries) {
          try {
            assistantMessage = await this.client.chatStream(
              payload,
              this.getAvailableToolDefinitions(),
              (chunk) => {
                if (chunk.content && events.onTextChunk) {
                  events.onTextChunk(chunk.content);
                }
                if (chunk.thinking && events.onThinkingChunk) {
                  events.onThinkingChunk(chunk.thinking);
                }
              }
            );
            break;
          } catch (err: any) {
            attempt++;
            if (attempt >= maxRetries) {
              throw err;
            }
            console.log(`\n\x1b[33m⚠️  Model client error (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in 2s...\x1b[0m`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        if (!assistantMessage) {
          throw new Error("Failed to retrieve completion from Ollama client.");
        }

        this.contextManager.addMessage(assistantMessage);
        this.contextManager.updateTokens(assistantMessage);
        finalAssistantText = assistantMessage.content;

        const toolCalls = assistantMessage.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          // The agent proposes completion! The harness verifies whether the task actually succeeded.
          if (this.verifier && this.enableVerification) {
            const config = this.verifier.getConfig();
            const hasAnyCheck =
              Boolean(config.testCommand ||
              config.typecheckCommand ||
              config.buildCommand ||
              config.lintCommand ||
              (config.customCommands && config.customCommands.length > 0) ||
              (config.forbiddenPaths && config.forbiddenPaths.length > 0));

            if (hasAnyCheck) {
              const filesChanged = this.getFilesChanged();
              const verificationResult = await this.verifier.verify(filesChanged, verificationCycle);

              if (verificationResult.passed) {
                if (events.onVerificationCompleted) {
                  events.onVerificationCompleted(verificationResult);
                }
                try {
                  await this.createCheckpoint(
                    "after_successful_verification",
                    "Harness verified task success"
                  );
                } catch {}
                keepLooping = false;
                break;
              } else {
                // Verification failed! Reject completion and trigger recovery
                if (events.onVerificationFailed) {
                  events.onVerificationFailed(verificationResult);
                }

                verificationCycle++;
                if (verificationCycle > this.maxVerificationCycles) {
                  throw new Error(
                    `Task completion rejected: verification failed after ${this.maxVerificationCycles} cycles:\n${verificationResult.failureSummary}`
                  );
                }

                // Notify recovery engine of verification failure
                await this.recoveryEngine.handleIncident({
                  error: verificationResult.failureSummary,
                  output: verificationResult.failureSummary,
                  toolName: "verification",
                  toolArgs: { checks: verificationResult.checks.map((c) => c.name) }
                });

                // Format feedback and inject as user message for the agent to fix
                const feedback = Verifier.formatFeedbackForAgent(verificationResult);
                this.contextManager.addMessage({
                  role: "user",
                  content: feedback
                });

                continue;
              }
            } else {
              keepLooping = false;
              break;
            }
          } else {
            keepLooping = false;
            break;
          }
        }

        // Execute all tool calls
        if (this.toolExecutionMode === "sequential") {
          for (const toolCall of toolCalls) {
            if (events.onToolCall) {
              events.onToolCall(toolCall);
            }

            const tool = getToolByName(toolCall.function.name);
            let result = "";
            let toolArgs: any = toolCall.function.arguments;

            if (!tool) {
              result = `Error: Tool '${toolCall.function.name}' not found in registry.`;
            } else {
              let parsingFailed = false;
              if (typeof toolArgs === "string" && toolArgs.trim() !== "") {
                try {
                  toolArgs = JSON.parse(toolArgs);
                } catch (err: any) {
                  result = `Error: Failed to parse tool arguments for '${tool.name}' as valid JSON. Raw arguments: ${toolCall.function.arguments}. Details: ${err.message}. Please retry with valid JSON arguments.`;
                  parsingFailed = true;
                }
              }

              if (!parsingFailed) {
                if (this.isSubAgent && tool.isMutating) {
                  result = `Error: Sub-agents are restricted from running mutating tools.`;
                } else {
                  // Check permissions (via PolicyEngine guardrails if provided, otherwise PermissionGate)
                  const approved = await this.checkToolPermission(tool, toolArgs);

                  if (!approved) {
                    result = `Error: Permission denied by user for executing '${tool.name}'.`;
                  } else {
                    try {
                      result = await tool.run(toolArgs);
                      if (
                        (tool.name === "write_file" || tool.name === "edit_file") &&
                        toolArgs.path &&
                        !result.startsWith("Error:")
                      ) {
                        const resolvedPath = path.resolve(toolArgs.path);
                        const relPath = this.cwd ? path.relative(this.cwd, resolvedPath) : path.relative(process.cwd(), resolvedPath);
                        this.filesChanged.add(relPath.replace(/\\/g, "/"));

                        const invalidatedCount = this.contextManager.invalidateStaleReads(
                          toolArgs.path
                        );
                        if (invalidatedCount > 0 && events.onStaleReadInvalidated) {
                          events.onStaleReadInvalidated(toolArgs.path);
                        }
                      }
                    } catch (err: any) {
                      result = `Error executing tool: ${err.message}`;
                    }
                  }
                }
              }
            }

            if (events.onToolResult) {
              events.onToolResult(toolCall, result);
            }

            // Append the tool result back into history
            this.contextManager.addMessage({
              role: "tool",
              name: toolCall.function.name,
              tool_call_id: toolCall.id,
              content: result
            });

            const { shouldAbort } = await this.handleToolResultRecovery(
              toolCall.function.name,
              toolArgs,
              result,
              events
            );
            if (shouldAbort) {
              keepLooping = false;
              break;
            }
          }
        } else {
          // Parallel logic
          // 1. Prepare and check permissions sequentially (to avoid interleaved prompts)
          const preparedCalls = [];
          for (const toolCall of toolCalls) {
            if (events.onToolCall) {
              events.onToolCall(toolCall);
            }

            const tool = getToolByName(toolCall.function.name);
            if (!tool) {
              preparedCalls.push({
                toolCall,
                errorResult: `Error: Tool '${toolCall.function.name}' not found in registry.`
              });
              continue;
            }

            let toolArgs = toolCall.function.arguments;
            let parsingFailed = false;
            if (typeof toolArgs === "string" && toolArgs.trim() !== "") {
              try {
                toolArgs = JSON.parse(toolArgs);
              } catch (err: any) {
                preparedCalls.push({
                  toolCall,
                  errorResult: `Error: Failed to parse tool arguments for '${tool.name}' as valid JSON. Raw arguments: ${toolCall.function.arguments}. Details: ${err.message}. Please retry with valid JSON arguments.`
                });
                parsingFailed = true;
              }
            }

            if (parsingFailed) {
              continue;
            }

            if (this.isSubAgent && tool.isMutating) {
              preparedCalls.push({
                toolCall,
                errorResult: `Error: Sub-agents are restricted from running mutating tools.`
              });
              continue;
            }

            // Check permissions sequentially (via PolicyEngine guardrails if provided, otherwise PermissionGate)
            const approved = await this.checkToolPermission(tool, toolArgs);

            if (!approved) {
              preparedCalls.push({
                toolCall,
                errorResult: `Error: Permission denied by user for executing '${tool.name}'.`
              });
              continue;
            }

            // Approved and ready to run
            preparedCalls.push({
              toolCall,
              tool,
              toolArgs
            });
          }

          // 2. Run approved tools in parallel
          const results = await Promise.all(
            preparedCalls.map(async (item) => {
              if (item.errorResult !== undefined) {
                return { toolCall: item.toolCall, result: item.errorResult };
              }

              const { toolCall, tool, toolArgs } = item;
              let result = "";
              try {
                result = await tool.run(toolArgs);
                if (
                  (tool.name === "write_file" || tool.name === "edit_file") &&
                  toolArgs.path &&
                  !result.startsWith("Error:")
                ) {
                  const resolvedPath = path.resolve(toolArgs.path);
                  const relPath = this.cwd ? path.relative(this.cwd, resolvedPath) : path.relative(process.cwd(), resolvedPath);
                  this.filesChanged.add(relPath.replace(/\\/g, "/"));

                  const invalidatedCount = this.contextManager.invalidateStaleReads(
                    toolArgs.path
                  );
                  if (invalidatedCount > 0 && events.onStaleReadInvalidated) {
                    events.onStaleReadInvalidated(toolArgs.path);
                  }
                }
              } catch (err: any) {
                result = `Error executing tool: ${err.message}`;
              }

              return { toolCall, result };
            })
          );

          // 3. Process results sequentially (callbacks and adding messages in original order)
          for (const item of results) {
            if (events.onToolResult) {
              events.onToolResult(item.toolCall, item.result);
            }
            this.contextManager.addMessage({
              role: "tool",
              name: item.toolCall.function.name,
              tool_call_id: item.toolCall.id,
              content: item.result
            });

            let callArgs: any = item.toolCall.function.arguments;
            if (typeof callArgs === "string" && callArgs.trim() !== "") {
              try {
                callArgs = JSON.parse(callArgs);
              } catch {}
            }

            const { shouldAbort } = await this.handleToolResultRecovery(
              item.toolCall.function.name,
              callArgs,
              item.result,
              events
            );
            if (shouldAbort) {
              keepLooping = false;
              break;
            }
          }
        }
      }

      // After completing the turns, check if compaction is needed
      const summaryText = await this.contextManager.compactIfNeeded();
      if (summaryText && events.onCompaction) {
        events.onCompaction(summaryText);
      }

      return finalAssistantText;
    } finally {
      this.isRunning = false;
    }
  }
}
