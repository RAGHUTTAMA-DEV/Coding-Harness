import { McpServerRegistry } from "./serverRegistry";
import { McpClient } from "./client";
import { McpToolAdapter } from "./toolAdapter";
import { Tool } from "../tools/types";
import { PolicyEngine } from "../guardrails/policyEngine";
import { GuardrailContext } from "../guardrails/types";
import { registerTool, unregisterTool } from "../tools";

export interface McpManagerOptions {
  registry?: McpServerRegistry;
  policyEngine?: PolicyEngine;
  getGuardrailContext?: () => GuardrailContext;
}

export class McpManager {
  private registry: McpServerRegistry;
  private clients: Map<string, McpClient> = new Map();
  private discoveredTools: Map<string, Tool> = new Map(); // toolName -> Tool
  private serverToolsMap: Map<string, string[]> = new Map(); // serverId -> toolNames[]
  private policyEngine?: PolicyEngine;
  private getGuardrailContext?: () => GuardrailContext;

  constructor(options: McpManagerOptions = {}) {
    this.registry = options.registry || new McpServerRegistry();
    this.policyEngine = options.policyEngine;
    this.getGuardrailContext = options.getGuardrailContext;
  }

  getRegistry(): McpServerRegistry {
    return this.registry;
  }

  getClient(serverId: string): McpClient | undefined {
    return this.clients.get(serverId);
  }

  getConnectedClients(): Map<string, McpClient> {
    const connected = new Map<string, McpClient>();
    for (const [id, client] of this.clients.entries()) {
      if (client.getState() === "CONNECTED") {
        connected.set(id, client);
      }
    }
    return connected;
  }

  setGuardrails(policyEngine: PolicyEngine, getContext: () => GuardrailContext): void {
    this.policyEngine = policyEngine;
    this.getGuardrailContext = getContext;
  }

  /**
   * Connect to a specific registered server by ID.
   */
  async connectServer(serverId: string): Promise<McpClient> {
    const config = this.registry.getServer(serverId);
    if (!config) {
      throw new Error(`MCP server '${serverId}' is not registered.`);
    }

    const existingClient = this.clients.get(serverId);
    if (existingClient && existingClient.getState() === "CONNECTED") {
      return existingClient;
    }

    const client = new McpClient(config);
    this.clients.set(serverId, client);
    await client.connect();
    return client;
  }

  /**
   * Disconnect a specific server and remove its discovered tools.
   */
  async disconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
    }

    // Clean up discovered tools for this server
    const toolNames = this.serverToolsMap.get(serverId) || [];
    for (const name of toolNames) {
      this.discoveredTools.delete(name);
      unregisterTool(name);
    }
    this.serverToolsMap.delete(serverId);
  }

  /**
   * Connect to all enabled servers in the registry.
   */
  async connectAll(): Promise<{
    connected: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const enabledServers = this.registry.getEnabledServers();
    const connected: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const server of enabledServers) {
      try {
        await this.connectServer(server.id);
        connected.push(server.id);
      } catch (err: any) {
        failed.push({ id: server.id, error: err.message });
      }
    }

    return { connected, failed };
  }

  /**
   * Disconnect from all connected servers.
   */
  async disconnectAll(): Promise<void> {
    for (const serverId of Array.from(this.clients.keys())) {
      await this.disconnectServer(serverId);
    }
  }

  /**
   * Discover tools from a single connected server, adapt them, and register them.
   */
  async discoverTools(serverId: string): Promise<Tool[]> {
    const client = this.clients.get(serverId);
    if (!client || client.getState() !== "CONNECTED") {
      throw new Error(`Cannot discover tools: MCP server '${serverId}' is not connected.`);
    }

    const mcpTools = await client.listTools();
    const adaptedTools: Tool[] = [];
    const toolNames: string[] = [];

    for (const mcpTool of mcpTools) {
      const tool = McpToolAdapter.adaptTool(mcpTool, client, {
        policyEngine: this.policyEngine,
        getGuardrailContext: this.getGuardrailContext
      });

      this.discoveredTools.set(tool.name, tool);
      toolNames.push(tool.name);
      adaptedTools.push(tool);
    }

    this.serverToolsMap.set(serverId, toolNames);
    return adaptedTools;
  }

  /**
   * Discover tools from all currently connected servers.
   */
  async discoverAllTools(): Promise<Tool[]> {
    const allTools: Tool[] = [];
    for (const serverId of this.clients.keys()) {
      const tools = await this.discoverTools(serverId);
      allTools.push(...tools);
    }
    return allTools;
  }

  /**
   * Register all currently discovered tools into the harness global tool registry.
   */
  registerToolsWithHarness(): Tool[] {
    const tools = Array.from(this.discoveredTools.values());
    for (const tool of tools) {
      registerTool(tool);
    }
    return tools;
  }

  /**
   * Retrieve all currently discovered tools.
   */
  getAllDiscoveredTools(): Tool[] {
    return Array.from(this.discoveredTools.values());
  }

  /**
   * Get an overview of all servers and their connection/tool status.
   */
  getStatus(): Array<{
    id: string;
    name?: string;
    state: string;
    toolCount: number;
    command: string;
  }> {
    const servers = this.registry.getAllServers();
    return servers.map((config) => {
      const client = this.clients.get(config.id);
      const state = client ? client.getState() : config.disabled ? "DISABLED" : "DISCONNECTED";
      const tools = this.serverToolsMap.get(config.id) || [];
      return {
        id: config.id,
        name: config.name,
        state,
        toolCount: tools.length,
        command: `${config.command} ${(config.args || []).join(" ")}`.trim()
      };
    });
  }
}
