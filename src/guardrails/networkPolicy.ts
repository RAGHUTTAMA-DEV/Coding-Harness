import { GuardrailContext, GuardrailEvaluationResult, GuardrailPolicy } from "./types";

export interface NetworkPolicyOptions {
  allowedHosts?: string[];
  blockAllOutbound?: boolean;
}

export class NetworkPolicy implements GuardrailPolicy {
  name = "networkPolicy";
  description = "Guards outbound network operations, unauthorized hosts, and exfiltration attempts.";

  private allowedHosts: string[];
  private blockAllOutbound: boolean;

  private reverseShellPatterns: RegExp[] = [
    /\b(?:nc|ncat|netcat)\b.*-(?:e|c)\s+/i,
    /\/dev\/tcp\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d+/i,
    /\/dev\/udp\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d+/i,
    /python(?:\d)?\s+-c\s+.*(?:socket|connect).*pty\.spawn/i,
    /perl\s+-e\s+.*Socket.*exec/i,
    /ruby\s+-rsocket\s+-e/i
  ];

  private exfiltrationPatterns: RegExp[] = [
    /\b(?:curl|wget|fetch)\b.*(?:-d|--data|--upload-file|-T)\s+.*(?:\.env|id_rsa|credentials|shadow|passwd)/i,
    /\bcurl\b.*-F\s+.*(?:\.env|id_rsa|credentials)/i
  ];

  constructor(options: NetworkPolicyOptions = {}) {
    this.allowedHosts = options.allowedHosts || [
      "localhost",
      "127.0.0.1",
      "::1",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "bun.sh",
      "github.com",
      "api.github.com"
    ];
    this.blockAllOutbound = options.blockAllOutbound || false;
  }

  async evaluate(
    toolName: string,
    args: any,
    context: GuardrailContext
  ): Promise<GuardrailEvaluationResult> {
    if (!args) {
      return { decision: "ALLOW", risk: "LOW" };
    }

    const command = typeof args.command === "string" ? args.command : "";
    const url = typeof args.url === "string" ? args.url : "";

    // 1. Check for reverse shell attempts: STRICTLY DENIED
    for (const pattern of this.reverseShellPatterns) {
      if (pattern.test(command)) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Reverse shell or unauthorized socket connection detected: "${command}"`,
          violatingPolicy: this.name
        };
      }
    }

    // 2. Check for data exfiltration attempts: STRICTLY DENIED
    for (const pattern of this.exfiltrationPatterns) {
      if (pattern.test(command)) {
        return {
          decision: "DENY",
          risk: "CRITICAL",
          reason: `Potential data exfiltration command detected: "${command}"`,
          violatingPolicy: this.name
        };
      }
    }

    // 3. Inspect URLs if provided in tool args or curl/wget commands
    const targetUrl = url || this.extractUrlFromCommand(command);
    if (targetUrl) {
      if (this.blockAllOutbound) {
        return {
          decision: "DENY",
          risk: "HIGH",
          reason: `Outbound network access is disabled by policy: "${targetUrl}"`,
          violatingPolicy: this.name
        };
      }

      try {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();

        const isAllowed = this.allowedHosts.some(
          (allowed) => host === allowed.toLowerCase() || host.endsWith("." + allowed.toLowerCase())
        );

        if (!isAllowed) {
          return {
            decision: context.autoConfirm ? "ALLOW" : "ASK",
            risk: "HIGH",
            reason: `Outbound connection to unlisted external host "${host}" requires authorization.`
          };
        }
      } catch {
        // Not a standard URL
      }
    }

    return { decision: "ALLOW", risk: "LOW" };
  }

  private extractUrlFromCommand(cmd: string): string | null {
    const match = cmd.match(/https?:\/\/[^\s"'>]+/i);
    return match ? match[0] : null;
  }
}
