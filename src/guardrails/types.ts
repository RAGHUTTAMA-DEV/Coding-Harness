export type PolicyDecision = "ALLOW" | "ASK" | "DENY";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface GuardrailContext {
  workspaceDir: string;
  autoConfirm?: boolean;
  allowedPaths?: string[];
  blockedCommands?: string[];
}

export interface GuardrailEvaluationResult {
  decision: PolicyDecision;
  risk: RiskLevel;
  reason?: string;
  violatingPolicy?: string;
  sanitizedArgs?: Record<string, any>;
}

export interface GuardrailPolicy {
  name: string;
  description: string;
  evaluate(toolName: string, args: any, context: GuardrailContext): Promise<GuardrailEvaluationResult>;
}
