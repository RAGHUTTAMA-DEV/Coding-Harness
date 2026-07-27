import { expect, test, describe, afterEach } from "bun:test";
import { GeminiClient } from "./gemini";
import { Message } from "./types";

describe("GeminiClient thought_signature handling", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("formats thought_signature in messages", async () => {
    const client = new GeminiClient({ apiKey: "test-api-key" });

    // Mock fetch to return a dummy response
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(init?.body as string);
      
      // Verify that the formatted message history contains thought_signature
      const assistantMsg = body.contents.find((c: any) => c.role === "model");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.parts).toContainEqual({ thought_signature: "test-signature-123" });

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Response text" },
                  { thought_signature: "response-signature-456" }
                ],
                role: "model"
              }
            }
          ]
        }),
        { status: 200 }
      );
    };

    global.fetch = mockFetch as any;

    const messages: Message[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Hello",
        tool_calls: [
          {
            id: "call_1",
            function: { name: "glob", arguments: {} }
          }
        ],
        thought_signature: "test-signature-123"
      }
    ];

    const result = await client.chatStream(messages, [], () => {});
    expect(result.content).toBe("Response text");
    expect(result.thought_signature).toBe("response-signature-456");
  });
});
