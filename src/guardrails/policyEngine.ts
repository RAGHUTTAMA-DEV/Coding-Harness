import * as readline from "readline";
import * as fs from "fs/promises";
import * as path from "path";
import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy, PolicyDecision } from "./types";
import { PathPolicy } from "./pathPolicy";
import { CommandPolicy } from "./commandPolicy";
import { SecretScanner } from "./secretScanner";
import { ResourcePolicy } from "./resourcePolicy";
import { NetworkPolicy } from "./networkPolicy";
import { computeDiff, formatDiff } from "../utils/diff";
import { applyEditContent } from "../tools/edit";

export class PolicyEngine {
  private policies: GuardrailPolicy[] = [];

  constructor(customPolicies?: GuardrailPolicy[]) {
    if (customPolicies) {
      this.policies = customPolicies;
    } else {
      this.policies = [
        new PathPolicy(),
        new CommandPolicy(),
        new ResourcePolicy(),
        new SecretScanner(),
        new NetworkPolicy()
      ];
    }
  }

  /**
   * Registers an additional policy into the engine.
   */
  registerPolicy(policy: GuardrailPolicy): void {
    this.policies.push(policy);
  }

  /**
   * Evaluates a tool call against all configured policies.
   */
  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    let finalDecision: PolicyDecision = "ALLOW";
    let highestRisk: GuardrailEvaluationResult["risk"] = "LOW";
    let finalReason: string | undefined;
    let violatingPolicy: string | undefined;

    const riskSeverity: Record<string, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4
    };

    for (const policy of this.policies) {
      const result = await policy.evaluate(toolName, args, context);

      // DENY is terminal and takes absolute precedence
      if (result.decision === "DENY") {
        return {
          decision: "DENY",
          risk: result.risk || "CRITICAL",
          reason: result.reason,
          violatingPolicy: policy.name
        };
      }

      // Elevate to ASK if any policy requests it
      if (result.decision === "ASK") {
        finalDecision = "ASK";
        if (riskSeverity[result.risk] > riskSeverity[highestRisk]) {
          highestRisk = result.risk;
          finalReason = result.reason;
          violatingPolicy = policy.name;
        }
      }
    }

    return {
      decision: finalDecision,
      risk: highestRisk,
      reason: finalReason,
      violatingPolicy
    };
  }

  /**
   * Intercepts tool execution and enforces guardrails.
   * Returns true if execution is permitted, false if blocked.
   */
  async checkPermission(
    toolName: string,
    args: any,
    context: GuardrailContext,
    rl?: readline.Interface
  ): Promise<boolean> {
    const evaluation = await this.evaluate(toolName, args, context);

    // 1. Strict DENY
    if (evaluation.decision === "DENY") {
      console.error(`\n\x1b[1m\x1b[31m✖ Guardrail Blocked (${evaluation.violatingPolicy || "PolicyEngine"}):\x1b[0m`);
      console.error(`\x1b[31m${evaluation.reason || "Action violates security policies."}\x1b[0m\n`);
      return false;
    }

    // 2. Auto-approved ALLOW
    if (evaluation.decision === "ALLOW") {
      if (toolName === "run_command" && args.command) {
        console.error(`\x1b[90m✔ Guardrail Auto-Approve: ${args.command}\x1b[0m`);
      }
      return true;
    }

    // 3. ASK decision
    if (context.autoConfirm) {
      if (toolName === "run_command" && args.command) {
        console.error(`\x1b[33m✔ Guardrail Auto-Confirm (${evaluation.risk} Risk): ${args.command}\x1b[0m`);
      }
      return true;
    }

    // Interactive prompt for user confirmation
    let diffPreview = "";
    if (toolName === "write_file" && args.path) {
      try {
        const fullPath = path.resolve(context.workspaceDir, args.path);
        let oldContent = "";
        try {
          oldContent = await fs.readFile(fullPath, "utf-8");
        } catch {
          // File does not exist yet
        }
        const hunks = computeDiff(oldContent, args.content || "");
        diffPreview = formatDiff(hunks);
      } catch {
        // Ignore diff error
      }
    } else if (toolName === "edit_file" && args.path) {
      try {
        const fullPath = path.resolve(context.workspaceDir, args.path);
        const oldContent = await fs.readFile(fullPath, "utf-8");
        const editResult = applyEditContent(oldContent, args);
        if (editResult.success) {
          const hunks = computeDiff(oldContent, editResult.newContent);
          diffPreview = formatDiff(hunks);
        }
      } catch {
        // Ignore diff error
      }
    }

    console.log(`\n\x1b[1m\x1b[33m⚠️  Guardrail Authorization Request [${evaluation.risk} Risk]\x1b[0m`);
    if (evaluation.reason) {
      console.log(`Reason:    \x1b[33m${evaluation.reason}\x1b[0m`);
    }
    console.log(`Tool:      \x1b[1m\x1b[36m${toolName}\x1b[0m`);
    console.log(`Arguments: \x1b[90m${JSON.stringify(args, null, 2)}\x1b[0m`);

    if (diffPreview) {
      console.log(`\n\x1b[1m\x1b[36m--- Diff Preview ---\x1b[0m\n${diffPreview}\n\x1b[1m\x1b[36m--------------------\x1b[0m\n`);
    }

    const promptText = `\x1b[1mAuthorize this action? [y/N]: \x1b[0m`;

    return new Promise((resolve) => {
      if (rl) {
        rl.question(promptText, (answer) => {
          resolve(answer.trim().toLowerCase() === "y");
        });
      } else {
        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        tempRl.question(promptText, (answer) => {
          tempRl.close();
          resolve(answer.trim().toLowerCase() === "y");
        });
      }
    });
  }
}
