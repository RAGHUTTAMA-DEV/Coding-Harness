import { exec } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { Tool } from "./types";

export const checkSyntaxTool: Tool = {
  name: "check_syntax",
  description: "Check a JavaScript or TypeScript file for syntax and compilation errors. Returns success or details of any syntax/compilation errors found.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the JS/TS file to check."
      }
    },
    required: ["path"]
  },
  isMutating: false,
  async run(args: { path: string }): Promise<string> {
    try {
      const targetPath = path.resolve(args.path);

      // Check if file exists
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) {
          return `Error: Path '${args.path}' is not a file.`;
        }
      } catch (err) {
        return `Error: File not found at '${args.path}'.`;
      }

      return new Promise((resolve) => {
        exec(`bun build "${targetPath}"`, (error, stdout, stderr) => {
          if (error) {
            // Syntax error! Return the error output (stdout + stderr)
            resolve(`Syntax/Compilation Errors found in '${args.path}':\n${stderr || stdout || error.message}`);
          } else {
            resolve(`Success: No syntax or compilation errors found in '${args.path}'.`);
          }
        });
      });
    } catch (error: any) {
      return `Error checking syntax: ${error.message}`;
    }
  }
};
