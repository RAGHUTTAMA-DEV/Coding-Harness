import * as readline from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import { applyEditContent } from "../tools/edit";
import { computeDiff, formatDiff } from "../utils/diff";

// Policy Engine configurations
const SAFE_COMMAND_PATTERNS: RegExp[] = [
  /^git\s+(status|diff|log|branch|show|rev-parse|tag|remote|config\s+--get)\b/i,
  /^(ls|dir|pwd|echo|cat|type)\b/i,
  /^(bun|npm|pnpm|yarn)\s+(test|run\s+test)\b/i,
  /^tsc\b.*--noEmit/i,
  /^bun\s+run\s+src\/tools\/.*\.test\.ts/i
];

const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /^rm\s+-(rf|fr|r\s*-f|f\s*-r)\b/i,
  /\b(rmdir|del)\b.*\b\/s\b/i,
  /^(:\(\)\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)$/, // Fork bomb
  /^(chmod|chown)\b/i,
  /^dd\s+if=/i,
  /^mkfs\b/i,
  /^(shutdown|reboot|poweroff)\b/i
];

export class PermissionGate {
  /**
   * Prompts the user for permission to execute a tool.
   * Prints the tool name and its arguments, and asks for [y/N] approval.
   */
  static async checkPermission(
    toolName: string,
    args: any,
    rl?: readline.Interface,
    autoConfirm?: boolean
  ): Promise<boolean> {
    if (autoConfirm) {
      if (toolName === "run_command") {
        const command = (args.command || "").trim();

        // Check dangerous commands
        for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            console.error(`\n\x1b[1m\x1b[31m✖ Policy Violation: Command blocked by policy engine.\x1b[0m`);
            console.error(`Blocked Command: \x1b[31m${command}\x1b[0m\n`);
            return false;
          }
        }

        // Auto-approve all other commands
        console.error(`\n\x1b[1m\x1b[32m✔ Policy Auto-Approve: Command allowed by policy engine.\x1b[0m`);
        console.error(`Running Command: \x1b[32m${command}\x1b[0m\n`);
      }
      return true;
    }

    // 1. Policy Engine check for command execution
    if (toolName === "run_command") {
      const command = (args.command || "").trim();

      // Check dangerous commands
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
          console.log(`\n\x1b[1m\x1b[31m✖ Policy Violation: Command blocked by policy engine.\x1b[0m`);
          console.log(`Blocked Command: \x1b[31m${command}\x1b[0m\n`);
          return false;
        }
      }

      // Check safe auto-approved commands
      for (const pattern of SAFE_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
          console.log(`\n\x1b[1m\x1b[32m✔ Policy Auto-Approve: Command allowed by policy engine.\x1b[0m`);
          console.log(`Running Command: \x1b[32m${command}\x1b[0m\n`);
          return true;
        }
      }
    }

    // 2. Diff Preview for write_file and edit_file
    let diffPreview = "";
    if (toolName === "write_file") {
      const filePath = args.path;
      const newContent = args.content || "";
      let oldContent = "";
      try {
        const resolvedPath = path.resolve(filePath);
        oldContent = await fs.readFile(resolvedPath, "utf-8");
      } catch (e) {
        // File does not exist yet (creation diff)
      }
      const diffHunks = computeDiff(oldContent, newContent);
      diffPreview = formatDiff(diffHunks);
    } else if (toolName === "edit_file") {
      const filePath = args.path;
      let oldContent = "";
      try {
        const resolvedPath = path.resolve(filePath);
        oldContent = await fs.readFile(resolvedPath, "utf-8");
        const editResult = applyEditContent(oldContent, args);
        if (editResult.success) {
          const diffHunks = computeDiff(oldContent, editResult.newContent);
          diffPreview = formatDiff(diffHunks);
        } else {
          diffPreview = `\x1b[31mError generating preview: ${editResult.error}\x1b[0m`;
        }
      } catch (e: any) {
        diffPreview = `\x1b[31mError reading file for preview: ${e.message}\x1b[0m`;
      }
    }

    const formattedArgs = JSON.stringify(args, null, 2);
    
    // Highlight the request using clean ANSI escape sequences
    console.log(`\n\x1b[1m\x1b[33m⚠️  Permission Request\x1b[0m`);
    console.log(`Tool:      \x1b[1m\x1b[36m${toolName}\x1b[0m`);
    console.log(`Arguments: \x1b[90m${formattedArgs.split("\n").join("\n           ")}\x1b[0m`);

    if (diffPreview) {
      console.log(`\n\x1b[1m\x1b[36m--- Diff Preview ---\x1b[0m`);
      console.log(diffPreview);
      console.log(`\x1b[1m\x1b[36m--------------------\x1b[0m\n`);
    }

    const promptText = `\x1b[1mAuthorize this action? [y/N]: \x1b[0m`;

    return new Promise((resolve) => {
      if (rl) {
        rl.question(promptText, (answer) => {
          const approved = answer.trim().toLowerCase() === "y";
          resolve(approved);
        });
      } else {
        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        tempRl.question(promptText, (answer) => {
          tempRl.close();
          const approved = answer.trim().toLowerCase() === "y";
          resolve(approved);
        });
      }
    });
  }
}

