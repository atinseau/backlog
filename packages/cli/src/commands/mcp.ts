import { Command } from "commander";
import { findProject } from "@backlog/config";
import { AGENT_ROLE_ENV, EXECUTION_ROLE } from "../role-guard.js";
import {
  CATALOG,
  callCatalogTool,
  contextFor,
  serveMcpOnProcessStdio,
  type McpAudience,
  type McpToolHost,
} from "@backlog/core";

// Serves Backlog's tools over MCP so `claude -p --mcp-config` can drive them.
// Not a command users run by hand: the chat spawns it for the orchestrator set,
// and a coding run spawns it for the execution set. stdout is the protocol
// channel, so nothing may ever be printed there.
//
// Two audiences over one transport, and the default is the *less* privileged
// one on purpose. A caller that forgets --audience should lose tools, not gain
// the ability to start runs: an execution agent holding `start_subtask` could
// launch further runs and duplicate itself (spec §2).
//
// What each audience resolves to is decided by the context table in
// `@backlog/core` — the audience name is the only thing this command owns.

const AUDIENCES: McpAudience[] = ["execution", "orchestrator"];

export function parseAudience(value: string | undefined): McpAudience {
  if (value === undefined) return "execution";
  const candidate = value.trim() as McpAudience;
  if (!AUDIENCES.includes(candidate)) {
    throw new Error(`Unknown --audience '${value}'. Expected one of: ${AUDIENCES.join(", ")}.`);
  }
  return candidate;
}

export function mcpHostFor(backlogDir: string, audience: McpAudience): McpToolHost {
  const names = new Set(contextFor(audience).mcpTools);
  return {
    tools: CATALOG.filter((tool) => names.has(tool.name)).map((tool) => ({ ...tool })),
    // The server refusing on its own account: it must not depend on its caller
    // having advertised honestly. Omitting an orchestration tool from `tools`
    // is not the same as refusing the call.
    callTool: (name, input) =>
      names.has(name)
        ? callCatalogTool({ backlogDir, name, input })
        : Promise.resolve({ ok: false, result: { error: `Unknown tool: ${name}.` } }),
  };
}

/**
 * Everything the command does before it starts serving: parse the audience,
 * resolve the project, build the matching host. Exported because `.action()` is
 * the only place `parseAudience` and `mcpHostFor` meet — testing them apart
 * leaves the wiring between them, which is where a hardcoded audience would
 * hide, covered by nothing.
 */
export function resolveMcpHost(
  options: { project?: string; audience?: string },
  // Defaulted rather than read inline so a test can pin the role without
  // mutating process.env in a suite that shares one process.
  role: string | undefined = process.env[AGENT_ROLE_ENV],
): McpToolHost {
  const audience = parseAudience(options.audience);
  // The role guard exempts `mcp-server` so that a run's own server survives
  // the refusal — otherwise an execution agent would lose the CLI *and* the
  // façade the refusal points it at. Left there, the exemption would have sold
  // the orchestrator set, `start_subtask` included, for the price of speaking
  // JSON-RPC by hand: exactly the capability this whole branch exists to deny.
  // So the exemption covers the tool set the agent already has, not a wider one.
  // Nothing legitimate is caught: a run passes --audience execution, and the
  // chat's server is spawned from `backlog serve`, which the role refuses.
  if (role === EXECUTION_ROLE && audience !== EXECUTION_ROLE) {
    throw new Error(
      `An execution agent may only serve the 'execution' tool set, not '${audience}'.`,
    );
  }
  const project = findProject(options.project ?? process.cwd());
  if (!project) {
    throw new Error("No .backlog project found. Pass --project or run from inside one.");
  }
  return mcpHostFor(project.backlogDir, audience);
}

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp-server")
    .description("Serve Backlog's tools over MCP on stdio (spawned by a run or the chat, not run by hand)")
    .option("--project <path>", "Project to operate on. Defaults to the one resolved from the working directory.")
    .option(
      "--audience <who>",
      "Which tool set to serve: 'execution' (an agent on one ticket) or 'orchestrator' (the chat). Defaults to 'execution'.",
    )
    .action(async (options: { project?: string; audience?: string }) => {
      await serveMcpOnProcessStdio(resolveMcpHost(options));
    });
}
