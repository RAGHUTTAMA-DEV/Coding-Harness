import { Tool } from "../tools/types";
import { MCPToolDefinition, MCPToolCallResult } from "./types";
import { McpClient } from "./client";
import { PolicyEngine } from "../guardrails/policyEngine";
import { GuardrailContext } from "../guardrails/types";

const MUTATING_PATTERNS = [
  /write/i,
  /edit/i,
  /create/i,
  /update/i,
  /delete/i,
  /remove/i,
  /drop/i,
  /insert/i,
  /execute/i,
  /run/i,
  /exec/i,
  /modify/i,
  /set/i,
  /send/i,
  /post/i,
  /put/i,
  /patch/i
];

export interface McpAdapterOptions {
  namePrefix?: string;
  policyEngine?: PolicyEngine;
  getGuardrailContext?: () => GuardrailContext;
}

export class McpToolAdapter {
  /**
   * Adapts an MCP tool into a native harness Tool object.
   */
  static adaptTool(
    mcpTool: MCPToolDefinition,
    client: McpClient,
    options: McpAdapterOptions = {}
  ): Tool {
    const serverId = client.config.id;
    const prefix = options.namePrefix ?? `mcp_${serverId}_`;
    const adaptedName = `${prefix}${mcpTool.name}`;

    // Determine mutating status
    let isMutating = client.config.isMutatingDefault ?? false;
    if (client.config.isMutatingDefault === undefined) {
      isMutating = MUTATING_PATTERNS.some((pat) => pat.test(mcpTool.name));
    }

    const inputProperties = mcpTool.inputSchema?.properties || {};
    const requiredProps = mcpTool.inputSchema?.required || [];

    const tool: Tool = {
      name: adaptedName,
      description: mcpTool.description
        ? `[MCP:${serverId}] ${mcpTool.description}`
        : `[MCP:${serverId}] Tool '${mcpTool.name}'`,
      input_schema: {
        type: "object",
        properties: inputProperties,
        required: requiredProps
      },
      isMutating,
      run: async (args: any): Promise<string> => {
        // 1. Schema Validation
        const parsedArgs = args && typeof args === "object" ? args : {};
        const validationError = McpToolAdapter.validateSchema(parsedArgs, mcpTool);
        if (validationError) {
          return `Error: Invalid arguments for tool '${adaptedName}': ${validationError}`;
        }

        // 2. Guardrail Engine Verification (MCP tools must NOT bypass guardrails)
        if (options.policyEngine && options.getGuardrailContext) {
          const context = options.getGuardrailContext();
          const evaluation = await options.policyEngine.evaluate(adaptedName, parsedArgs, context);

          if (evaluation.decision === "DENY") {
            return `Error: Guardrail Blocked (${evaluation.violatingPolicy || "PolicyEngine"}): ${
              evaluation.reason || "Action violates security policies."
            }`;
          }

          if (evaluation.decision === "ASK" && !context.autoConfirm) {
            // Permission request through policy engine if interactive check is desired
            const permitted = await options.policyEngine.checkPermission(
              adaptedName,
              parsedArgs,
              context
            );
            if (!permitted) {
              return `Error: Guardrail authorization declined for tool '${adaptedName}'.`;
            }
          }
        }

        // 3. Execution via MCP Client
        try {
          const result: MCPToolCallResult = await client.callTool(mcpTool.name, parsedArgs);
          return McpToolAdapter.formatResult(result);
        } catch (err: any) {
          return `Error executing MCP tool '${adaptedName}': ${err.message}`;
        }
      }
    };

    return tool;
  }

  /**
   * Validate tool arguments against schema definitions.
   */
  static validateSchema(args: Record<string, any>, mcpTool: MCPToolDefinition): string | null {
    const required = mcpTool.inputSchema?.required || [];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null) {
        return `Missing required parameter '${key}'.`;
      }
    }

    const properties = mcpTool.inputSchema?.properties || {};
    for (const [key, val] of Object.entries(args)) {
      const propDef = properties[key];
      if (propDef && propDef.type) {
        const expectedType = propDef.type;
        const actualType = Array.isArray(val) ? "array" : typeof val;

        if (expectedType === "integer") {
          if (typeof val !== "number" || !Number.isInteger(val)) {
            return `Parameter '${key}' expected integer, received ${actualType}.`;
          }
        } else if (expectedType === "number") {
          if (typeof val !== "number") {
            return `Parameter '${key}' expected number, received ${actualType}.`;
          }
        } else if (expectedType === "array") {
          if (!Array.isArray(val)) {
            return `Parameter '${key}' expected array, received ${actualType}.`;
          }
        } else if (expectedType !== actualType) {
          return `Parameter '${key}' expected ${expectedType}, received ${actualType}.`;
        }
      }
    }

    return null;
  }

  /**
   * Format MCP call result into a text string representation.
   */
  static formatResult(result: MCPToolCallResult): string {
    if (!result || !result.content || result.content.length === 0) {
      return result?.isError ? "Error: MCP tool returned an empty error response." : "(No output from tool)";
    }

    const textParts = result.content.map((item) => {
      if (typeof item === "string") return item;
      if (item.type === "text" && item.text) {
        return item.text;
      }
      if (item.data) {
        return `[Binary Content: ${item.mimeType || "application/octet-stream"}]`;
      }
      return JSON.stringify(item);
    });

    const output = textParts.join("\n").trim();
    if (result.isError) {
      return output.startsWith("Error:") ? output : `Error: ${output}`;
    }
    return output;
  }
}
