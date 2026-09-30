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

export interface AgentEvents {
  onTextChunk?: (text: string) => void;
  onThinkingChunk?: (text: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCall: ToolCall, result: string) => void;
  onCompaction?: (summary: string) => void;
  onStaleReadInvalidated?: (filePath: string) => void;
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

    if (this.mcpManager) {
      this.mcpManager.registerToolsWithHarness();
    }

    if (options.cwd) {
      this.cwd = path.resolve(options.cwd);
      process.chdir(this.cwd);
    } else {
      this.cwd = process.cwd();
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
    try {
      // Add user message to history
      this.contextManager.addMessage({
        role: "user",
        content: userInput
      });

      let keepLooping = true;
      let finalAssistantText = "";
      let iterations = 0;

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
          // No tool calls, we are done
          keepLooping = false;
          break;
        }

        // Execute all tool calls
        if (this.toolExecutionMode === "sequential") {
          for (const toolCall of toolCalls) {
            if (events.onToolCall) {
              events.onToolCall(toolCall);
            }

            const tool = getToolByName(toolCall.function.name);
            let result = "";

            if (!tool) {
              result = `Error: Tool '${toolCall.function.name}' not found in registry.`;
            } else {
              let toolArgs = toolCall.function.arguments;
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
