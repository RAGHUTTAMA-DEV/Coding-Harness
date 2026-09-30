import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { McpServerRegistry } from "../mcp/serverRegistry";
import { McpClient } from "../mcp/client";
import { McpToolAdapter } from "../mcp/toolAdapter";
import { McpManager } from "../mcp/manager";
import { MCPToolDefinition } from "../mcp/types";
import { PolicyEngine } from "../guardrails/policyEngine";
import { getToolByName, getToolDefinitions, resetToolsToBuiltin, tools } from "../tools";
import { Agent } from "../agent";
import { ChatModelClient, Message, StreamChunk } from "../client";

// Mock LLM client for agent loop integration test
class MockLLMClient implements ChatModelClient {
  private responses: string[] = [];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  setResponses(responses: string[]) {
    this.responses = [...responses];
  }

  async chatStream(
    messages: Message[],
    tools: any[],
    onChunk: (chunk: { content: string; thinking: string; toolCalls: any[] }) => void
  ): Promise<Message> {
    const next = this.responses.shift() || "Done";
    if (next.startsWith("TOOL:")) {
      const toolCallJson = JSON.parse(next.slice(5));
      onChunk({
        content: "",
        thinking: "",
        toolCalls: [toolCallJson]
      });
      return {
        role: "assistant",
        content: "",
        tool_calls: [toolCallJson]
      };
    } else {
      onChunk({
        content: next,
        thinking: "",
        toolCalls: []
      });
      return {
        role: "assistant",
        content: next
      };
    }
  }

  async getCompletion(prompt: string): Promise<string> {
    return "Summary";
  }
}

