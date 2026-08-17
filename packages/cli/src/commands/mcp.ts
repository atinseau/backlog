import { Command } from "commander";
import { findProject } from "@backlog/config";
import {
  AGENT_TOOLS,
  ORCHESTRATOR_TOOLS,
  callAgentTool,
  callOrchestratorTool,
  serveMcpOnProcessStdio,
  type McpToolHost,
} from "@backlog/core";

// Serves Backlog's tools over MCP so `claude -p --mcp-config` can drive them.
// Not a command users run by hand: the chat spawns it for the orchestrator set,
// and a coding run spawns it for the agent set. stdout is the protocol channel,
// so nothing may ever be printed there.
//
// Two audiences over one transport, and the default is the *less* privileged
// one on purpose. A caller that forgets --audience should lose tools, not gain
// the ability to start runs: an execution agent holding `start_subtask` could
// launch further runs and duplicate itself (spec §2).

export type McpAudience = "agent" | "orchestrator";

const AUDIENCES: McpAudience[] = ["agent", "orchestrator"];

export function parseAudience(value: string | undefined): McpAudience {
  if (value === undefined) return "agent";
  const candidate = value.trim() as McpAudience;
  if (!AUDIENCES.includes(candidate)) {
    throw new Error(`Unknown --audience '${value}'. Expected one of: ${AUDIENCES.join(", ")}.`);
  }
  return candidate;
}

export function mcpHostFor(backlogDir: string, audience: McpAudience): McpToolHost {
  if (audience === "orchestrator") {
    return {
      tools: ORCHESTRATOR_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
      callTool: (name, input) => callOrchestratorTool({ backlogDir, name, input }),
    };
  }
  return {
    tools: AGENT_TOOLS.map((tool) => ({ ...tool })),
    callTool: (name, input) => callAgentTool({ backlogDir, name, input }),
  };
}

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp-server")
    .description("Serve Backlog's tools over MCP on stdio (spawned by a run or the chat, not run by hand)")
    .option("--project <path>", "Project to operate on. Defaults to the one resolved from the working directory.")
    .option(
      "--audience <who>",
      "Which tool set to serve: 'agent' (an execution agent on one ticket) or 'orchestrator' (the chat). Defaults to 'agent'.",
    )
    .action(async (options: { project?: string; audience?: string }) => {
      const audience = parseAudience(options.audience);
      const project = findProject(options.project ?? process.cwd());
      if (!project) {
        throw new Error("No .backlog project found. Pass --project or run from inside one.");
      }
      await serveMcpOnProcessStdio(mcpHostFor(project.backlogDir, audience));
    });
}
