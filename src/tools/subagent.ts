import { Tool } from "./types";
import { activeClient } from "./activeClient";

export const subAgentTool: Tool = {
  name: "dispatch_subagent",
  description: "Spin up an isolated sub-agent context for a narrow research, search, or code-exploration task. This sub-agent is read-only, has no mutation permissions, and runs in the background. It returns the final answer or summary of its research.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The specific query, question, or research task for the sub-agent to answer."
      }
    },
    required: ["query"]
  },
  isMutating: false,
  async run(args: { query: string }): Promise<string> {
    if (!activeClient) {
      return "Error: No active chat model client is set in the harness.";
    }

    try {
      // Dynamic import to break circular dependency: Agent -> tools/index -> subagent -> Agent
      const { Agent } = await import("../agent");

      // Spawn a new Agent as a sub-agent with isSubAgent: true
      const subAgent = new Agent({
        client: activeClient,
        isSubAgent: true
      });

      console.log(`\n\x1b[90m┌─── [Sub-agent Spawned] ───────────────────────────────────────────┐\x1b[0m`);
      console.log(`\x1b[90m│ Query: \x1b[36m${args.query}\x1b[90m\x1b[0m`);
      console.log(`\x1b[90m└───────────────────────────────────────────────────────────────────┘\x1b[0m`);

      const response = await subAgent.run(args.query, {
        onToolCall: (toolCall) => {
          console.log(`\x1b[90m[Sub-agent] Researching via tool: \x1b[1m\x1b[36m${toolCall.function.name}\x1b[0m...`);
        },
        onToolResult: (toolCall, result) => {
          console.log(`\x1b[90m[Sub-agent] Tool \x1b[32m${toolCall.function.name}\x1b[90m returned ${result.length} characters.\x1b[0m`);
        }
      });

      console.log(`\x1b[90m┌─── [Sub-agent Completed] ─────────────────────────────────────────┐\x1b[0m`);
      console.log(`\x1b[90m│ Findings returned successfully.\x1b[0m`);
      console.log(`\x1b[90m└───────────────────────────────────────────────────────────────────┘\x1b[0m\n`);

      return response;
    } catch (err: any) {
      return `Error executing sub-agent: ${err.message}`;
    }
  }
};
