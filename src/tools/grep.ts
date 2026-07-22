import { Glob } from "bun";
import * as fs from "fs/promises";
import { Tool } from "./types";

export const grepTool: Tool = {
  name: "grep",
  description: "Search for a substring or regular expression in all text files in the project. Automatically excludes common binary and dependency folders like node_modules.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The string or regular expression to search for."
      },
      glob: {
        type: "string",
        description: "Optional glob pattern to restrict search files (e.g. '*.ts' or 'src/**/*')."
      }
    },
    required: ["pattern"]
  },
  isMutating: false,
  async run(args: { pattern: string; glob?: string }): Promise<string> {
    const maxMatches = 50;

    // 1. Try ripgrep first
    let useRg = false;
    try {
      const checkProc = Bun.spawn(["rg", "--version"], { stdout: "ignore", stderr: "ignore" });
      const exitCode = await checkProc.exited;
      if (exitCode === 0) {
        useRg = true;
      }
    } catch (e) {
      // rg not available
    }

    if (useRg) {
      try {
        const argsArray = ["--line-number", "--color=never", "--smart-case"];

        if (args.glob) {
          argsArray.push("-g", args.glob);
        }
        
        const exclusions = ["node_modules", ".git", ".gemini", "dist", "build"];
        for (const excl of exclusions) {
          argsArray.push("-g", `!${excl}/**`);
          argsArray.push("-g", `!${excl}`);
        }

        let searchPattern = args.pattern;
        const isRegex = args.pattern.startsWith("/") && args.pattern.endsWith("/");
        if (isRegex) {
          searchPattern = args.pattern.substring(1, args.pattern.length - 1);
        } else {
          argsArray.push("-F"); // Fixed strings
        }

        argsArray.push(searchPattern);

        const proc = Bun.spawn(["rg", ...argsArray]);
        const stdoutText = await new Response(proc.stdout).text();
        
        const matches: string[] = [];
        const lines = stdoutText.split(/\r?\n/).filter(line => line.trim() !== "");

        for (const line of lines) {
          if (matches.length >= maxMatches) break;
          // rg format: path:line:content
          const firstColonIdx = line.indexOf(":");
          const secondColonIdx = line.indexOf(":", firstColonIdx + 1);
          if (firstColonIdx !== -1 && secondColonIdx !== -1) {
            const filePath = line.substring(0, firstColonIdx).replace(/\\/g, "/");
            const lineNum = line.substring(firstColonIdx + 1, secondColonIdx);
            const content = line.substring(secondColonIdx + 1).trim();
            matches.push(`${filePath}:${lineNum}: ${content}`);
          }
        }

        if (matches.length === 0) {
          return `No matches found for pattern "${args.pattern}".`;
        }

        let result = `Search results for "${args.pattern}" (ripgrep-backed):\n\n`;
        result += matches.join("\n");
        if (lines.length >= maxMatches) {
          result += `\n\n[Warning: Matches truncated to the first ${maxMatches} results.]`;
        }
        return result;
      } catch (err: any) {
        // Fall back to native if rg execution fails
      }
    }

    // 2. Native fallback (Glob + fs.readFile)
    try {
      const fileGlobPattern = args.glob || "**/*";
      const glob = new Glob(fileGlobPattern);
      
      const files: string[] = [];
      const isRegex = args.pattern.startsWith("/") && args.pattern.endsWith("/");
      let searchRegex: RegExp;
      
      if (isRegex) {
        searchRegex = new RegExp(args.pattern.substring(1, args.pattern.length - 1), "i");
      } else {
        // Escape regex special chars to search as literal substring
        const escaped = args.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        searchRegex = new RegExp(escaped, "i");
      }

      // Scan the workspace
      for (const file of glob.scanSync({ cwd: process.cwd() })) {
        // Skip directories & binary folders & big folders
        const normalized = file.replace(/\\/g, "/");
        if (
          normalized.includes("node_modules/") ||
          normalized.includes(".git/") ||
          normalized.includes(".gemini/") ||
          normalized.includes("dist/") ||
          normalized.includes("build/") ||
          normalized.startsWith("node_modules") ||
          normalized.startsWith(".git") ||
          normalized.startsWith(".gemini")
        ) {
          continue;
        }

        // Verify it is a file
        try {
          const stats = await fs.stat(file);
          if (stats.isFile()) {
            files.push(normalized);
          }
        } catch (e) {}
      }

      const matches: string[] = [];

      for (const file of files) {
        let content: string;
        try {
          content = await fs.readFile(file, "utf-8");
        } catch (readErr) {
          // Skip unreadable files
          continue;
        }
        
        const lines = content.split(/\r?\n/);
        
        lines.forEach((line, index) => {
          if (searchRegex.test(line)) {
            if (matches.length < maxMatches) {
              matches.push(`${file}:${index + 1}: ${line.trim()}`);
            }
          }
        });

        if (matches.length >= maxMatches) {
          break;
        }
      }

      if (matches.length === 0) {
        return `No matches found for pattern "${args.pattern}".`;
      }

      let result = `Search results for "${args.pattern}":\n\n`;
      result += matches.join("\n");
      if (matches.length >= maxMatches) {
        result += `\n\n[Warning: Matches truncated to the first ${maxMatches} results.]`;
      }
      return result;
    } catch (error: any) {
      return `Error searching: ${error.message}`;
    }
  }
};
