import { Command } from "commander";
import { findProject } from "@backlog/config";
import {
  ORCHESTRATOR_TOOLS,
  callOrchestratorTool,
  serveMcpOnProcessStdio,
  type McpToolHost,
} from "@backlog/core";

// Exposes the orchestrator tools over MCP so `claude -p --mcp-config` can
// drive Backlog. Not a command users run by hand: the chat backend spawns it,
// and stdout is the protocol channel, so nothing may be printed there.

function hostFor(backlogDir: string): McpToolHost {
  return {
    tools: ORCHESTRATOR_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    callTool: (name, input) => callOrchestratorTool({ backlogDir, name, input }),
  };
}

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp-server")
    .description("Serve the orchestrator tools over MCP on stdio (used by the chat, not by hand)")
    .option("--project <path>", "Project to operate on. Defaults to the one resolved from the working directory.")
    .action(async (options: { project?: string }) => {
      const project = findProject(options.project ?? process.cwd());
      if (!project) {
        throw new Error("No .backlog project found. Pass --project or run from inside one.");
      }
      await serveMcpOnProcessStdio(hostFor(project.backlogDir));
    });
}
