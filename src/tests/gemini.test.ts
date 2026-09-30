import { expect, test, describe, afterEach } from "bun:test";
import { GeminiClient } from "../providers/gemini";
import { Message } from "../providers/types";

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
      const hasSignature = assistantMsg.parts.some((p: any) => p.thought_signature === "test-signature-123");
      expect(hasSignature).toBe(true);

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

  test("sanitizes MCP tool schema by stripping x-mcp-header and unsupported properties", async () => {
    const client = new GeminiClient({ apiKey: "test-api-key" });

    let capturedRequestBody: any = null;
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedRequestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Done" }] },
              role: "model"
            }
          ]
        }),
        { status: 200 }
      );
    };

    global.fetch = mockFetch as any;

    const mcpTool = {
      name: "mcp_github_create_or_update_file",
      description: "Create or update file",
      input_schema: {
        type: "object",
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        properties: {
          owner: {
            type: "string",
            description: "Repository owner",
            "x-mcp-header": true
          },
          path: {
            type: ["string", "null"],
            description: "File path"
          }
        },
        required: ["owner"]
      }
    };

    await client.chatStream([{ role: "user", content: "test" }], [mcpTool], () => {});

    expect(capturedRequestBody).toBeDefined();
    const declaration = capturedRequestBody.tools[0].functionDeclarations[0];
    expect(declaration.name).toBe("mcp_github_create_or_update_file");
    expect(declaration.parameters.properties.owner["x-mcp-header"]).toBeUndefined();
    expect(declaration.parameters.$schema).toBeUndefined();
    expect(declaration.parameters.additionalProperties).toBeUndefined();
    expect(declaration.parameters.properties.owner.type).toBe("string");
    expect(declaration.parameters.properties.path.nullable).toBe(true);
  });
});

