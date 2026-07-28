import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { GeminiClient, OllamaClient } from "../client";
import { Agent } from "../agent";
import { SessionStore } from "../session/sessionStore";

type ModelChoice = {
  label: string;
  provider: "ollama" | "gemini";
  model: string;
  buildClient: () => OllamaClient | GeminiClient;
};

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
  console.log("\x1b[1m\x1b[36m==================================================\x1b[0m");
  console.log("\x1b[1m\x1b[36m   🛸 Antigravity Agent Harness (v1)            \x1b[0m");
  console.log("\x1b[90m   Claude-Code style CLI built in TypeScript (Bun)\x1b[0m");
  console.log("\x1b[1m\x1b[36m==================================================\x1b[0m");

  const modelName = "qwen3:14b";
  const ollamaUrl = "http://127.0.0.1:11434/api/chat";

  loadEnvFile(path.resolve(process.cwd(), "src", ".env"));
  loadEnvFile(path.resolve(process.cwd(), ".env"));

  const availableModels: ModelChoice[] = [
    {
      label: `Ollama: ${modelName}`,
      provider: "ollama",
      model: modelName,
      buildClient: () => new OllamaClient(ollamaUrl, modelName)
    },
    {
      label: "Ollama: qwen3:8b",
      provider: "ollama",
      model: "qwen3:8b",
      buildClient: () => new OllamaClient(ollamaUrl, "qwen3:8b")
    },
    {
      label: "Ollama: llama3.1:8b",
      provider: "ollama",
      model: "llama3.1:8b",
      buildClient: () => new OllamaClient(ollamaUrl, "llama3.1:8b")
    },
    {
      label: "Gemini: gemini-1.5-flash",
      provider: "gemini",
      model: "gemini-1.5-flash",
      buildClient: () => new GeminiClient({ model: "gemini-1.5-flash" })
    },
    {
      label: "Gemini: gemini-1.5-pro",
      provider: "gemini",
      model: "gemini-1.5-pro",
      buildClient: () => new GeminiClient({ model: "gemini-1.5-pro" })
    },
    {
      label: "Gemini: gemini-3.1-flash-lite",
      provider: "gemini",
      model: "gemini-3.1-flash-lite",
      buildClient: () => new GeminiClient({ model: "gemini-3.1-flash-lite" })
    }
  ];

  let activeModelLabel = availableModels[0].label;
  try {
    const savedModelPath = path.resolve(process.cwd(), ".sessions", "active_model.txt");
    if (fs.existsSync(savedModelPath)) {
      const savedLabel = fs.readFileSync(savedModelPath, "utf-8").trim();
      const matched = availableModels.find(m => m.label === savedLabel);
      if (matched) {
        activeModelLabel = matched.label;
      }
    }
  } catch (e) {
    // Ignore loading errors
  }
  let activeClient = availableModels.find(m => m.label === activeModelLabel)!.buildClient();

  console.log(`\x1b[90mInitializing client connection to Ollama at ${ollamaUrl}...\x1b[0m`);

  // Verify connection by fetching model list
  try {
    const checkRes = await fetch("http://127.0.0.1:11434/api/tags");
    if (checkRes.ok) {
      console.log(`\x1b[32m✔ Connected to Ollama successfully!\x1b[0m`);
    } else {
      console.log(`\x1b[33m⚠️  Ollama response not OK (${checkRes.status}). Ensure Ollama is running.\x1b[0m`);
    }
  } catch (err: any) {
    console.log(`\x1b[31m✖ Could not connect to Ollama. Is it running? Error: ${err.message}\x1b[0m`);
    console.log(`\x1b[90mContinuing anyway...\x1b[0m\n`);
  }

  // Set up readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const agent = new Agent({ client: activeClient, rl, tokenThreshold: 8000 });

  // Manage sessions
  let currentSessionId = `session_${Date.now()}`;
  const latestSessionId = await SessionStore.getLatestSessionId();
  if (latestSessionId) {
    const resumeAnswer = await new Promise<string>((resolve) => {
      rl.question(`\n\x1b[1m\x1b[33mFound a previous session: "${latestSessionId}". Resume it? [y/N]: \x1b[0m`, (answer) => {
        resolve(answer.trim().toLowerCase());
      });
    });

    if (resumeAnswer === "y") {
      const loadedHistory = await SessionStore.loadSession(latestSessionId);
      if (loadedHistory.length > 0) {
        agent.setHistory(loadedHistory);
        currentSessionId = latestSessionId;
        console.log(`\x1b[32m✔ Resumed session "${latestSessionId}".\x1b[0m\n`);
      } else {
        console.log(`\x1b[31m✖ Failed to load history from "${latestSessionId}". Starting new session.\x1b[0m\n`);
      }
    } else {
      console.log(`\x1b[90mStarting a new session.\x1b[0m\n`);
    }
  }

  const printModelMenu = () => {
    console.log("\n\x1b[1m\x1b[36mAvailable models\x1b[0m");
    availableModels.forEach((choice, index) => {
      const currentMark = choice.label === activeModelLabel ? " \x1b[32m(current)\x1b[0m" : "";
      console.log(`${index + 1}. ${choice.label}${currentMark}`);
    });
    console.log("\x1b[90mType a number to switch, or press Enter to keep the current model.\x1b[0m");
  };

  const selectModel = async () => {
    printModelMenu();

    const answer = await new Promise<string>((resolve) => {
      rl.question("\x1b[1m\x1b[35mmodel selection>\x1b[0m ", (value) => resolve(value.trim()));
    });

    if (answer === "") {
      console.log(`\x1b[90mKeeping ${activeModelLabel}.\x1b[0m\n`);
      return;
    }

    const selectedIndex = Number.parseInt(answer, 10);
    if (!Number.isNaN(selectedIndex) && selectedIndex >= 1 && selectedIndex <= availableModels.length) {
      const choice = availableModels[selectedIndex - 1];
      activeClient = choice.buildClient();
      agent.setClient(activeClient);
      activeModelLabel = choice.label;
      console.log(`\x1b[32m✔ Switched to ${choice.label}.\x1b[0m\n`);

      // Persist the selection to disk
      try {
        const dir = path.resolve(process.cwd(), ".sessions");
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, "active_model.txt"), choice.label, "utf-8");
      } catch (e) {
        // Ignore saving errors
      }
      return;
    }

    console.log("\x1b[33mInvalid selection. Use /models again and choose a listed number.\x1b[0m\n");
  };

  // Handle Ctrl+C (SIGINT) to steer the agent during execution
  rl.on("SIGINT", () => {
    if (agent.isRunning) {
      if (agent.isInterrupted) {
        console.log("\n\x1b[31m✖ Exiting immediately...\x1b[0m");
        rl.close();
        process.exit(0);
      } else {
        console.log("\n\x1b[33m⚠️  Interrupt received! The agent will pause at the next turn. Press Ctrl+C again to force exit.\x1b[0m");
        agent.isInterrupted = true;
      }
    } else {
      console.log("\n\x1b[36mGoodbye! 🛸\x1b[0m");
      rl.close();
      process.exit(0);
    }
  });

  console.log(`\x1b[90mUsing model: \x1b[36m${activeModelLabel}\x1b[0m`);
  console.log(`\x1b[90mType \x1b[33m'exit'\x1b[90m or \x1b[33m'quit'\x1b[90m to close, \x1b[33m'clear'\x1b[90m to reset conversation history, \x1b[33m'/models'\x1b[90m to switch models, and \x1b[33m'/mode'\x1b[90m to toggle execution mode (parallel/sequential).\x1b[0m\n`);

  const promptUser = () => {
    rl.question("\x1b[1m\x1b[35mantigravity>\x1b[0m ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\n\x1b[36mGoodbye! 🛸\x1b[0m");
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === "clear") {
        agent.clearHistory();
        await SessionStore.deleteSession(currentSessionId);
        currentSessionId = `session_${Date.now()}`;
        console.log("\x1b[32m✔ Conversation history cleared and session deleted.\x1b[0m\n");
        promptUser();
        return;
      }

      if (trimmed.toLowerCase() === "/models") {
        try {
          await selectModel();
        } catch (error: any) {
          console.error(`\n\x1b[31m✖ Could not switch models: ${error.message}\x1b[0m\n`);
        }
        promptUser();
        return;
      }

      if (trimmed.toLowerCase() === "/mode") {
        const currentMode = agent.getToolExecutionMode();
        const nextMode = currentMode === "parallel" ? "sequential" : "parallel";
        agent.setToolExecutionMode(nextMode);
        console.log(`\x1b[32m✔ Switched tool execution mode to: \x1b[1m\x1b[36m${nextMode}\x1b[0m\n`);
        promptUser();
        return;
      }

      if (trimmed === "") {
        promptUser();
        return;
      }

      try {
        let isThinking = false;

        await agent.run(trimmed, {
          onThinkingChunk: (chunk) => {
            if (!isThinking) {
              process.stdout.write("\n\x1b[90m[Thinking...]\n");
              isThinking = true;
            }
            process.stdout.write(chunk);
          },
          onTextChunk: (chunk) => {
            if (isThinking) {
              process.stdout.write("\x1b[0m\n\n");
              isThinking = false;
            }
            process.stdout.write(chunk);
          },
          onToolCall: (toolCall) => {
            if (isThinking) {
              process.stdout.write("\x1b[0m\n\n");
              isThinking = false;
            }
            console.log(`\n\x1b[36m⚙️  Calling tool: \x1b[1m${toolCall.function.name}\x1b[0m...`);
          },
          onToolResult: (toolCall, result) => {
            console.log(`\x1b[32m✔ Tool '${toolCall.function.name}' returned ${result.length} characters.\x1b[0m`);
          },
          onCompaction: (summary) => {
            console.log(`\n\x1b[1m\x1b[33m📦 Context Compaction Triggered!\x1b[0m`);
            console.log(`\x1b[90mThe older conversation history has been folded into a single summary block to stay within context constraints:\x1b[0m`);
            console.log(`\x1b[33m${summary}\x1b[0m\n`);
          },
          onStaleReadInvalidated: (filePath) => {
            console.log(`\x1b[90m[Invalidated previous file read for: ${filePath} (stale content)]\x1b[0m`);
          }
        });

        // Save session history to disk
        await SessionStore.saveSession(currentSessionId, agent.getHistory());

        // Ensure coloring reset if stream ends while thinking
        if (isThinking) {
          process.stdout.write("\x1b[0m\n");
        }
        console.log("\n");
        
        // Print token statistics and execution mode
        const totalTokens = agent.getTotalTokens();
        const threshold = agent.getTokenThreshold();
        const mode = agent.getToolExecutionMode();
        console.log(`\x1b[90mSession Tokens: \x1b[36m${totalTokens}\x1b[90m / \x1b[33m${threshold}\x1b[90m | Mode: \x1b[36m${mode}\x1b[0m\n`);
      } catch (error: any) {
        console.error(`\n\x1b[31m✖ Error running agent: ${error.message}\x1b[0m\n`);
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
