import { expect, test, describe } from "bun:test";
import { Agent } from "../agent";
import { ChatModelClient, Message } from "../client";

class MockClient implements ChatModelClient {
  public model = "mock-model";
  public calls = 0;

  async chatStream(
    messages: Message[],
    tools: any[],
    onChunk: any
  ): Promise<Message> {
    this.calls++;
    if (this.calls === 1) {
      return {
        role: "assistant",
        content: "Calling tools",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "todo_read",
              arguments: {}
            }
          },
          {
            id: "call_2",
            function: {
              name: "todo_read",
              arguments: {}
            }
          }
        ]
      };
    } else {
      // Second turn, no tool calls to stop the loop
      return {
        role: "assistant",
        content: "Done calling tools"
      };
    }
  }
}

describe("Agent Tool Execution Modes", () => {
  test("runs tools in sequential mode", async () => {
    const client = new MockClient();
    const agent = new Agent({
      client,
      toolExecutionMode: "sequential"
    });

    const toolCallsSeen: string[] = [];
    const toolResultsSeen: string[] = [];

    await agent.run("Hello", {
      onToolCall: (tc) => {
        toolCallsSeen.push(tc.id);
      },
      onToolResult: (tc, res) => {
        toolResultsSeen.push(tc.id);
      }
    });

    expect(toolCallsSeen).toEqual(["call_1", "call_2"]);
    expect(toolResultsSeen).toEqual(["call_1", "call_2"]);
    expect(agent.getToolExecutionMode()).toBe("sequential");
  });

  test("runs tools in parallel mode", async () => {
    const client = new MockClient();
    const agent = new Agent({
      client,
      toolExecutionMode: "parallel"
    });

    const toolCallsSeen: string[] = [];
    const toolResultsSeen: string[] = [];

    await agent.run("Hello", {
      onToolCall: (tc) => {
        toolCallsSeen.push(tc.id);
      },
      onToolResult: (tc, res) => {
        toolResultsSeen.push(tc.id);
      }
    });

    expect(toolCallsSeen).toEqual(["call_1", "call_2"]);
    expect(toolResultsSeen).toEqual(["call_1", "call_2"]);
    expect(agent.getToolExecutionMode()).toBe("parallel");
  });
});