describe("MCP Client Subsystem Tests", () => {
  let tempDir: string;
  let mockServerScript: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));

    // Create a mock MCP stdio server in JavaScript for Bun
    mockServerScript = path.join(tempDir, "mock_server.js");
    const serverCode = `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "MockServer", version: "1.0.0" }
        }
      }) + "\\n");
    } else if (msg.method === "notifications/initialized") {
      // Notification, no reply needed
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: "add_numbers",
              description: "Adds two numbers together",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number" },
                  b: { type: "number" }
                },
                required: ["a", "b"]
              }
            },
            {
              name: "echo_message",
              description: "Echoes a text message",
              inputSchema: {
                type: "object",
                properties: {
                  message: { type: "string" }
                },
                required: ["message"]
              }
            }
          ]
        }
      }) + "\\n");
    } else if (msg.method === "tools/call") {
      const { name, arguments: args } = msg.params;
      if (name === "add_numbers") {
        const sum = (args.a || 0) + (args.b || 0);
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: String(sum) }],
            isError: false
          }
        }) + "\\n");
      } else if (name === "echo_message") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: "Echo: " + (args.message || "") }],
            isError: false
          }
        }) + "\\n");
      } else {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "Method not found: " + name }
        }) + "\\n");
      }
    }
  } catch (err) {}
});
`;
    fs.writeFileSync(mockServerScript, serverCode, "utf-8");
  });

  afterEach(() => {
    resetToolsToBuiltin();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("McpServerRegistry", () => {
    it("registers, retrieves, and unregisters servers", () => {
      const registry = new McpServerRegistry();
      registry.registerServer({
        id: "server1",
        command: "bun",
        args: ["run", "test.ts"]
      });

      expect(registry.getServer("server1")).toBeDefined();
      expect(registry.getServer("server1")?.command).toBe("bun");
      expect(registry.getAllServers().length).toBe(1);

      const removed = registry.unregisterServer("server1");
      expect(removed).toBe(true);
      expect(registry.getServer("server1")).toBeUndefined();
    });

    it("saves to and loads from standard mcp JSON format", () => {
      const configPath = path.join(tempDir, ".mcp.json");
      const registry = new McpServerRegistry([], configPath);

      registry.registerServer({
        id: "calc-server",
        command: "bun",
        args: ["run", "calc.ts"],
        timeoutMs: 15000
      });

      registry.saveToFile();
      expect(fs.existsSync(configPath)).toBe(true);

      const newRegistry = new McpServerRegistry([], configPath);
      newRegistry.loadFromFile();
      const server = newRegistry.getServer("calc-server");

      expect(server).toBeDefined();
      expect(server?.command).toBe("bun");
      expect(server?.timeoutMs).toBe(15000);
    });

    it("manages server enabled/disabled states", () => {
      const registry = new McpServerRegistry();
      registry.registerServer({ id: "s1", command: "bun" });
      registry.registerServer({ id: "s2", command: "bun", disabled: true });

      expect(registry.getEnabledServers().length).toBe(1);
      expect(registry.getEnabledServers()[0].id).toBe("s1");

      registry.setServerEnabled("s2", true);
      expect(registry.getEnabledServers().length).toBe(2);
    });
  });

  describe("McpToolAdapter", () => {
    const dummyClient = {
      config: { id: "test_srv" },
      callTool: async (name: string, args: any) => {
        return {
          content: [{ type: "text", text: `Executed ${name} with ${JSON.stringify(args)}` }],
          isError: false
        };
      }
    } as any;

    const mockToolDef: MCPToolDefinition = {
      name: "calculate_tax",
      description: "Calculates tax based on amount and rate",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number" },
          rate: { type: "number" }
        },
        required: ["amount", "rate"]
      }
    };

    it("adapts MCP tool definition to native harness Tool", () => {
      const adapted = McpToolAdapter.adaptTool(mockToolDef, dummyClient);

      expect(adapted.name).toBe("mcp_test_srv_calculate_tax");
      expect(adapted.description).toContain("Calculates tax");
      expect(adapted.input_schema.properties.amount).toBeDefined();
      expect(adapted.input_schema.required).toEqual(["amount", "rate"]);
    });

    it("validates required schema parameters before calling MCP server", async () => {
      const adapted = McpToolAdapter.adaptTool(mockToolDef, dummyClient);

      // Missing 'rate' parameter
      const result = await adapted.run({ amount: 100 });
      expect(result).toContain("Error: Invalid arguments");
      expect(result).toContain("Missing required parameter 'rate'");
    });

    it("validates parameter types according to schema", async () => {
      const adapted = McpToolAdapter.adaptTool(mockToolDef, dummyClient);

      // Amount passed as string instead of number
      const result = await adapted.run({ amount: "invalid", rate: 0.1 });
      expect(result).toContain("Error: Invalid arguments");
      expect(result).toContain("expected number, received string");
    });

    it("intercepts guardrail violations when policy engine is attached", async () => {
      const policyEngine = new PolicyEngine();
      const adapted = McpToolAdapter.adaptTool(
        {
          name: "write_secret_file",
          description: "Writes a file",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" }
            },
            required: ["path", "content"]
          }
        },
        dummyClient,
        {
          policyEngine,
          getGuardrailContext: () => ({ workspaceDir: tempDir, autoConfirm: false })
        }
      );

      // Attempting to write into a sensitive .env file must be blocked by PathPolicy
      const result = await adapted.run({
        path: ".env",
        content: "API_KEY=123"
      });

      expect(result).toContain("Error: Guardrail Blocked");
      expect(result).toContain("pathPolicy");
    });
  });

  describe("McpClient (Stdio Transport)", () => {
    it("connects, handshakes, discovers tools, and calls tools over stdio", async () => {
      const client = new McpClient({
        id: "mock",
        command: "bun",
        args: [mockServerScript]
      });

      await client.connect();
      expect(client.getState()).toBe("CONNECTED");
      expect(client.getServerInfo()?.name).toBe("MockServer");
      expect(client.getProtocolVersion()).toBe("2024-11-05");

      // List tools
      const toolDefs = await client.listTools();
      expect(toolDefs.length).toBe(2);
      expect(toolDefs.map((t) => t.name)).toContain("add_numbers");
      expect(toolDefs.map((t) => t.name)).toContain("echo_message");

      // Call tool
      const addResult = await client.callTool("add_numbers", { a: 15, b: 27 });
      expect(addResult.content[0].text).toBe("42");

      const echoResult = await client.callTool("echo_message", { message: "Antigravity Harness" });
      expect(echoResult.content[0].text).toBe("Echo: Antigravity Harness");

      // Disconnect
      await client.disconnect();
      expect(client.getState()).toBe("DISCONNECTED");
    });

    it("handles request timeouts gracefully", async () => {
      // Create a hanging server that never responds to tools/call
      const hangingServer = path.join(tempDir, "hanging_server.js");
      fs.writeFileSync(
        hangingServer,
        `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "Hanging" } }
    }) + "\\n");
  }
  // Ignore all other requests (causing timeout)
});
`,
        "utf-8"
      );

      const client = new McpClient({
        id: "hanging",
        command: "bun",
        args: [hangingServer],
        timeoutMs: 100 // 100ms timeout
      });

      await client.connect();
      let timedOut = false;
      try {
        await client.listTools();
      } catch (err: any) {
        timedOut = err.message.includes("timed out");
      }

      expect(timedOut).toBe(true);
      await client.disconnect();
    });

    it("reconnects to the server successfully", async () => {
      const client = new McpClient({
        id: "mock",
        command: "bun",
        args: [mockServerScript]
      });

      await client.connect();
      expect(client.getState()).toBe("CONNECTED");

      await client.reconnect();
      expect(client.getState()).toBe("CONNECTED");

      const tools = await client.listTools();
      expect(tools.length).toBe(2);

      await client.disconnect();
    });
  });

  describe("McpManager Coordination", () => {
    it("coordinates multiple servers, discovers tools, and registers with harness", async () => {
      const registry = new McpServerRegistry();
      registry.registerServer({
        id: "math_service",
        command: "bun",
        args: [mockServerScript]
      });

      const manager = new McpManager({ registry });
      const { connected, failed } = await manager.connectAll();

      expect(connected).toEqual(["math_service"]);
      expect(failed.length).toBe(0);

      // Discover and register tools
      const discovered = await manager.discoverAllTools();
      expect(discovered.length).toBe(2);

      manager.registerToolsWithHarness();

      // Verify harness tool registry now contains adapted MCP tools
      const harnessAddTool = getToolByName("mcp_math_service_add_numbers");
      expect(harnessAddTool).toBeDefined();

      const defs = getToolDefinitions();
      expect(defs.some((d) => d.name === "mcp_math_service_add_numbers")).toBe(true);

      // Execute through harness tool interface
      const sumOutput = await harnessAddTool!.run({ a: 100, b: 250 });
      expect(sumOutput).toBe("350");

      // Verify status report
      const status = manager.getStatus();
      expect(status[0].id).toBe("math_service");
      expect(status[0].state).toBe("CONNECTED");
      expect(status[0].toolCount).toBe(2);

      await manager.disconnectAll();
    });
  });

  describe("Agent MCP Integration & Guardrails", () => {
    it("allows Agent to invoke discovered MCP tool and record results", async () => {
      const registry = new McpServerRegistry();
      registry.registerServer({
        id: "math_service",
        command: "bun",
        args: [mockServerScript]
      });

      const manager = new McpManager({ registry });
      await manager.connectAll();
      await manager.discoverAllTools();

      // Configure mock LLM client to call the MCP tool
      const mockLLM = new MockLLMClient([
        "TOOL:" +
          JSON.stringify({
            id: "call-1",
            type: "function",
            function: {
              name: "mcp_math_service_add_numbers",
              arguments: JSON.stringify({ a: 40, b: 2 })
            }
          }),
        "The calculated sum is 42."
      ]);

      const policyEngine = new PolicyEngine();
      const agent = new Agent({
        client: mockLLM,
        cwd: tempDir,
        autoConfirm: true,
        policyEngine,
        mcpManager: manager
      });

      const response = await agent.run("Please add 40 and 2 using the math tool.");
      expect(response).toBe("The calculated sum is 42.");

      // Verify history contains tool result
      const history = agent.getHistory();
      const toolMsg = history.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content).toBe("42");

      await manager.disconnectAll();
    });
  });
});
