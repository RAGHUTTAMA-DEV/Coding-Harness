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

async function interactiveSelect(
  rl: readline.Interface,
  options: { label: string; current: boolean }[],
  title: string
): Promise<number> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  const wasRaw = stdin.isRaw;
  
  // Save and temporarily disable SIGINT listeners on rl to prevent exiting the process on Ctrl+C
  const sigintListeners = rl.listeners("SIGINT");
  rl.removeAllListeners("SIGINT");

  rl.pause();
  stdin.resume();

  if (stdin.setRawMode) {
    stdin.setRawMode(true);
  }
  readline.emitKeypressEvents(stdin);

  let currentIndex = options.findIndex(o => o.current);
  if (currentIndex === -1) currentIndex = 0;

  const render = () => {
    // Hide cursor
    stdout.write("\x1B[?25l");
    stdout.write(`\r\n  \x1b[1m\x1b[36m${title}\x1b[0m\r\n`);
    options.forEach((opt, idx) => {
      const isSelected = idx === currentIndex;
      const isCurrentMark = opt.current ? " \x1b[32m(current)\x1b[0m" : "";
      if (isSelected) {
        stdout.write(`  \x1b[1m\x1b[38;5;45m➔ ${opt.label}${isCurrentMark}\x1b[0m\r\n`);
      } else {
        stdout.write(`    \x1b[90m${opt.label}${isCurrentMark}\x1b[0m\r\n`);
      }
    });
    stdout.write(`\x1B[${options.length + 2}A`);
  };

  render();

  return new Promise<number>((resolve) => {
    const onKeypress = (str: string, key: any) => {
      if (!key) return;

      if (key.name === "up" || key.name === "k") {
        currentIndex = (currentIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        currentIndex = (currentIndex + 1) % options.length;
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        stdout.write("\x1B[?25h");
        stdout.write("\r");
        for (let i = 0; i < options.length + 2; i++) {
          stdout.write("\x1B[2K\r\n");
        }
        stdout.write(`\x1B[${options.length + 2}A`);
        resolve(currentIndex);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        stdout.write("\x1B[?25h");
        stdout.write("\r");
        for (let i = 0; i < options.length + 2; i++) {
          stdout.write("\x1B[2K\r\n");
        }
        stdout.write(`\x1B[${options.length + 2}A`);
        resolve(-1);
      }
    };

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (stdin.setRawMode) {
        stdin.setRawMode(wasRaw);
      }
      rl.resume();
      // Restore SIGINT listeners
      sigintListeners.forEach(listener => rl.on("SIGINT", listener as any));
    };

    stdin.on("keypress", onKeypress);
  });
}


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
  console.log("\n\x1b[38;5;99m┌────────────────────────────────────────────────────────┐\x1b[0m");
  console.log("\x1b[38;5;99m│\x1b[0m   \x1b[1m\x1b[38;5;45m🛸 CODING-HARNESS (v1.2)\x1b[0m                 \x1b[38;5;99m│\x1b[0m");
  console.log("\x1b[38;5;99m│\x1b[0m   \x1b[90mThe Premium, Zero-Dependency Autonomous Coding CLI\x1b[0m   \x1b[38;5;99m│\x1b[0m");
  console.log("\x1b[38;5;99m└────────────────────────────────────────────────────────┘\x1b[0m");

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

  const selectModel = async () => {
    const options = availableModels.map(m => ({
      label: m.label,
      current: m.label === activeModelLabel
    }));

    const selectedIndex = await interactiveSelect(rl, options, "Select LLM Model / Provider:");

    if (selectedIndex === -1) {
      console.log(`\x1b[90mKeeping ${activeModelLabel}.\x1b[0m\n`);
      return;
    }

    const choice = availableModels[selectedIndex];
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

  console.log(`\x1b[38;5;244m🤖 Active Model: \x1b[38;5;45m\x1b[1m${activeModelLabel}\x1b[0m`);
  console.log(`\x1b[90mCommands:\x1b[0m`);
  console.log(`  \x1b[38;5;99m/models\x1b[0m \x1b[90m- Switch LLM models interactively\x1b[0m`);
  console.log(`  \x1b[38;5;99m/mode\x1b[0m   \x1b[90m- Toggle tool execution mode (parallel/sequential)\x1b[0m`);
  console.log(`  \x1b[38;5;99mclear\x1b[0m   \x1b[90m- Reset conversation history and session\x1b[0m`);
  console.log(`  \x1b[38;5;99mexit\x1b[0m    \x1b[90m- Exit the session\x1b[0m\n`);

  const promptUser = () => {
    rl.question("\x1b[1m\x1b[38;5;99m⚡ antigravity\x1b[0m \x1b[90m❯\x1b[0m ", async (input) => {
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
              process.stdout.write("\n\x1b[90m│ 💭 \x1b[3mThinking...\x1b[0m\r\n");
              isThinking = true;
            }
            const formatted = chunk.replace(/\n/g, "\r\n\x1b[90m│ \x1b[3m");
            process.stdout.write(`\x1b[90m\x1b[3m${formatted}\x1b[0m`);
          },
          onTextChunk: (chunk) => {
            if (isThinking) {
              process.stdout.write("\x1b[0m\r\n\r\n");
              isThinking = false;
            }
            process.stdout.write(chunk);
          },
          onToolCall: (toolCall) => {
            if (isThinking) {
              process.stdout.write("\x1b[0m\r\n\r\n");
              isThinking = false;
            }
            let summary = "";
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (args.CommandLine) {
                summary = ` \x1b[90m(${args.CommandLine})\x1b[0m`;
              } else if (args.TargetFile || args.AbsolutePath) {
                const p = args.TargetFile || args.AbsolutePath;
                summary = ` \x1b[90m(${path.basename(p)})\x1b[0m`;
              } else if (args.query) {
                summary = ` \x1b[90m("${args.query}")\x1b[0m`;
              }
            } catch (e) {}
            console.log(`\x1b[38;5;208m🔸 [Tool Call]\x1b[0m \x1b[1m${toolCall.function.name}\x1b[0m${summary}`);
          },
          onToolResult: (toolCall, result) => {
            console.log(`\x1b[38;5;121m🔹 [Tool Success]\x1b[0m \x1b[90mReturned ${result.length} characters\x1b[0m\n`);
          },
          onCompaction: (summary) => {
            console.log(`\n\x1b[1m\x1b[33m📦 [Context Compaction]\x1b[0m`);
            console.log(`\x1b[90mOlder conversation history folded into a summary block:\x1b[0m`);
            console.log(`\x1b[33m${summary}\x1b[0m\n`);
          },
          onStaleReadInvalidated: (filePath) => {
            console.log(`\x1b[90m[Invalidated previous file read: ${path.basename(filePath)} (stale content)]\x1b[0m`);
          }
        });

        // Save session history to disk
        await SessionStore.saveSession(currentSessionId, agent.getHistory());

        // Ensure coloring reset if stream ends while thinking
        if (isThinking) {
          process.stdout.write("\x1b[0m\n");
        }
        console.log("\n");
        
        // Print token statistics and execution mode dashboard
        const totalTokens = agent.getTotalTokens();
        const threshold = agent.getTokenThreshold();
        const mode = agent.getToolExecutionMode();
        const pct = Math.min(100, Math.round((totalTokens / threshold) * 100));
        const tokenBar = `Tokens: ${totalTokens}/${threshold} (${pct}%)`;
        const modeBadge = `Mode: ${mode.toUpperCase()}`;
        const sessionBadge = `Session: ${currentSessionId}`;
        
        const width = Math.max(40, Math.min(80, (process.stdout.columns || 60) - 2));
        console.log(`\x1b[90m${"─".repeat(width)}\x1b[0m`);
        console.log(`\x1b[38;5;244m📊 ${sessionBadge}  │  ${tokenBar}  │  ${modeBadge}\x1b[0m`);
        console.log(`\x1b[90m${"─".repeat(width)}\x1b[0m\n`);
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
