import * as fs from "fs";
import * as path from "path";
import { MCPServerConfig } from "./types";

export class McpServerRegistry {
  private servers: Map<string, MCPServerConfig> = new Map();
  private configPath?: string;

  constructor(initialServers: MCPServerConfig[] = [], configPath?: string) {
    for (const server of initialServers) {
      this.registerServer(server);
    }
    this.configPath = configPath;
  }

  /**
   * Register a new server configuration or update existing.
   */
  registerServer(config: MCPServerConfig): void {
    if (!config.id) {
      throw new Error("Server configuration must have an 'id'.");
    }
    if (!config.command) {
      throw new Error(`Server configuration '${config.id}' must specify a 'command'.`);
    }
    this.servers.set(config.id, {
      args: [],
      disabled: false,
      timeoutMs: 30000,
      ...config
    });
  }

  /**
   * Unregister / remove a server configuration by ID.
   */
  unregisterServer(id: string): boolean {
    return this.servers.delete(id);
  }

  /**
   * Get server configuration by ID.
   */
  getServer(id: string): MCPServerConfig | undefined {
    return this.servers.get(id);
  }

  /**
   * Get all registered server configurations.
   */
  getAllServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get all enabled servers.
   */
  getEnabledServers(): MCPServerConfig[] {
    return this.getAllServers().filter((s) => !s.disabled);
  }

  /**
   * Enable or disable a server.
   */
  setServerEnabled(id: string, enabled: boolean): boolean {
    const server = this.servers.get(id);
    if (!server) return false;
    server.disabled = !enabled;
    return true;
  }

  /**
   * Load server configuration from a JSON file.
   * Supports both harness array format and standard object map format ({ mcpServers: { ... } }).
   */
  loadFromFile(filePath?: string): MCPServerConfig[] {
    const targetPath = filePath || this.configPath;
    if (!targetPath || !fs.existsSync(targetPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(targetPath, "utf-8");
      const parsed = JSON.parse(content);
      const loaded: MCPServerConfig[] = [];

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.command) {
            this.registerServer(item);
            loaded.push(item);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        const serversMap = parsed.mcpServers || parsed;
        for (const [id, def] of Object.entries(serversMap)) {
          if (def && typeof def === "object" && (def as any).command) {
            const config: MCPServerConfig = {
              id,
              name: (def as any).name || id,
              command: (def as any).command,
              args: (def as any).args || [],
              env: (def as any).env,
              cwd: (def as any).cwd,
              disabled: (def as any).disabled || false,
              timeoutMs: (def as any).timeoutMs || 30000
            };
            this.registerServer(config);
            loaded.push(config);
          }
        }
      }

      this.configPath = targetPath;
      return loaded;
    } catch (err: any) {
      throw new Error(`Failed to load MCP config from ${targetPath}: ${err.message}`);
    }
  }

  /**
   * Save registered servers to a JSON file.
   */
  saveToFile(filePath?: string): void {
    const targetPath = filePath || this.configPath;
    if (!targetPath) {
      throw new Error("No target path provided to save MCP server configurations.");
    }

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const mcpServers: Record<string, any> = {};
    for (const [id, config] of this.servers.entries()) {
      mcpServers[id] = {
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
        disabled: config.disabled,
        timeoutMs: config.timeoutMs
      };
    }

    const payload = JSON.stringify({ mcpServers }, null, 2);
    fs.writeFileSync(targetPath, payload, "utf-8");
    this.configPath = targetPath;
  }
}
