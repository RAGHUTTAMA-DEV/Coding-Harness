import { exec } from "child_process";
import { Tool } from "./types";

export const bashTool: Tool = {
  name: "run_command",
  description: "Execute a shell command on the host machine. Returns the stdout and stderr combined.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run in the shell."
      }
    },
    required: ["command"]
  },
  isMutating: true,
  async run(args: { command: string }): Promise<string> {
    return new Promise((resolve) => {
      // Execute the command in the current working directory
      // We set a 60 second timeout to prevent infinite hangs
      const maxBuffer = 10 * 1024 * 1024; // 10MB buffer
      const timeout = 60000; // 60 seconds

      exec(args.command, { maxBuffer, timeout }, (error, stdout, stderr) => {
        const output = stdout + stderr;

        if (output.trim() === "") {
          if (error) {
            resolve(`Command failed with exit code ${error.code || "unknown"}. No output printed.`);
          } else {
            resolve("Command completed successfully with no output.");
          }
          return;
        }

        // Limit output to ~10,000 characters
        const MAX_OUTPUT = 10000;
        let formattedOutput = output;

        if (output.length > MAX_OUTPUT) {
          const keepLength = MAX_OUTPUT / 2;
          const omitted = output.length - (keepLength * 2);
          const start = output.substring(0, keepLength);
          const end = output.substring(output.length - keepLength);
          formattedOutput = `${start}\n\n... [Output truncated. ${omitted} characters omitted] ...\n\n${end}`;
        }

        if (error) {
          resolve(`Command failed with exit code ${error.code || "unknown"}.\nOutput:\n${formattedOutput}`);
        } else {
          resolve(`Command completed successfully.\nOutput:\n${formattedOutput}`);
        }
      });
    });
  }
};
