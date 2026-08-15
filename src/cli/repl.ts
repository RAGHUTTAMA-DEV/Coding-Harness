import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { GeminiClient, OllamaClient } from "../client";
import { Agent } from "../agent";
import { SessionStore } from "../session/sessionStore";
import { tools } from "../tools";

type ModelChoice = {
  label: string;
  provider: "ollama" | "gemini";
  model: string;
  buildClient: () => OllamaClient | GeminiClient;
};

function printHeaderBanner(activeModelLabel: string) {
  const gold = "\x1b[38;5;220m";
  const dim = "\x1b[90m";
  const reset = "\x1b[0m";

  const columns = process.stdout.columns || 80;
  const toolCount = tools.length;

  const font1Line = [
    " ██████╗ ██████╗ ██████╗ ██╗███╗   ██╗██████╗     ██╗  ██╗█████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗",
    "██╔════╝██╔═══██╗██╔══██╗██║████╗  ██║██╔════╝    ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝",
    "██║     ██║   ██║██║  ██║██║██╔██╗ ██║██║  ███╗   ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗",
    "██║     ██║   ██║██║  ██║██║██║╚██╗██║██║   ██║   ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║",
    "╚██████╗╚██████╔╝██████╔╝██║██║ ╚████║╚██████╔╝   ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║",
    " ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝"
  ];

  const font2Line = [
    "     ██████╗  ██████╗  ██████╗  ██╗ ███╗   ██╗  ██████╗   ",
    "    ██╔════╝ ██╔═══██╗ ██╔══██╗ ██║ ████╗  ██║ ██╔════╝   ",
    "    ██║      ██║   ██║ ██║  ██║ ██║ ██╔██╗ ██║ ██║  ███╗  ",
    "    ██║      ██║   ██║ ██║  ██║ ██║ ██║╚██╗██║ ██║   ██║  ",
    "    ╚██████╗ ╚██████╔╝ ██████╔╝ ██║ ██║ ╚████║ ╚██████╔╝  ",
    "     ╚═════╝  ╚═════╝  ╚═════╝  ╚═╝ ╚═╝  ╚═══╝  ╚═════╝   ",
    " ██╗  ██╗█████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗",
    " ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝",
    " ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗",
    " ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║",
    " ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║",
    " ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝"
  ];

  const use1Line = columns >= 106;
  const bannerLines = use1Line ? font1Line : font2Line;
  const contentWidth = Math.max(...bannerLines.map((l) => l.length));
  const boxWidth = Math.max(contentWidth + 6, use1Line ? 104 : 66);

  const topBorder = `${gold}┌${"─".repeat(boxWidth - 2)}┐${reset}`;
  const bottomBorder = `${gold}└${"─".repeat(boxWidth - 2)}┘${reset}`;

  console.log();
  console.log(topBorder);

  for (const line of bannerLines) {
    const padTotal = boxWidth - 2 - line.length;
    const padLeft = Math.floor(padTotal / 2);
    const padRight = padTotal - padLeft;
    console.log(`${gold}│${reset}${" ".repeat(padLeft)}${gold}${line}${reset}${" ".repeat(padRight)}${gold}│${reset}`);
  }

  console.log(`${gold}│${reset}${" ".repeat(boxWidth - 2)}${gold}│${reset}`);

  const sub1 = "Temple of memory  ·  skills  ·  tools";
  const padSub1Left = Math.floor((boxWidth - 2 - sub1.length) / 2);
  const padSub1Right = boxWidth - 2 - sub1.length - padSub1Left;
  console.log(`${gold}│${reset}${" ".repeat(padSub1Left)}${dim}${sub1}${reset}${" ".repeat(padSub1Right)}${gold}│${reset}`);

  const cleanModelLabel = activeModelLabel.replace(/^(Ollama|Gemini):\s*/i, "");
  const sub2Text = `${cleanModelLabel}  ·  cli  ·  ${toolCount} tools  ·  `;
  const sub2Badge = "auto-allow ||";
  const sub2Length = sub2Text.length + sub2Badge.length;
  const padSub2Left = Math.floor((boxWidth - 2 - sub2Length) / 2);
  const padSub2Right = boxWidth - 2 - sub2Length - padSub2Left;

  console.log(
    `${gold}│${reset}${" ".repeat(padSub2Left)}${dim}${sub2Text}${reset}${gold}${sub2Badge}${reset}${" ".repeat(padSub2Right)}${gold}│${reset}`
  );

  console.log(bottomBorder);
  console.log();
  console.log(`  ${dim}exit    clear    /models    /mode    /session help${reset}`);
  console.log();
  console.log(`  ${gold}◆ System${reset}       ${dim}loading system prompt and memory${reset}`);
  console.log(`  ${gold}◆ Ready${reset}        ${dim}agent online${reset}`);
  console.log(`  ${gold}◆ System${reset}       ${dim}session store armed${reset}`);
  console.log();
}

