#!/usr/bin/env bun
import * as fs from "fs";
import * as path from "path";
import { GeminiClient, OllamaClient } from "../client";
import { Agent } from "../agent";
import { McpServerRegistry } from "../mcp/serverRegistry";
import { McpManager } from "../mcp/manager";
import { PolicyEngine } from "../guardrails/policyEngine";

// 1. Redirect console output to stderr to keep stdout 100% clean for JSON output
console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "mcp") {
    const { spawnSync } = await import("child_process");
    const mcpCliPath = path.resolve(import.meta.dir, "mcp.ts");
    const res = spawnSync("bun", ["run", mcpCliPath, ...args.slice(1)], {
      stdio: "inherit"
    });
    process.exit(res.status ?? 0);
  }

  if (args[0] === "snapshot" || args[0] === "checkpoint") {
    const { spawnSync } = await import("child_process");
    const snapshotCliPath = path.resolve(import.meta.dir, "snapshot.ts");
    const res = spawnSync("bun", ["run", snapshotCliPath, ...args], {
      stdio: "inherit"
    });
    process.exit(res.status ?? 0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    const helpMessage = `
CODING-HARNESS (v1.2) - Headless Mode CLI

Usage:
  harness --task "<task-description>" --cwd <repo-path> [options]
  harness snapshot <create|list|restore|diff|delete> [options]
  harness checkpoint <create|list|restore> [options]
  harness mcp <list|tools|add|remove|test> [options]

Required Options for Task Execution:
  --task "<description>"  Clear description of the coding task to perform.
  --cwd <path>            Absolute path to the target repository/project directory.

Optional Options:
  --trace-id <id>         Trace ID for nested observability.
  --max-iterations <num>  Maximum number of agent iterations (default: 30).
  -h, --help              Show help message.
`;
    process.stdout.write(helpMessage + "\n");
    process.exit(0);
  }

  let task: string | undefined;
  let cwd: string | undefined;
  let traceId: string | undefined;
  let maxIterations: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--task" && i + 1 < args.length) {
      task = args[i + 1];
      i++;
    } else if (args[i] === "--cwd" && i + 1 < args.length) {
      cwd = args[i + 1];
      i++;
    } else if (args[i] === "--trace-id" && i + 1 < args.length) {
      traceId = args[i + 1];
      i++;
    } else if (args[i] === "--max-iterations" && i + 1 < args.length) {
      maxIterations = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!task || !cwd) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "failed",
          output: "",
          filesChanged: [],
          error: "Missing required arguments: --task and --cwd must be specified."
        },
        null,
        2
      ) + "\n"
    );
    process.exit(1);
  }

  // 2. Resolve paths and load environment configurations
  const harnessRoot = path.resolve(import.meta.dir, "../..");
  loadEnvFile(path.resolve(harnessRoot, "src", ".env"));
  loadEnvFile(path.resolve(harnessRoot, ".env"));

  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd)) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "failed",
          output: "",
          filesChanged: [],
          error: `Target working directory does not exist: ${resolvedCwd}`
        },
        null,
        2
      ) + "\n"
    );
    process.exit(1);
  }

  process.chdir(resolvedCwd);
  loadEnvFile(path.resolve(resolvedCwd, "src", ".env"));
  loadEnvFile(path.resolve(resolvedCwd, ".env"));

  // 3. Resolve active model and client
  const ollamaUrl = "http://127.0.0.1:11434/api/chat";
  const availableModels = [
    {
      label: "Ollama: qwen3:14b",
      buildClient: () => new OllamaClient(ollamaUrl, "qwen3:14b")
    },
    {
      label: "Ollama: qwen3:8b",
      buildClient: () => new OllamaClient(ollamaUrl, "qwen3:8b")
    },
    {
      label: "Ollama: llama3.1:8b",
      buildClient: () => new OllamaClient(ollamaUrl, "llama3.1:8b")
    },
    {
      label: "Gemini: gemini-1.5-flash",
      buildClient: () => new GeminiClient({ model: "gemini-1.5-flash" })
    },
    {
      label: "Gemini: gemini-2.5-flash",
      buildClient: () => new GeminiClient({ model: "gemini-2.5-flash" })
    },
    {
      label: "Gemini: gemini-3.1-flash-lite",
      buildClient: () => new GeminiClient({ model: "gemini-3.1-flash-lite" })
    }
  ];

  let activeModelLabel = "";
  try {
    const savedModelPath = path.resolve(harnessRoot, ".sessions", "active_model.txt");
    if (fs.existsSync(savedModelPath)) {
      activeModelLabel = fs.readFileSync(savedModelPath, "utf-8").trim();
    }
  } catch (e) {
    // Ignore loading error
  }

  let activeClient;
  if (activeModelLabel) {
    const matched = availableModels.find(m => m.label === activeModelLabel);
    if (matched) {
      activeClient = matched.buildClient();
    }
  }

  if (!activeClient) {
    if (process.env.GEMINI_API_KEY) {
      activeClient = new GeminiClient({ model: "gemini-1.5-flash" });
    } else {
      activeClient = new OllamaClient(ollamaUrl, "qwen3:14b");
    }
  }

  // 4. Auto-discover and connect configured MCP servers (e.g. DuckDuckGo)
  const mcpConfigCandidates = [
    path.resolve(resolvedCwd, ".mcp.json"),
    path.resolve(harnessRoot, ".mcp.json")
  ];
  const mcpConfigPath = mcpConfigCandidates.find(p => fs.existsSync(p));
  const mcpRegistry = new McpServerRegistry([], mcpConfigPath);
  if (mcpConfigPath) {
    mcpRegistry.loadFromFile();
  }

  const policyEngine = new PolicyEngine();
  const mcpManager = new McpManager({
    registry: mcpRegistry,
    policyEngine,
    getGuardrailContext: () => ({
      workspaceDir: resolvedCwd,
      autoConfirm: true
    })
  });

  const enabledServers = mcpRegistry.getEnabledServers();
  if (enabledServers.length > 0) {
    try {
      const { connected } = await mcpManager.connectAll();
      if (connected.length > 0) {
        await mcpManager.discoverAllTools();
        mcpManager.registerToolsWithHarness();
      }
    } catch {
      // Continue even if an optional MCP server fails
    }
  }

  // 5. Initialize agent and run the task to completion
  const agent = new Agent({
    client: activeClient,
    cwd: resolvedCwd,
    headless: true,
    autoConfirm: true,
    maxIterations: maxIterations ?? 30, // Safe default max iterations
    tokenThreshold: 8000,
    policyEngine,
    mcpManager
  });

  try {
    const finalOutput = await agent.run(task, {
      onThinkingChunk: (chunk) => {
        process.stderr.write(chunk);
      },
      onTextChunk: (chunk) => {
        process.stderr.write(chunk);
      },
      onToolCall: (toolCall) => {
        process.stderr.write(`\n[Tool Call] ${toolCall.function.name}\n`);
      },
      onToolResult: (toolCall, result) => {
        process.stderr.write(`[Tool Success] ${toolCall.function.name} (length: ${result.length})\n`);
      }
    });

    const result = {
      status: "success",
      output: finalOutput,
      filesChanged: agent.getFilesChanged()
    };

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(0);
  } catch (err: any) {
    const result = {
      status: "failed",
      output: "",
      filesChanged: agent.getFilesChanged(),
      error: err.message
    };

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(1);
  }
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify(
      {
        status: "failed",
        output: "",
        filesChanged: [],
        error: `Fatal error in headless run: ${err.message}`
      },
      null,
      2
    ) + "\n"
  );
  process.exit(1);
});
