/**
 * Task Planner
 * Converts TaskAnalysis into an actionable plan, acceptance criteria,
 * and pre-populated TODO items for the agent.
 * Specification Reference: Section 2 (Target Architecture).
 */

import { TaskAnalysis } from "./types";

export interface PlannedTask {
  analysis: TaskAnalysis;
  formattedBriefing: string;
  todoItems: { id: string; content: string; status: "pending" | "in_progress" | "completed" }[];
  acceptanceCriteria: string[];
}

export class TaskPlanner {
  public static plan(analysis: TaskAnalysis): PlannedTask {
    const acceptanceCriteria: string[] = [];

    // Acceptance criteria from explicit requirements
    for (const req of analysis.requirements) {
      acceptanceCriteria.push(`Meets requirement: ${req}`);
    }

    // Acceptance criteria from verification commands
    if (analysis.discoveredVerification.testCommand) {
      acceptanceCriteria.push(`Passes test suite (${analysis.discoveredVerification.testCommand})`);
    }
    if (analysis.discoveredVerification.typecheckCommand) {
      acceptanceCriteria.push(`Passes typecheck (${analysis.discoveredVerification.typecheckCommand})`);
    }
    if (analysis.discoveredVerification.buildCommand) {
      acceptanceCriteria.push(`Builds successfully (${analysis.discoveredVerification.buildCommand})`);
    }
    if (analysis.forbiddenPaths.length > 0) {
      acceptanceCriteria.push(
        `Preserves forbidden paths: ${analysis.forbiddenPaths.join(", ")} untouched`
      );
    }

    // Generate TODO items
    const todoItems = analysis.suggestedPlan.map((step, idx) => ({
      id: `step-${idx + 1}`,
      content: step,
      status: "pending" as const
    }));

    // Generate Briefing for Agent System / User turn
    let briefing = `### Autonomous Task Execution Plan\n`;
    briefing += `**Category:** ${analysis.taskType.toUpperCase()}\n`;
    briefing += `**Primary Objective:** ${analysis.primaryObjective}\n\n`;

    briefing += `#### Explicit Requirements:\n`;
    for (const req of analysis.requirements) {
      briefing += `- ${req}\n`;
    }

    if (analysis.forbiddenPaths.length > 0) {
      briefing += `\n#### Constraints (Forbidden Paths):\n`;
      for (const p of analysis.forbiddenPaths) {
        briefing += `- Do NOT modify: \`${p}\`\n`;
      }
    }

    briefing += `\n#### Harness Verification Standard:\n`;
    for (const ac of acceptanceCriteria) {
      briefing += `- [ ] ${ac}\n`;
    }

    return {
      analysis,
      formattedBriefing: briefing,
      todoItems,
      acceptanceCriteria
    };
  }
}
