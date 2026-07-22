import { Glob } from "bun";
import * as fs from "fs/promises";
import { Tool } from "./types";

export const globTool: Tool = {
  name: "glob",
  description: "Find files and directories matching a glob pattern relative to the current working directory. Useful for listing project structure and finding files.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The glob pattern (e.g. '*' to list root files, 'src/**/*.ts' to find TS files, etc.)."
      }
    },
    required: ["pattern"]
  },
  isMutating: false,
  async run(args: { pattern: string }): Promise<string> {
    try {
      const glob = new Glob(args.pattern);
      const results: string[] = [];

      for (const item of glob.scanSync({ cwd: process.cwd() })) {
        const normalized = item.replace(/\\/g, "/");
        if (
          normalized.includes("node_modules/") ||
          normalized.includes(".git/") ||
          normalized.includes(".gemini/") ||
          normalized.startsWith("node_modules") ||
          normalized.startsWith(".git") ||
          normalized.startsWith(".gemini")
        ) {
          continue;
        }
        results.push(normalized);
      }

      if (results.length === 0) {
        return `No files or directories found matching pattern "${args.pattern}".`;
      }

      // Sort results alphabetically for consistency
      results.sort();

      const maxResults = 100;
      let output = `Matched files & directories (${results.length} total):\n`;
      const slice = results.slice(0, maxResults);
      output += slice.map(item => `- ${item}`).join("\n");

      if (results.length > maxResults) {
        output += `\n\n[Warning: Results truncated to first ${maxResults} items. Use more specific pattern to filter.]`;
      }

      return output;
    } catch (error: any) {
      return `Error scanning glob: ${error.message}`;
    }
  }
};
