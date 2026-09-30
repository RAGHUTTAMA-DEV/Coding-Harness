/**
 * Types and interfaces for the Model Context Protocol (MCP) subsystem.
 */

// JSON-RPC 2.0 Base Types
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

// MCP Client Connection States
export type McpConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

// MCP Server Configuration
export interface MCPServerConfig {
  id: string;
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  disabled?: boolean;
  autoConnect?: boolean;
  timeoutMs?: number;
  isMutatingDefault?: boolean;
}

// MCP Protocol Schema Types
export interface MCPToolInputSchema {
  type: "object";
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolContentItem {
  type: "text" | "image" | "resource" | string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: any;
}

export interface MCPToolCallResult {
  content: MCPToolContentItem[];
  isError?: boolean;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, any>;
    prompts?: Record<string, any>;
    resources?: Record<string, any>;
    logging?: Record<string, any>;
    [key: string]: any;
  };
  serverInfo: {
    name: string;
    version?: string;
  };
}

export interface MCPListToolsResult {
  tools: MCPToolDefinition[];
  nextCursor?: string;
}
