import { expect, test, describe } from "bun:test";
import { ContextManager } from "../context/contextManager";
import { Message, OllamaClient } from "../client";
import { microcompact, summarizeHistory } from "../context/compaction";

class MockOllamaClient extends OllamaClient {
  public mockResponse: string = "This is a summary of the conversation.";

  constructor() {
    super("http://dummy", "dummy-model");
  }

  override async chatStream(
    messages: Message[],
    tools: any[],
    onChunk: any
  ): Promise<Message> {
    return {
      role: "assistant",
      content: this.mockResponse,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      }
    };
  }
}

describe("Context Management Tests", () => {
  test("File staleness invalidates previous read results for the same path", () => {
    const client = new MockOllamaClient();
    const manager = new ContextManager({
      client,
      systemPrompt: "System Prompt",
      projectMemory: "Project Memory"
    });

    // Add assistant call and tool result for reading file A
    manager.addMessage({
      role: "assistant",
      content: "Let's read file A",
      tool_calls: [
        {
          id: "call_a1",
          function: {
            name: "read_file",
            arguments: { path: "src/agent.ts" }
          }
        }
      ]
    });
    manager.addMessage({
      role: "tool",
      name: "read_file",
      tool_call_id: "call_a1",
      content: "Line 1: code\nLine 2: code"
    });

    // Add assistant call and tool result for reading file B
    manager.addMessage({
      role: "assistant",
      content: "Let's read file B",
      tool_calls: [
        {
          id: "call_b1",
          function: {
            name: "read_file",
            arguments: { path: "src/client.ts" }
          }
        }
      ]
    });
    manager.addMessage({
      role: "tool",
      name: "read_file",
      tool_call_id: "call_b1",
      content: "Line 1: client code\nLine 2: client code"
    });

    // Perform mutation on file A
    const invalidatedCount = manager.invalidateStaleReads("src/agent.ts");
    expect(invalidatedCount).toBe(1);

    const history = manager.getHistory();
    // File A should be tombstoned
    expect(history[1].content).toContain("has been modified by a subsequent edit/write tool call");
    // File B should remain untouched
    expect(history[3].content).toContain("client code");
  });

  test("Microcompaction collapses duplicate tool calls with same arguments", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "Run test command",
        tool_calls: [
          {
            id: "run_1",
            function: {
              name: "run_command",
              arguments: { command: "bun test" }
            }
          }
        ]
      },
      {
        role: "tool",
        name: "run_command",
        tool_call_id: "run_1",
        content: "Tests failed"
      },
      {
        role: "user",
        content: "Fixing tests"
      },
      {
        role: "assistant",
        content: "Run test command again",
        tool_calls: [
          {
            id: "run_2",
            function: {
              name: "run_command",
              arguments: { command: "bun test" }
            }
          }
        ]
      },
      {
        role: "tool",
        name: "run_command",
        tool_call_id: "run_2",
        content: "Tests passed"
      }
    ];

    const compacted = microcompact(messages);
    expect(compacted[1].content).toContain("superseded by a later call");
    expect(compacted[4].content).toBe("Tests passed");
  });

  test("Summarization compaction folds the first 50% of history", async () => {
    const client = new MockOllamaClient();
    client.mockResponse = "Summarized half of history.";

    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "how are you" },
      { role: "assistant", content: "doing great" }
    ];

    const result = await summarizeHistory(messages, client);
    expect(result.messages.length).toBe(3); // 1 summary system message + 2 remaining messages
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("Summarized half of history.");
    expect(result.messages[1].content).toBe("how are you");
    expect(result.messages[2].content).toBe("doing great");
  });

  test("ContextManager compactIfNeeded runs both microcompaction and triggers summarization above threshold", async () => {
    const client = new MockOllamaClient();
    client.mockResponse = "Auto summary.";

    // Low threshold to force summarization compaction
    const manager = new ContextManager({
      client,
      systemPrompt: "System",
      tokenThreshold: 50 // Threshold is 50 tokens
    });

    // 1. Add messages
    manager.addMessage({ role: "user", content: "a" });
    manager.addMessage({ role: "assistant", content: "b" });
    manager.addMessage({ role: "user", content: "c" });
    
    const assistantMsg: Message = {
      role: "assistant",
      content: "d",
      usage: {
        prompt_tokens: 40,
        completion_tokens: 20,
        total_tokens: 60 // 60 > 50 threshold
      }
    };
    manager.addMessage(assistantMsg);
    manager.updateTokens(assistantMsg);

    expect(manager.getTotalTokens()).toBe(60);

    const summary = await manager.compactIfNeeded();
    expect(summary).toBe("Auto summary.");

    const history = manager.getHistory();
    expect(history.length).toBe(3); // summary + remaining 2 messages
    expect(history[0].content).toContain("Auto summary.");
  });

  test("Summarization compaction does not split tool call blocks", async () => {
    const client = new MockOllamaClient();
    client.mockResponse = "Summarized part.";

    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "let's do something" },
      {
        role: "assistant",
        content: "calling tool",
        tool_calls: [{ id: "t1", function: { name: "test_tool", arguments: {} } }]
      },
      { role: "tool", name: "test_tool", tool_call_id: "t1", content: "result part 1" },
      { role: "tool", name: "test_tool", tool_call_id: "t1", content: "result part 2" },
      { role: "user", content: "thanks" }
    ];

    const result = await summarizeHistory(messages, client);
    
    // Verify that the resulting payload has valid sequence: every tool message must be preceded by an assistant or another tool message
    for (let i = 0; i < result.messages.length; i++) {
      if (result.messages[i].role === "tool") {
        const prevRole = result.messages[i - 1].role;
        expect(prevRole === "assistant" || prevRole === "tool").toBe(true);
      }
    }
  });
});
