#!/usr/bin/env bun
import * as path from "path";
import * as fs from "fs";
import { TaskLoader } from "../evals/taskLoader";
import { EvalRunner } from "../evals/evalRunner";
import { ReportGenerator } from "../evals/reports/reportGenerator";
import { GeminiClient, OllamaClient } from "../client";
import { EvalResult } from "../evals/types";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main() {
  const harnessRoot = path.resolve(import.meta.dir, "../..");
  loadEnvFile(path.resolve(harnessRoot, "src", ".env"));
  loadEnvFile(path.resolve(harnessRoot, ".env"));

  const args = process.argv.slice(2);
  const command = args[0] || "--help";

  const taskLoader = new TaskLoader();

  if (command === "list") {
    const dataset = args[1] || "coding-harness-v1";
    const tasks = taskLoader.loadDataset(dataset);

    console.log(`\n\x1b[1m\x1b[36m=== CODING-HARNESS BENCHMARK TASKS (${dataset}) ===\x1b[0m`);
    if (tasks.length === 0) {
      console.log(`No tasks found for dataset "${dataset}".`);
      return;
    }

    console.log("────────────────────────────────────────────────────────────────────────");
    console.log(" ID               | CATEGORY        | DIFF | DESCRIPTION                ");
    console.log("────────────────────────────────────────────────────────────────────────");
    for (const t of tasks) {
      const id = t.id.padEnd(17, " ").slice(0, 17);
      const cat = t.category.padEnd(16, " ").slice(0, 16);
      const diff = (t.difficulty || "L1").padEnd(5, " ");
      const desc = t.description.slice(0, 30);
      console.log(` ${id}| ${cat}| ${diff}| ${desc}`);
    }
    console.log("────────────────────────────────────────────────────────────────────────\n");
    return;
  }

  if (command === "report") {
    const runId = args[1];
    if (!runId) {
      console.error("Usage: bun run eval report <run-id>");
      process.exit(1);
    }
    const runner = new EvalRunner();
    const results = runner.getSavedResults(runId);
    if (results.length === 0) {
      console.error(`No evaluation results found for runId: "${runId}".`);
      process.exit(1);
    }

    for (const r of results) {
      console.log(ReportGenerator.generateReport(r, true));
    }
    return;
  }

  if (command === "run") {
    let dataset = "coding-harness-v1";
    let targetTaskId: string | undefined;
    let targetCategory: string | undefined;
    let jsonMode = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--task" && i + 1 < args.length) {
        targetTaskId = args[i + 1];
        i++;
      } else if (args[i] === "--category" && i + 1 < args.length) {
        targetCategory = args[i + 1];
        i++;
      } else if (args[i] === "--json") {
        jsonMode = true;
      } else if (!args[i].startsWith("-")) {
        dataset = args[i];
      }
    }

    // Resolve client
    let client;
    if (process.env.GEMINI_API_KEY) {
      client = new GeminiClient({ model: "gemini-2.5-flash" });
    } else {
      client = new OllamaClient("http://127.0.0.1:11434/api/chat", "qwen3:14b");
    }

    let tasks = taskLoader.loadDataset(dataset);

    if (targetTaskId) {
      tasks = tasks.filter((t) => t.id === targetTaskId);
      if (tasks.length === 0) {
        console.error(`Task with ID "${targetTaskId}" not found.`);
        process.exit(1);
      }
    } else if (targetCategory) {
      tasks = tasks.filter((t) => t.category === targetCategory);
      if (tasks.length === 0) {
        console.error(`No tasks found for category "${targetCategory}".`);
        process.exit(1);
      }
    }

    if (tasks.length === 0) {
      console.error(`No tasks to evaluate in dataset "${dataset}".`);
      process.exit(1);
    }

    const runner = new EvalRunner({ client });
    const results: EvalResult[] = [];

    console.log(`\n\x1b[1m🚀 Starting Evaluation Suite: ${tasks.length} task(s)\x1b[0m\n`);

    for (const task of tasks) {
      console.log(`▶ Running task: ${task.id} (${task.description})...`);
      const result = await runner.runTask(task);
      results.push(result);

      if (!jsonMode) {
        console.log(ReportGenerator.generateReport(result, true));
        console.log("");
      }
    }

    if (jsonMode) {
      console.log(JSON.stringify(results, null, 2));
    } else if (results.length > 1) {
      console.log(ReportGenerator.generateSummary(results));
    }

    const anyFailed = results.some((r) => r.status === "failed");
    process.exit(anyFailed ? 1 : 0);
  }

  console.log(`
CODING-HARNESS EVALUATION CLI

Usage:
  bun run eval list [dataset]                 List tasks in dataset (default: coding-harness-v1)
  bun run eval run [dataset] [options]        Execute benchmark evaluation run
  bun run eval report <run-id>                Display report for a past evaluation run

Run Options:
  --task <id>           Run evaluation for a single task ID
  --category <cat>      Run evaluation for tasks in a category
  --json                Output results in JSON format
`);
}

main().catch((err) => {
  console.error("Evaluation CLI failed:", err);
  process.exit(1);
});
