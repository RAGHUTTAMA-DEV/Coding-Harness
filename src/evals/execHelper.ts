import { spawn } from "child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number = 60000
): Promise<ExecResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Determine shell based on platform
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const shellArgs = isWindows ? ["/d", "/s", "/c", cmd] : ["-c", cmd];

    let stdout = "";
    let stderr = "";
    let isSettled = false;

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env, CI: "true" },
      windowsVerbatimArguments: isWindows
    });

    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill error
        }
        resolve({
          stdout,
          stderr: stderr + `\n[Timeout after ${timeoutMs}ms]`,
          exitCode: 124,
          durationMs: Date.now() - startTime
        });
      }
    }, timeoutMs);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + `\n[Spawn error: ${err.message}]`,
          exitCode: 1,
          durationMs: Date.now() - startTime
        });
      }
    });

    child.on("close", (code) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
          durationMs: Date.now() - startTime
        });
      }
    });
  });
}
