import { spawn, ChildProcess } from "child_process";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  MCPServerConfig,
  MCPInitializeResult,
  MCPListToolsResult,
  MCPToolDefinition,
  MCPToolCallResult,
  McpConnectionState
} from "./types";

export class McpClient {
  public readonly config: MCPServerConfig;
  private state: McpConnectionState = "DISCONNECTED";
  private childProcess: ChildProcess | null = null;
  private pendingRequests: Map<
    number | string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timer: NodeJS.Timeout | null;
      method: string;
    }
  > = new Map();
  private nextRequestId: number = 1;
  private buffer: string = "";
  private stderrLines: string[] = [];
  private serverInfo?: { name: string; version?: string };
  private protocolVersion?: string;
  private intentionalDisconnect: boolean = false;

  constructor(config: MCPServerConfig) {
    this.config = {
      timeoutMs: 30000,
      args: [],
      ...config
    };
  }

  getState(): McpConnectionState {
    return this.state;
  }

  getServerInfo() {
    return this.serverInfo;
  }

  getProtocolVersion() {
    return this.protocolVersion;
  }

  getStderr(): string[] {
    return [...this.stderrLines];
  }

  /**
   * Connect to the MCP server via stdio transport and perform initialization handshake.
   */
  async connect(): Promise<void> {
    if (this.state === "CONNECTED" && this.childProcess) {
      return;
    }

    this.state = "CONNECTING";
    this.intentionalDisconnect = false;
    this.buffer = "";
    this.stderrLines = [];

    return new Promise<void>((resolve, reject) => {
      let isSettled = false;

      const finishConnect = (err?: Error) => {
        if (isSettled) return;
        isSettled = true;
        if (err) {
          this.state = "ERROR";
          this.cleanupProcess();
          reject(err);
        } else {
          this.state = "CONNECTED";
          resolve();
        }
      };

      try {
        const env = {
          ...process.env,
          ...(this.config.env || {})
        };

        this.childProcess = spawn(this.config.command, this.config.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          env,
          cwd: this.config.cwd || process.cwd(),
          shell: process.platform === "win32"
        });

        this.childProcess.on("error", (err) => {
          this.state = "ERROR";
          this.rejectAllPending(new Error(`MCP server process error: ${err.message}`));
          finishConnect(new Error(`Failed to spawn MCP server "${this.config.id}": ${err.message}`));
        });

        this.childProcess.on("exit", (code, signal) => {
          const wasConnected = this.state === "CONNECTED";
          this.state = "DISCONNECTED";
          this.childProcess = null;

          if (!this.intentionalDisconnect) {
            const exitMsg = `MCP server "${this.config.id}" exited with code ${code}, signal ${signal}`;
            this.rejectAllPending(new Error(exitMsg));
            if (!isSettled) {
              finishConnect(new Error(exitMsg));
            }
          }
        });

        if (this.childProcess.stdout) {
          this.childProcess.stdout.setEncoding("utf-8");
          this.childProcess.stdout.on("data", (chunk: string) => {
            this.handleStdoutChunk(chunk);
          });
        }

        if (this.childProcess.stderr) {
          this.childProcess.stderr.setEncoding("utf-8");
          this.childProcess.stderr.on("data", (chunk: string) => {
            const lines = chunk.split(/\r?\n/).filter(Boolean);
            this.stderrLines.push(...lines);
            if (this.stderrLines.length > 100) {
              this.stderrLines = this.stderrLines.slice(-100);
            }
          });
        }

        // Perform the MCP protocol initialization handshake
        this.performHandshake()
          .then(() => finishConnect())
          .catch((err) => finishConnect(err));
      } catch (err: any) {
        finishConnect(err);
      }
    });
  }

  private async performHandshake(): Promise<void> {
    const initResult = await this.sendRequest<MCPInitializeResult>(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: "coding-harness",
          version: "1.0.0"
        }
      },
      this.config.timeoutMs
    );

    this.protocolVersion = initResult?.protocolVersion;
    this.serverInfo = initResult?.serverInfo;

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});
  }

  /**
   * Send a JSON-RPC 2.0 Request and await response.
   */
  async sendRequest<T = any>(method: string, params?: any, timeoutMs?: number): Promise<T> {
    if (!this.childProcess || !this.childProcess.stdin) {
      throw new Error(`Cannot send request '${method}': MCP client '${this.config.id}' is not connected.`);
    }

    const id = this.nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    const actualTimeout = timeoutMs !== undefined ? timeoutMs : this.config.timeoutMs || 30000;

    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      if (actualTimeout > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${actualTimeout}ms.`));
        }, actualTimeout);
      }

      this.pendingRequests.set(id, { resolve, reject, timer, method });

      try {
        const payload = JSON.stringify(request) + "\n";
        this.childProcess!.stdin!.write(payload, "utf-8", (err) => {
          if (err) {
            if (timer) clearTimeout(timer);
            this.pendingRequests.delete(id);
            reject(new Error(`Failed to write to MCP server stdin: ${err.message}`));
          }
        });
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Send a JSON-RPC 2.0 Notification (fire-and-forget).
   */
  sendNotification(method: string, params?: any): void {
    if (!this.childProcess || !this.childProcess.stdin) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params
    };

    try {
      this.childProcess.stdin.write(JSON.stringify(notification) + "\n", "utf-8");
    } catch {
      // Ignore notification write error
    }
  }

  /**
   * Process incoming chunks from server stdout.
   */
  private handleStdoutChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || ""; // Retain incomplete line

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(line);
        if (response.id !== undefined && response.id !== null) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            if (pending.timer) {
              clearTimeout(pending.timer);
            }
            this.pendingRequests.delete(response.id);

            if (response.error) {
              pending.reject(
                new Error(
                  `MCP Error [${response.error.code}]: ${response.error.message}${
                    response.error.data ? " (" + JSON.stringify(response.error.data) + ")" : ""
                  }`
                )
              );
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch (parseErr) {
        // Non-JSON line or output log from server
      }
    }
  }

  /**
   * Discover tools exposed by the MCP server.
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (this.state !== "CONNECTED") {
      throw new Error(`Cannot list tools: MCP client '${this.config.id}' is in state '${this.state}'.`);
    }

    const res = await this.sendRequest<MCPListToolsResult>("tools/list", {});
    return res?.tools || [];
  }

  /**
   * Execute an MCP tool on the server.
   */
  async callTool(name: string, args: Record<string, any> = {}): Promise<MCPToolCallResult> {
    if (this.state !== "CONNECTED") {
      throw new Error(`Cannot call tool '${name}': MCP client '${this.config.id}' is in state '${this.state}'.`);
    }

    return await this.sendRequest<MCPToolCallResult>("tools/call", {
      name,
      arguments: args
    });
  }

  /**
   * Disconnect and gracefully stop the child process.
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.state = "DISCONNECTED";
    this.cleanupProcess();
    this.rejectAllPending(new Error(`MCP client '${this.config.id}' was disconnected.`));
  }

  /**
   * Reconnect to the server.
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    // Allow brief event-loop turn for OS process cleanup
    await new Promise((r) => setTimeout(r, 50));
    await this.connect();
  }

  private cleanupProcess(): void {
    if (this.childProcess) {
      const proc = this.childProcess;
      this.childProcess = null;
      proc.removeAllListeners();
      if (proc.stdout) proc.stdout.removeAllListeners();
      if (proc.stderr) proc.stderr.removeAllListeners();
      if (proc.stdin) proc.stdin.removeAllListeners();

      try {
        if (!proc.killed) {
          proc.kill("SIGTERM");
        }
      } catch {
        // Ignore kill error
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }
}
