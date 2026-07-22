import { ToolDefinition } from "../client";
import { readTool } from "./read";
import { writeTool } from "./write";
import { editTool } from "./edit";
import { bashTool } from "./bash";
import { checkSyntaxTool } from "./checkSyntax";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { todoReadTool, todoWriteTool } from "./todo";
import { Tool } from "./types";

export type { Tool };

// Registry containing all available tools
export const tools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  checkSyntaxTool,
  globTool,
  grepTool,
  todoReadTool,
  todoWriteTool
];

// Helper to look up a tool by name
export function getToolByName(name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

// Convert our registry tools to definitions suitable for the API client
export function getToolDefinitions(): ToolDefinition[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));
}
