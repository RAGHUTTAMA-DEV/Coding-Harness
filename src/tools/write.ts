import * as fs from "fs/promises";
import * as path from "path";
import { Tool } from "./types";

export const writeTool: Tool = {
  name: "write_file",
  description: "Write content to a file at a specific path. If the file already exists, it will be overwritten. Parent directories are created if they do not exist.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to write."
      },
      content: {
        type: "string",
        description: "The complete content to write into the file."
      }
    },
    required: ["path", "content"]
  },
  isMutating: true,
  async run(args: { path: string; content: string }): Promise<string> {
    try {
      const targetPath = path.resolve(args.path);
      const parentDir = path.dirname(targetPath);
      
      // Ensure the parent directory exists
      await fs.mkdir(parentDir, { recursive: true });
      
      await fs.writeFile(targetPath, args.content, "utf-8");
      
      // Check length and line count for verification feedback
      const lines = args.content.split(/\r?\n/).length;
      return `Success: Wrote file successfully to '${args.path}' (${lines} lines, ${args.content.length} characters).`;
    } catch (error: any) {
      return `Error writing file: ${error.message}`;
    }
  }
};
