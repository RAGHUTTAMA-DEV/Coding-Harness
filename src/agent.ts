import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ChatModelClient, Message, ToolCall } from "./client";
import { getToolByName, getToolDefinitions } from "./tools";
import { PermissionGate } from "./permissions/permissionGate";
import { ContextManager } from "./context/contextManager";

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

  constructor(options: {
    client: ChatModelClient;
    rl?: readline.Interface;
    systemPrompt?: string;
    tokenThreshold?: number;
  }) {
    this.client = options.client;
    this.rl = options.rl;
    
    // Set a solid default system prompt if none is provided
    this.systemPrompt = options.systemPrompt || `You are an advanced agentic coding assistant called Antigravity.
You are running on the user's host machine.
Current Working Directory: ${process.cwd()}
Platform: ${process.platform}

You have access to tools: 'read_file', 'write_file', 'edit_file', 'run_command', 'check_syntax', 'glob', 'grep', 'todo_read', and 'todo_write'.
- Use 'read_file' to view file contents.
- Use 'write_file' to create or completely overwrite files.
- Use 'edit_file' to apply targeted find-and-replace changes. Optionally use startLine and endLine for line-targeted range editing, with sliding-window drift recovery. Prefer 'edit_file' over 'write_file' when editing existing code.
- Use 'run_command' to run shell commands (compiling, running tests, installing packages, etc.).
- Use 'check_syntax' to verify a JS/TS file's syntax or compilation errors. Always run this tool after editing or writing a JavaScript/TypeScript file to verify its syntax.
- Use 'glob' to list files/directories and search using wildcards. Always check what files exist before guessing their names or trying to read them!
- Use 'grep' to search for substrings or regular expressions across files to locate declarations, usages, or references.
- Use 'todo_read' to read the project's task list (TODOs).
- Use 'todo_write' to update the project's task list (TODOs).

Strict Guidelines:
1. Be direct, professional, and clear. Avoid verbose pleasantries.
2. Systematic Exploration: NEVER guess the layout of the codebase, directory structures, or file names. Always use the 'glob' or 'grep' tools first to discover files, locate directories, and explore the workspace before attempting to read or edit.
3. Plan and Track Tasks: For any multi-step task, start by reading the current TODO checklist using 'todo_read'. If it does not exist, create it with 'todo_write' to list the steps. Keep the checklist updated as you execute tasks.
4. Read Before Editing: Always use 'read_file' on a file before trying to edit it with 'edit_file'. This ensures you know the exact line numbers, code contents, and indentation, avoiding find-and-replace failures.
5. Verify Modifications: Always run 'check_syntax' after writing or editing a JavaScript or TypeScript file. For other files or codebases, run tests or verify builds using 'run_command'.
6. Complete Code: Write fully-functional code. Do not use placeholders, shorthand, or leave sections for the user to implement.
7. Immediate Tool Execution: You MUST call tools in the same turn to execute your planned changes. Never explain what you are about to do in text and stop without outputting the tool call. If you say "Let me make these changes" or "I will write this file", you must output the corresponding tool call in the same response block.
8. Safe Recovery: If a tool call fails, inspect the error output, diagnose the issue, and try an alternative approach.
`;

    // Load AGENT.md if it exists in the workspace
    let projectMemory: string | null = null;
    try {
      const agentMdPath = path.resolve(process.cwd(), "AGENT.md");
      if (fs.existsSync(agentMdPath)) {
        projectMemory = fs.readFileSync(agentMdPath, "utf-8");
      }
    } catch (e) {
      // Ignore reading error
    }

    this.contextManager = new ContextManager({
      client: this.client,
      systemPrompt: this.systemPrompt,
      projectMemory,
      tokenThreshold: options.tokenThreshold
    });
  }

  /**
   * Swap the active model client while preserving the current conversation history.
   */
  setClient(client: ChatModelClient) {
    this.client = client;
    this.contextManager.setClient(client);
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

  getTotalTokens(): number {
    return this.contextManager.getTotalTokens();
  }

  getTokenThreshold(): number {
    return this.contextManager.getTokenThreshold();
  }


  /**
   * Run a single turn of the agent loop
   */
  async run(userInput: string, events: AgentEvents = {}): Promise<string> {
    this.isRunning = true;
    try {
      // Add user message to history
      this.contextManager.addMessage({
        role: "user",
        content: userInput
      });

      let keepLooping = true;
      let finalAssistantText = "";

      while (keepLooping) {
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

        // Build the message payload from context manager
        const payload = this.contextManager.getPayload();

        // Stream the response from the LLM (with retry-on-network-failure)
        let assistantMessage;
        const maxRetries = 3;
        let attempt = 0;
        while (attempt < maxRetries) {
          try {
            assistantMessage = await this.client.chatStream(
              payload,
              getToolDefinitions(),
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

        // Append assistant message to local history and update tokens
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
              // Check permissions if mutating
              let approved = true;
              if (tool.isMutating) {
                approved = await PermissionGate.checkPermission(
                  tool.name,
                  toolArgs,
                  this.rl
                );
              }

              if (!approved) {
                result = `Error: Permission denied by user for executing '${tool.name}'.`;
              } else {
                try {
                  // Run the tool execution
                  result = await tool.run(toolArgs);

                  // Track staleness: if write_file or edit_file succeeded, invalidate earlier reads of this file
                  if (
                    (tool.name === "write_file" || tool.name === "edit_file") &&
                    toolArgs.path &&
                    !result.startsWith("Error:")
                  ) {
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