async function interactiveSelect(
  rl: readline.Interface,
  options: { label: string; current: boolean }[],
  title: string
): Promise<number> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  const wasRaw = stdin.isRaw;
  const sigintListeners = rl.listeners("SIGINT");
  rl.removeAllListeners("SIGINT");

  rl.pause();
  stdin.resume();

  if (stdin.setRawMode) {
    stdin.setRawMode(true);
  }
  readline.emitKeypressEvents(stdin);

  let currentIndex = options.findIndex((o) => o.current);
  if (currentIndex === -1) currentIndex = 0;

  const render = () => {
    stdout.write("\x1B[?25l");
    stdout.write(`\r\n  \x1b[1m\x1b[36m${title}\x1b[0m\r\n`);
    options.forEach((opt, idx) => {
      const isSelected = idx === currentIndex;
      const isCurrentMark = opt.current ? " \x1b[32m(current)\x1b[0m" : "";
      if (isSelected) {
        stdout.write(`  \x1b[1m\x1b[38;5;220m➔ ${opt.label}${isCurrentMark}\x1b[0m\r\n`);
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
      sigintListeners.forEach((listener) => rl.on("SIGINT", listener as any));
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
      const matched = availableModels.find((m) => m.label === savedLabel);
      if (matched) {
        activeModelLabel = matched.label;
      }
    }
  } catch (e) {}
  let activeClient = availableModels.find((m) => m.label === activeModelLabel)!.buildClient();

  printHeaderBanner(activeModelLabel);

  console.log(`\x1b[90mInitializing client connection to Ollama at ${ollamaUrl}...\x1b[0m`);

  try {
    const checkRes = await fetch("http://127.0.0.1:11434/api/tags");
    if (checkRes.ok) {
      console.log(`  \x1b[32m✔ Connected to Ollama successfully!\x1b[0m`);
    } else {
      console.log(`  \x1b[33m⚠️  Ollama response not OK (${checkRes.status}). Ensure Ollama is running.\x1b[0m`);
    }
  } catch (err: any) {
    console.log(`  \x1b[31m✖ Could not connect to Ollama. Is it running? Error: ${err.message}\x1b[0m`);
    console.log(`  \x1b[90mContinuing anyway...\x1b[0m\n`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const agent = new Agent({ client: activeClient, rl, tokenThreshold: 8000 });

  let currentSessionId = `session_${Date.now()}`;
  const latestSessionId = await SessionStore.getLatestSessionId();
  if (latestSessionId) {
    const resumeAnswer = await new Promise<string>((resolve) => {
      rl.question(
        `\n  \x1b[38;5;220mFound a previous session: "${latestSessionId}". Resume it? [y/N]: \x1b[0m`,
        (answer) => {
          resolve(answer.trim().toLowerCase());
        }
      );
    });

    if (resumeAnswer === "y") {
      const loadedHistory = await SessionStore.loadSession(latestSessionId);
      if (loadedHistory.length > 0) {
        agent.setHistory(loadedHistory);
        currentSessionId = latestSessionId;
        console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90mResumed session "${latestSessionId}".\x1b[0m\n`);
      } else {
        console.log(`  \x1b[31m✖ Failed to load history from "${latestSessionId}". Starting new session.\x1b[0m\n`);
      }
    } else {
      console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90mStarted new session "${currentSessionId}".\x1b[0m\n`);
    }
  }

  const selectModel = async () => {
    const options = availableModels.map((m) => ({
      label: m.label,
      current: m.label === activeModelLabel
    }));

    const selectedIndex = await interactiveSelect(rl, options, "Select LLM Model / Provider:");

    if (selectedIndex === -1) {
      console.log(`  \x1b[90mKeeping ${activeModelLabel}.\x1b[0m\n`);
      return;
    }

    const choice = availableModels[selectedIndex];
    activeClient = choice.buildClient();
    agent.setClient(activeClient);
    activeModelLabel = choice.label;
    console.log(`  \x1b[32m✔ Switched to ${choice.label}.\x1b[0m\n`);

    try {
      const dir = path.resolve(process.cwd(), ".sessions");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, "active_model.txt"), choice.label, "utf-8");
    } catch (e) {}
  };

  rl.on("SIGINT", () => {
    if (agent.isRunning) {
      if (agent.isInterrupted) {
        console.log("\n  \x1b[31m✖ Exiting immediately...\x1b[0m");
        rl.close();
        process.exit(0);
      } else {
        console.log(
          "\n  \x1b[33m⚠️  Interrupt received! The agent will pause at the next turn. Press Ctrl+C again to force exit.\x1b[0m"
        );
        agent.isInterrupted = true;
      }
    } else {
      console.log("\n  \x1b[36mGoodbye! 🛸\x1b[0m");
      rl.close();
      process.exit(0);
    }
  });

  const promptUser = () => {
    rl.question("  \x1b[1m\x1b[38;5;220mYou\x1b[0m \x1b[90m· cli\x1b[0m \x1b[38;5;220m❯\x1b[0m ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\n  \x1b[36mGoodbye! 🛸\x1b[0m");
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === "clear") {
        agent.clearHistory();
        await SessionStore.deleteSession(currentSessionId);
        currentSessionId = `session_${Date.now()}`;
        console.log("  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90mConversation history cleared\x1b[0m\n");
        promptUser();
        return;
      }

      if (trimmed.toLowerCase() === "/models") {
        try {
          await selectModel();
        } catch (error: any) {
          console.error(`\n  \x1b[31m✖ Could not switch models: ${error.message}\x1b[0m\n`);
        }
        promptUser();
        return;
      }

      if (trimmed.toLowerCase() === "/mode") {
        const currentMode = agent.getToolExecutionMode();
        const nextMode = currentMode === "parallel" ? "sequential" : "parallel";
        agent.setToolExecutionMode(nextMode);
        console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90mSwitched execution mode to: \x1b[1m\x1b[36m${nextMode}\x1b[0m\n`);
        promptUser();
        return;
      }

      if (trimmed.toLowerCase().startsWith("/session")) {
        const parts = trimmed.split(/\s+/);
        const subCmd = parts[1] ? parts[1].toLowerCase() : "help";
        const subArg = parts.slice(2).join(" ");

        if (subCmd === "list") {
          const list = await SessionStore.listSessions();
          console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90msaved sessions:\x1b[0m`);
          if (list.length === 0) {
            console.log(`    \x1b[90m(no saved sessions)\x1b[0m`);
          } else {
            for (const s of list) {
              const isActive = s.id === currentSessionId ? " \x1b[32m(active)\x1b[0m" : "";
              console.log(`    \x1b[90m• ${s.id}${isActive}\x1b[0m`);
            }
          }
          console.log();
        } else if (subCmd === "switch") {
          if (!subArg) {
            console.log(`  \x1b[31m✖ Usage: /session switch <session_name>\x1b[0m\n`);
          } else {
            const loaded = await SessionStore.loadSession(subArg);
            currentSessionId = subArg;
            if (loaded.length > 0) {
              agent.setHistory(loaded);
              console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90msession → ${subArg}\x1b[0m`);
              console.log(`  \x1b[36m◆ Memory\x1b[0m       \x1b[90m${loaded.length} prior turns loaded\x1b[0m\n`);
            } else {
              agent.clearHistory();
              console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90msession → ${subArg}\x1b[0m`);
              console.log(`  \x1b[36m◆ Memory\x1b[0m       \x1b[90mNo prior turns\x1b[0m\n`);
            }
          }
        } else if (subCmd === "new") {
          currentSessionId = `session_${Date.now()}`;
          agent.clearHistory();
          console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90msession → ${currentSessionId}\x1b[0m`);
          console.log(`  \x1b[36m◆ Memory\x1b[0m       \x1b[90mNo prior turns\x1b[0m\n`);
        } else if (subCmd === "clear") {
          agent.clearHistory();
          await SessionStore.deleteSession(currentSessionId);
          console.log(`  \x1b[38;5;220m◆ Ready\x1b[0m        \x1b[90mCleared current session history\x1b[0m\n`);
        } else {
          console.log(`  \x1b[38;5;220m◆ System\x1b[0m       \x1b[90msession commands:\x1b[0m`);
          console.log(`    \x1b[38;5;220m/session list\x1b[0m           \x1b[90m- List all saved sessions\x1b[0m`);
          console.log(`    \x1b[38;5;220m/session switch <name>\x1b[0m  \x1b[90m- Switch to or create session <name>\x1b[0m`);
          console.log(`    \x1b[38;5;220m/session new\x1b[0m            \x1b[90m- Create a new session\x1b[0m`);
          console.log(`    \x1b[38;5;220m/session clear\x1b[0m          \x1b[90m- Clear current session history\x1b[0m\n`);
        }

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

        await SessionStore.saveSession(currentSessionId, agent.getHistory());

        if (isThinking) {
          process.stdout.write("\x1b[0m\n");
        }
        console.log("\n");

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
        console.error(`\n  \x1b[31m✖ Error running agent: ${error.message}\x1b[0m\n`);
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
