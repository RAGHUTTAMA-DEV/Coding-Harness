#!/usr/bin/env bun
import * as path from "path";
import * as fs from "fs";
import { McpServerRegistry } from "../mcp/serverRegistry";
import { McpManager } from "../mcp/manager";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "--help";

  const configPath = path.resolve(process.cwd(), ".mcp.json");
  const registry = new McpServerRegistry([], configPath);
  registry.loadFromFile();

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(`
CODING-HARNESS MCP (Model Context Protocol) CLI

Usage:
  harness mcp list                     List all configured MCP servers and their status
  harness mcp tools                    Connect to active servers and list discovered tools
  harness mcp add <id> <command> [args...] Register a new MCP server configuration
  harness mcp remove <id>              Remove an MCP server configuration
  harness mcp test <id>                Test connection and tool discovery for a server
`);
    return;
  }

  if (command === "list") {
    const servers = registry.getAllServers();
    console.log(`\n\x1b[1m\x1b[36m=== CONFIGURED MCP SERVERS (${configPath}) ===\x1b[0m`);
    if (servers.length === 0) {
      console.log(`No MCP servers configured yet. Add one using: harness mcp add <id> <command> [args...]`);
      return;
    }

    console.log("─────────────────────────────────────────────────────────────────────────────");
    console.log(" ID               | STATUS   | COMMAND                                      ");
    console.log("─────────────────────────────────────────────────────────────────────────────");
    for (const s of servers) {
      const id = s.id.padEnd(17, " ").slice(0, 17);
      const status = (s.disabled ? "DISABLED" : "ENABLED").padEnd(9, " ");
      const cmd = `${s.command} ${(s.args || []).join(" ")}`.slice(0, 45);
      console.log(` ${id}| ${status}| ${cmd}`);
    }
    console.log("─────────────────────────────────────────────────────────────────────────────\n");
    return;
  }

  if (command === "tools") {
    const manager = new McpManager({ registry });
    console.log(`\n\x1b[90mConnecting to configured MCP servers...\x1b[0m`);
    const { connected, failed } = await manager.connectAll();

    for (const f of failed) {
      console.error(`\x1b[31m✖ Failed to connect to server "${f.id}": ${f.error}\x1b[0m`);
    }

    const tools = await manager.discoverAllTools();
    console.log(`\n\x1b[1m\x1b[32m=== DISCOVERED MCP TOOLS (${tools.length} total) ===\x1b[0m`);
    if (tools.length === 0) {
      console.log(`No tools discovered from connected servers.`);
    } else {
      console.log("─────────────────────────────────────────────────────────────────────────────");
      console.log(" TOOL NAME                       | MUTATING | DESCRIPTION                     ");
      console.log("─────────────────────────────────────────────────────────────────────────────");
      for (const t of tools) {
        const name = t.name.padEnd(33, " ").slice(0, 33);
        const mut = (t.isMutating ? "YES" : "NO").padEnd(9, " ");
        const desc = (t.description || "").slice(0, 32);
        console.log(` ${name}| ${mut}| ${desc}`);
      }
      console.log("─────────────────────────────────────────────────────────────────────────────\n");
    }

    await manager.disconnectAll();
    return;
  }

  if (command === "add") {
    const id = args[1];
    const serverCommand = args[2];
    const serverArgs = args.slice(3);

    if (!id || !serverCommand) {
      console.error("Usage: harness mcp add <id> <command> [args...]");
      process.exit(1);
    }

    registry.registerServer({
      id,
      command: serverCommand,
      args: serverArgs
    });
    registry.saveToFile();
    console.log(`\x1b[32m✔ Registered MCP server "${id}". Saved to ${configPath}\x1b[0m`);
    return;
  }

  if (command === "remove") {
    const id = args[1];
    if (!id) {
      console.error("Usage: harness mcp remove <id>");
      process.exit(1);
    }

    const removed = registry.unregisterServer(id);
    if (removed) {
      registry.saveToFile();
      console.log(`\x1b[32m✔ Removed MCP server "${id}".\x1b[0m`);
    } else {
      console.log(`\x1b[33mServer "${id}" not found in registry.\x1b[0m`);
    }
    return;
  }

  if (command === "test") {
    const id = args[1];
    if (!id) {
      console.error("Usage: harness mcp test <id>");
      process.exit(1);
    }

    const manager = new McpManager({ registry });
    console.log(`Connecting to "${id}"...`);
    try {
      const client = await manager.connectServer(id);
      console.log(`\x1b[32m✔ Connected!\x1b[0m Protocol: ${client.getProtocolVersion()}, Server: ${JSON.stringify(client.getServerInfo())}`);
      const tools = await manager.discoverTools(id);
      console.log(`Discovered ${tools.length} tool(s):`);
      for (const t of tools) {
        console.log(` - ${t.name}: ${t.description}`);
      }
      await manager.disconnectServer(id);
      console.log(`\x1b[32m✔ Test completed successfully.\x1b[0m`);
    } catch (err: any) {
      console.error(`\x1b[31m✖ Error testing server "${id}": ${err.message}\x1b[0m`);
      process.exit(1);
    }
    return;
  }

  console.error(`Unknown MCP command: "${command}". Run "harness mcp --help" for usage.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
