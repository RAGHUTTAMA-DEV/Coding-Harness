import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy, RiskLevel } from "./types";

export class CommandPolicy implements GuardrailPolicy {
  name = "commandPolicy";
  description = "Semantically classifies shell commands into risk tiers and enforces ALLOW/ASK/DENY guardrails.";

  private criticalPatterns: RegExp[] = [
    /^rm\s+-(?:rf|fr|r\s*-f|f\s*-r)\b/i,
    /\b(?:rmdir|del)\b.*\b\/s\b/i,
    /^(?::\(\)\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)$/, // Fork bomb
    /^\s*dd\s+if=/i,
    /^\s*mkfs\b/i,
    /^\s*(?:shutdown|reboot|poweroff|init\s+0)\b/i,
    /git\s+push\b.*(?:--force|-f\b)/i, // Force pushes
    /git\s+reset\s+--hard\s+origin/i,
    />\s*\/dev\/[s|h]d[a-z]/i // Direct disk overwrite
  ];

  private highRiskPatterns: RegExp[] = [
    /^git\s+push\b/i,
    /^git\s+commit\b/i,
    /^rm\s+/i,
    /\b(?:del|erase)\b/i,
    /\bcurl\b.*\|\s*(?:bash|sh|cmd|powershell)\b/i, // Piping remote script to shell
    /\bwget\b.*\|\s*(?:bash|sh|cmd|powershell)\b/i
  ];

  private mediumRiskPatterns: RegExp[] = [
    /^(?:npm|bun|yarn|pnpm)\s+(?:install|add|remove|uninstall|update)\b/i,
    /^(?:npm|bun|yarn|pnpm)\s+run\s+(?!test\b)/i,
    /^git\s+(?:checkout|stash|clean|revert|merge|rebase)\b/i
  ];

  private lowRiskPatterns: RegExp[] = [
    /^git\s+(?:status|diff|log|branch|show|rev-parse|tag|remote|config\s+--get)\b/i,
    /^(?:ls|dir|pwd|echo|cat|type|head|tail|grep|findstr)\b/i,
    /^(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+test)\b/i,
    /^tsc\b.*--noEmit/i,
    /^bun\s+x\s+tsc\b.*--noEmit/i
  ];

  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    if (toolName !== "run_command" || !args || typeof args.command !== "string") {
      return { decision: "ALLOW", risk: "LOW" };
    }

    const command = args.command.trim();
    if (!command) {
      return {
        decision: "DENY",
        risk: "CRITICAL",
        reason: "Shell command cannot be empty.",
        violatingPolicy: this.name
      };
    }

    // 1. Check custom blocked commands
    const blocked = context.blockedCommands || [];
    for (const b of blocked) {
      if (command.includes(b)) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Command matches explicitly blocked instruction: "${b}"`,
          violatingPolicy: this.name
        };
      }
    }

    // 2. Critical Risk: STRICTLY DENIED
    for (const pattern of this.criticalPatterns) {
      if (pattern.test(command)) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Destructive or dangerous command pattern detected: "${command}"`,
          violatingPolicy: this.name
        };
      }
    }

    // 3. High Risk: Requires user confirmation (ASK)
    for (const pattern of this.highRiskPatterns) {
      if (pattern.test(command)) {
        return {
          decision: context.autoConfirm ? "ALLOW" : "ASK",
          risk: "HIGH",
          reason: `High risk action requires authorization: "${command}"`
        };
      }
    }

    // 4. Medium Risk: Package management or environment changes
    for (const pattern of this.mediumRiskPatterns) {
      if (pattern.test(command)) {
        return {
          decision: context.autoConfirm ? "ALLOW" : "ASK",
          risk: "MEDIUM",
          reason: `Environment or dependency modification command: "${command}"`
        };
      }
    }

    // 5. Low Risk: Safe read-only or verification commands
    for (const pattern of this.lowRiskPatterns) {
      if (pattern.test(command)) {
        return {
          decision: "ALLOW",
          risk: "LOW",
          reason: `Auto-approved safe command: "${command}"`
        };
      }
    }

    // Default unknown shell commands are classified as MEDIUM risk
    return {
      decision: context.autoConfirm ? "ALLOW" : "ASK",
      risk: "MEDIUM",
      reason: `Unrecognized command execution: "${command}"`
    };
  }
}
