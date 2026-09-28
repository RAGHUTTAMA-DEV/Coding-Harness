import * as path from "path";
import * as os from "os";
import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy } from "./types";

export class PathPolicy implements GuardrailPolicy {
  name = "pathPolicy";
  description = "Guards against directory traversal, out-of-workspace file modification, and access to sensitive files.";

  private sensitivePatterns: RegExp[] = [
    /^\.env($|\..+)/i,
    /(^|[/\\])\.env($|\..+)/i,
    /(^|[/\\])\.git([/\\]config|head|index)/i,
    /(^|[/\\])(id_rsa|id_ecdsa|id_ed25519)($|\.)/i,
    /\.(pem|key|pfx|p12|pkcs12)$/i,
    /(^|[/\\])credentials\.json$/i,
    /(^|[/\\])\.ssh([/\\]|$)/i,
    /(^|[/\\])\.aws([/\\]|$)/i
  ];

  private systemPrefixes: string[] = [
    "/etc",
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/var/run",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)"
  ];

  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    // Only inspect tools that interact with file paths
    const fileTools = ["read_file", "write_file", "edit_file", "check_syntax"];
    if (!fileTools.includes(toolName) || !args || typeof args.path !== "string") {
      return { decision: "ALLOW", risk: "LOW" };
    }

    const rawPath = args.path.trim();
    if (!rawPath) {
      return {
        decision: "DENY",
        risk: "CRITICAL",
        reason: "File path parameter cannot be empty.",
        violatingPolicy: this.name
      };
    }

    const workspaceRoot = path.resolve(context.workspaceDir || process.cwd());
    const resolvedPath = path.resolve(workspaceRoot, rawPath);

    // 1. Check for system directories
    for (const sysPrefix of this.systemPrefixes) {
      if (resolvedPath.toLowerCase().startsWith(sysPrefix.toLowerCase())) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Access to system directory is strictly blocked: "${resolvedPath}"`,
          violatingPolicy: this.name
        };
      }
    }

    // 2. Check for workspace containment (prevent filesystem escape)
    const rel = path.relative(workspaceRoot, resolvedPath);
    const escapesWorkspace = rel.startsWith("..") || path.isAbsolute(rel);

    if (escapesWorkspace) {
      // Check if explicitly allowed
      const isAllowed = (context.allowedPaths || []).some((allowed) => {
        const resAllowed = path.resolve(workspaceRoot, allowed);
        return resolvedPath.startsWith(resAllowed);
      });

      if (!isAllowed) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Path escapes the workspace root boundary: "${resolvedPath}" (Workspace: "${workspaceRoot}")`,
          violatingPolicy: this.name
        };
      }
    }

    // 3. Check for sensitive files
    const normalizedRel = rel.replace(/\\/g, "/");
    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(normalizedRel) || pattern.test(path.basename(resolvedPath))) {
        // Read tools might require ASK, mutating tools strictly DENY or ASK
        if (toolName === "write_file" || toolName === "edit_file") {
          return {
            decision: "DENY",
            risk: "CRITICAL",
            reason: `Direct modification of sensitive file is blocked: "${normalizedRel}"`,
            violatingPolicy: this.name
          };
        } else {
          return {
            decision: "ASK",
            risk: "HIGH",
            reason: `Reading sensitive credentials or configuration requires confirmation: "${normalizedRel}"`,
            violatingPolicy: this.name
          };
        }
      }
    }

    // Mutating actions require confirmation in interactive mode, otherwise LOW risk
    if (toolName === "write_file" || toolName === "edit_file") {
      return {
        decision: context.autoConfirm ? "ALLOW" : "ASK",
        risk: "MEDIUM",
        reason: `File modification on "${normalizedRel}"`
      };
    }

    return { decision: "ALLOW", risk: "LOW" };
  }
}
