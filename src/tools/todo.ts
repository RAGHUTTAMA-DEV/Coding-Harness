import * as fs from "fs/promises";
import * as path from "path";
import { Tool } from "./types";

const TODO_FILE_NAME = ".todo.md";

export const todoReadTool: Tool = {
  name: "todo_read",
  description: "Read the current list of tasks (TODOs) for the active project.",
  input_schema: {
    type: "object",
    properties: {}
  },
  isMutating: false,
  async run(): Promise<string> {
    try {
      const todoPath = path.resolve(process.cwd(), TODO_FILE_NAME);
      try {
        await fs.access(todoPath);
      } catch {
        return `No tasks (TODO list) found for this project yet. Use 'todo_write' to initialize the task list.`;
      }
      
      const content = await fs.readFile(todoPath, "utf-8");
      return `Current Tasks:\n\n${content}`;
    } catch (err: any) {
      return `Error reading task list: ${err.message}`;
    }
  }
};

export const todoWriteTool: Tool = {
  name: "todo_write",
  description: "Write or update the task list (TODOs) for the active project. Use markdown checkboxes, e.g. '[ ]' for uncompleted, '[/]' for in-progress, '[x]' for completed tasks.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The complete markdown todo content containing checkable task lists."
      }
    },
    required: ["content"]
  },
  isMutating: true,
  async run(args: { content: string }): Promise<string> {
    try {
      const todoPath = path.resolve(process.cwd(), TODO_FILE_NAME);
      await fs.writeFile(todoPath, args.content, "utf-8");
      return `Successfully updated task list in '${TODO_FILE_NAME}'.`;
    } catch (err: any) {
      return `Error writing task list: ${err.message}`;
    }
  }
};
