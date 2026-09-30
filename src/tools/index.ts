import { ChatModelClient, ToolDefinition } from "../client";
import { readTool } from "./read";
import { writeTool } from "./write";
import { editTool } from "./edit";
import { bashTool } from "./bash";
import { checkSyntaxTool } from "./checkSyntax";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { todoReadTool, todoWriteTool } from "./todo";
import { subAgentTool } from "./subagent";
import {
  checkpointCreateTool,
  checkpointRollbackTool,
  checkpointListTool
} from "./checkpoint";
import { Tool } from "./types";

export type { Tool };

export { activeClient, setActiveClient } from "./activeClient";

export const builtInTools: Tool[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  checkSyntaxTool,
  globTool,
  grepTool,
  todoReadTool,
  todoWriteTool,
  subAgentTool,
  checkpointCreateTool,
  checkpointRollbackTool,
  checkpointListTool
];

export const tools: Tool[] = [...builtInTools];

export function registerTool(tool: Tool): void {
  const index = tools.findIndex(t => t.name === tool.name);
  if (index >= 0) {
    tools[index] = tool;
  } else {
    tools.push(tool);
  }
}

export function unregisterTool(name: string): boolean {
  const index = tools.findIndex(t => t.name === name);
  if (index >= 0) {
    tools.splice(index, 1);
    return true;
  }
  return false;
}

export function resetToolsToBuiltin(): void {
  tools.length = 0;
  tools.push(...builtInTools);
}

export function getAllTools(): Tool[] {
  return tools;
}

export function getToolByName(name: string): Tool | undefined {
  return tools.find(t => t.name === name);
}

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));
}
