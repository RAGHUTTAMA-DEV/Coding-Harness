/**
 * Task Analyzer
 * Inspects user task prompts and the workspace environment to determine task categories,
 * extract acceptance criteria, and discover available verification commands.
 * Specification Reference: Section 2 (Target Architecture).
 */

import * as fs from "fs";
import * as path from "path";
import { DiscoveredVerification, TaskAnalysis, TaskType } from "./types";

export interface TaskAnalyzerOptions {
  workspaceDir?: string;
  defaultForbiddenPaths?: string[];
}

export class TaskAnalyzer {
  private workspaceDir: string;
  private defaultForbiddenPaths: string[];

  constructor(options: TaskAnalyzerOptions = {}) {
    this.workspaceDir = path.resolve(options.workspaceDir || process.cwd());
    this.defaultForbiddenPaths = options.defaultForbiddenPaths || [
      ".env",
      ".env.*",
      "node_modules",
      ".git"
    ];
  }

  /**
   * Analyze task prompt and workspace context
   */
  public analyze(prompt: string, explicitConstraints?: { forbiddenPaths?: string[] }): TaskAnalysis {
    const taskType = this.classifyTaskType(prompt);
    const primaryObjective = this.extractPrimaryObjective(prompt);
    const requirements = this.extractRequirements(prompt);
    const forbiddenPaths = Array.from(
      new Set([...this.defaultForbiddenPaths, ...(explicitConstraints?.forbiddenPaths || [])])
    );

    const discoveredVerification = this.discoverWorkspaceVerification();
    const suggestedPlan = this.generateSuggestedPlan(taskType, primaryObjective, discoveredVerification);

    return {
      taskType,
      summary: `${taskType.toUpperCase()}: ${primaryObjective}`,
      primaryObjective,
      requirements,
      forbiddenPaths,
      suggestedPlan,
      discoveredVerification
    };
  }

  /**
   * Classify the task into a standard category
   */
  public classifyTaskType(prompt: string): TaskType {
    const lower = prompt.toLowerCase();

    if (/\b(?:security|sanitize|xss|csrf|sql\s*injection|auth(?:entication)?|jwt|token|vulnerability)\b/i.test(lower)) {
      return "security";
    }
    if (/\b(?:fix|bug|defect|broken|error|exception|fails|failing|resolve\s+issue|patch)\b/i.test(lower)) {
      return "bug_fix";
    }
    if (/\b(?:debug|diagnose|investigate|root\s*cause|trace|reproduce)\b/i.test(lower)) {
      return "debugging";
    }
    if (/\b(?:refactor|cleanup|clean\s*up|restructure|modernize|simplify|decouple)\b/i.test(lower)) {
      return "refactor";
    }
    if (/\b(?:test|tests|test-writing|unit\s*test|integration\s*test|coverage)\b/i.test(lower)) {
      return "testing";
    }
    if (/\b(?:where\s+is|find|locate|explore|architecture|repo\s*navigation|map)\b/i.test(lower)) {
      return "repo_navigation";
    }
    if (/\b(?:pipeline|multi-step|migration|full\s*stack|schema\s+and\s+api)\b/i.test(lower)) {
      return "multi_step";
    }
    if (/\b(?:add|implement|feature|create|build|support|new\s+endpoint)\b/i.test(lower)) {
      return "feature";
    }

    return "general";
  }

  /**
   * Discover available verification commands by inspecting project files in workspace
   */
  public discoverWorkspaceVerification(): DiscoveredVerification {
    const discovered: DiscoveredVerification = {};

    // 1. Detect Package Manager
    if (fs.existsSync(path.join(this.workspaceDir, "bun.lock")) || fs.existsSync(path.join(this.workspaceDir, "bun.lockb"))) {
      discovered.packageManager = "bun";
    } else if (fs.existsSync(path.join(this.workspaceDir, "pnpm-lock.yaml"))) {
      discovered.packageManager = "pnpm";
    } else if (fs.existsSync(path.join(this.workspaceDir, "yarn.lock"))) {
      discovered.packageManager = "yarn";
    } else if (fs.existsSync(path.join(this.workspaceDir, "package.json"))) {
      discovered.packageManager = "npm";
    } else if (fs.existsSync(path.join(this.workspaceDir, "Cargo.toml"))) {
      discovered.packageManager = "cargo";
    } else if (fs.existsSync(path.join(this.workspaceDir, "pyproject.toml")) || fs.existsSync(path.join(this.workspaceDir, "requirements.txt"))) {
      discovered.packageManager = "python";
    }

    // 2. Node / JS / TS ecosystem
    const packageJsonPath = path.join(this.workspaceDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const scripts = pkg.scripts || {};
        const pm = discovered.packageManager || "npm";
        const runPrefix = pm === "npm" ? "npm run" : `${pm} run`;

        // Test command
        if (scripts.test && !scripts.test.includes("no test specified")) {
          discovered.testCommand = pm === "npm" ? "npm test" : `${pm} test`;
        }

        // Typecheck command
        if (scripts.typecheck) {
          discovered.typecheckCommand = `${runPrefix} typecheck`;
        } else if (fs.existsSync(path.join(this.workspaceDir, "tsconfig.json"))) {
          discovered.typecheckCommand = "npx tsc --noEmit";
        }

        // Build command
        if (scripts.build) {
          discovered.buildCommand = `${runPrefix} build`;
        }

        // Lint command
        if (scripts.lint) {
          discovered.lintCommand = `${runPrefix} lint`;
        }
      } catch {
        // Ignore JSON parse errors
      }
    } else if (discovered.packageManager === "cargo") {
      discovered.testCommand = "cargo test";
      discovered.typecheckCommand = "cargo check";
      discovered.buildCommand = "cargo build";
    } else if (discovered.packageManager === "python") {
      discovered.testCommand = "pytest";
    }

    return discovered;
  }

  private extractPrimaryObjective(prompt: string): string {
    const firstLine = prompt.split(/\r?\n/)[0].trim();
    return firstLine.slice(0, 100);
  }

  private extractRequirements(prompt: string): string[] {
    const lines = prompt.split(/\r?\n/);
    const requirements: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (/^[-*•]\s+/.test(line)) {
        requirements.push(line.replace(/^[-*•]\s+/, ""));
      } else if (/^\d+\.\s+/.test(line)) {
        requirements.push(line.replace(/^\d+\.\s+/, ""));
      }
    }

    if (requirements.length === 0) {
      requirements.push(this.extractPrimaryObjective(prompt));
    }

    return requirements;
  }

  private generateSuggestedPlan(
    taskType: TaskType,
    objective: string,
    verification: DiscoveredVerification
  ): string[] {
    const plan: string[] = [];

    plan.push(`1. Explore codebase to locate files relevant to: ${objective}`);
    plan.push("2. Read existing implementations and tests before making modifications");

    if (taskType === "bug_fix" || taskType === "debugging") {
      plan.push("3. Reproduce issue or analyze failing test assertions");
      plan.push("4. Implement minimal, targeted bug fix");
    } else {
      plan.push("3. Implement changes adhering strictly to project requirements");
    }

    if (verification.testCommand) {
      plan.push(`5. Verify tests pass (${verification.testCommand})`);
    }
    if (verification.typecheckCommand) {
      plan.push(`6. Verify static typecheck passes (${verification.typecheckCommand})`);
    }

    plan.push("7. Final verification check before harness certification");

    return plan;
  }
}
