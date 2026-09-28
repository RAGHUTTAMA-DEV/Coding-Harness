import * as fs from "fs";
import * as path from "path";
import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy } from "./types";

export interface ResourcePolicyOptions {
  maxFileSizeBytes?: number;      // Default: 5MB
  maxWriteContentBytes?: number;  // Default: 5MB
  maxCommandLengthChars?: number; // Default: 2048 chars
}

export class ResourcePolicy implements GuardrailPolicy {
  name = "resourcePolicy";
  description = "Guards against excessive resource consumption, outsized files, and buffer overflow attempts.";

  private maxFileSizeBytes: number;
  private maxWriteContentBytes: number;
  private maxCommandLengthChars: number;

  constructor(options: ResourcePolicyOptions = {}) {
    this.maxFileSizeBytes = options.maxFileSizeBytes || 5 * 1024 * 1024; // 5MB
    this.maxWriteContentBytes = options.maxWriteContentBytes || 5 * 1024 * 1024; // 5MB
    this.maxCommandLengthChars = options.maxCommandLengthChars || 2048;
  }

  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    if (!args) {
      return { decision: "ALLOW", risk: "LOW" };
    }

    // 1. Check read_file on oversized files
    if (toolName === "read_file" && typeof args.path === "string") {
      const workspaceRoot = path.resolve(context.workspaceDir || process.cwd());
      const fullPath = path.resolve(workspaceRoot, args.path);
      if (fs.existsSync(fullPath)) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size > this.maxFileSizeBytes) {
            return {
              decision: "DENY",
              risk: "HIGH",
              reason: `File size (${(stats.size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit (${(this.maxFileSizeBytes / (1024 * 1024)).toFixed(2)} MB).`,
              violatingPolicy: this.name
            };
          }
        } catch {
          // Ignore filesystem stat errors
        }
      }
    }

    // 2. Check write_file / edit_file payload size
    if ((toolName === "write_file" || toolName === "edit_file") && typeof args.content === "string") {
      const byteLength = Buffer.byteLength(args.content, "utf-8");
      if (byteLength > this.maxWriteContentBytes) {
        return {
          decision: "DENY",
          risk: "HIGH",
          reason: `Write content payload (${(byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds limit (${(this.maxWriteContentBytes / (1024 * 1024)).toFixed(2)} MB).`,
          violatingPolicy: this.name
        };
      }
    }

    // 3. Check shell command length
    if (toolName === "run_command" && typeof args.command === "string") {
      if (args.command.length > this.maxCommandLengthChars) {
        return {
          decision: "DENY",
          risk: "HIGH",
          reason: `Command string length (${args.command.length} characters) exceeds safety threshold (${this.maxCommandLengthChars} characters).`,
          violatingPolicy: this.name
        };
      }
    }

    return { decision: "ALLOW", risk: "LOW" };
  }
}
