import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy } from "./types";

export interface SecretPattern {
  name: string;
  regex: RegExp;
}

export class SecretScanner implements GuardrailPolicy {
  name = "secretScanner";
  description = "Scans content, tool parameters, and logs for sensitive secrets and provides redaction.";

  private static patterns: SecretPattern[] = [
    { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{20,}/g },
    { name: "Anthropic API Key", regex: /sk-ant-api[a-zA-Z0-9_-]{20,}/g },
    { name: "Google API Key", regex: /AIzaSy[a-zA-Z0-9_-]{33}/g },
    { name: "GitHub Personal Access Token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
    { name: "AWS Access Key ID", regex: /AKIA[0-9A-Z]{16}/g },
    { name: "AWS Secret Access Key", regex: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi },
    { name: "Generic Private Key", regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g },
    { name: "Bearer Token", regex: /Bearer\s+[a-zA-Z0-9_.\-~+/=]{20,}/gi },
    { name: "Password Assignment", regex: /(?:password|passwd|pwd|secret)\s*[:=]\s*["']([^"'\s]{8,})["']/gi }
  ];

  /**
   * Redacts sensitive secret strings from any given text.
   */
  static redact(text: string): string {
    if (!text || typeof text !== "string") return text;
    let redacted = text;

    for (const pattern of SecretScanner.patterns) {
      redacted = redacted.replace(pattern.regex, (match) => {
        return `[REDACTED:${pattern.name}]`;
      });
    }

    return redacted;
  }

  /**
   * Scans text and returns all detected secret descriptions.
   */
  static scan(text: string): string[] {
    if (!text || typeof text !== "string") return [];
    const detections: string[] = [];

    for (const pattern of SecretScanner.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        detections.push(pattern.name);
      }
    }

    return detections;
  }

  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    if (!args) {
      return { decision: "ALLOW", risk: "LOW" };
    }

    // Inspect content or command text for secrets being passed
    const textToInspect: string[] = [];
    if (typeof args.content === "string") textToInspect.push(args.content);
    if (typeof args.command === "string") textToInspect.push(args.command);
    if (typeof args.text === "string") textToInspect.push(args.text);

    const findings: string[] = [];
    for (const content of textToInspect) {
      findings.push(...SecretScanner.scan(content));
    }

    if (findings.length > 0) {
      const unique = Array.from(new Set(findings));
      // Writing or executing hardcoded credentials should require authorization
      return {
        decision: context.autoConfirm ? "ALLOW" : "ASK",
        risk: "HIGH",
        reason: `Potential secrets detected in tool arguments: ${unique.join(", ")}`,
        violatingPolicy: this.name
      };
    }

    return { decision: "ALLOW", risk: "LOW" };
  }
}
