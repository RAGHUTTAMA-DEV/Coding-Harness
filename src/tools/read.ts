import * as fs from "fs/promises";
import * as path from "path";
import { Tool } from "./types";

export const readTool: Tool = {
  name: "read_file",
  description: "Read the contents of a file at a specific path, optionally within a line range. It returns the file content with line numbers prefixed.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file to read."
      },
      startLine: {
        type: "integer",
        description: "The starting line number to read (1-indexed, optional)."
      },
      endLine: {
        type: "integer",
        description: "The ending line number to read (1-indexed, inclusive, optional)."
      }
    },
    required: ["path"]
  },
  isMutating: false,
  async run(args: { path: string; startLine?: number; endLine?: number }): Promise<string> {
    try {
      const targetPath = path.resolve(args.path);
      
      // Check if it exists and is a file
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) {
          return `Error: Path '${args.path}' is not a file.`;
        }
      } catch (err) {
        return `Error: File not found at '${args.path}'.`;
      }

      const content = await fs.readFile(targetPath, "utf-8");
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      let start = 1;
      let end = totalLines;

      if (args.startLine !== undefined) {
        start = Math.max(1, args.startLine);
      }
      if (args.endLine !== undefined) {
        end = Math.min(totalLines, Math.max(start, args.endLine));
      }

      // Default truncation if no range is specified and file is huge
      const MAX_UNTRUNCATED_LINES = 500;
      let wasTruncated = false;
      if (args.startLine === undefined && args.endLine === undefined && totalLines > MAX_UNTRUNCATED_LINES) {
        end = MAX_UNTRUNCATED_LINES;
        wasTruncated = true;
      }

      const selectedLines = lines.slice(start - 1, end);
      const formattedLines = selectedLines.map((line, index) => {
        const lineNum = start + index;
        return `${lineNum}: ${line}`;
      }).join("\n");

      let result = `File: ${args.path}\n`;
      result += `Lines: ${start} to ${end} of ${totalLines}\n\n`;
      result += formattedLines;

      if (wasTruncated) {
        result += `\n\n[Warning: File truncated to first ${MAX_UNTRUNCATED_LINES} lines. If you need to read more, specify startLine and endLine parameters.]`;
      }

      return result;
    } catch (error: any) {
      return `Error reading file: ${error.message}`;
    }
  }
};
