import * as readline from "readline";

export class PermissionGate {
  /**
   * Prompts the user for permission to execute a tool.
   * Prints the tool name and its arguments, and asks for [y/N] approval.
   */
  static async checkPermission(
    toolName: string,
    args: any,
    rl?: readline.Interface
  ): Promise<boolean> {
    const formattedArgs = JSON.stringify(args, null, 2);
    
    // Highlight the request using clean ANSI escape sequences
    console.log(`\n\x1b[1m\x1b[33m⚠️  Permission Request\x1b[0m`);
    console.log(`Tool:      \x1b[1m\x1b[36m${toolName}\x1b[0m`);
    console.log(`Arguments: \x1b[90m${formattedArgs.split("\n").join("\n           ")}\x1b[0m`);

    const promptText = `\x1b[1mAuthorize this action? [y/N]: \x1b[0m`;

    return new Promise((resolve) => {
      if (rl) {
        rl.question(promptText, (answer) => {
          const approved = answer.trim().toLowerCase() === "y";
          resolve(approved);
        });
      } else {
        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        tempRl.question(promptText, (answer) => {
          tempRl.close();
          const approved = answer.trim().toLowerCase() === "y";
          resolve(approved);
        });
      }
    });
  }
}
