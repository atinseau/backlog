import { AGENT_TOOLS, callAgentTool } from "../agent-tools.js";
import { callOrchestratorTool, ORCHESTRATOR_TOOLS } from "../orchestrator-tools.js";
import { callReadTool, READ_TOOLS } from "./read-tools.js";
import type { McpToolDefinition, McpToolOutcome } from "./server.js";

// Every façade tool, read and write, agent and orchestrator, in one list. This
// module knows nothing about who may see one — that's an audience's job
// (`packages/cli/src/commands/mcp.ts`), not the catalogue's.

export const CATALOG: McpToolDefinition[] = [
  ...READ_TOOLS,
  ...AGENT_TOOLS,
  ...ORCHESTRATOR_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
];

export function catalogToolNames(): string[] {
  return CATALOG.map((tool) => tool.name);
}

/** Routes a call to the dispatcher that owns the name. Each dispatcher still
 *  refuses names it does not own, so this is routing, not authorization. */
export async function callCatalogTool(call: {
  backlogDir: string;
  name: string;
  input: unknown;
}): Promise<McpToolOutcome> {
  if (READ_TOOLS.some((tool) => tool.name === call.name)) return callReadTool(call);
  if (AGENT_TOOLS.some((tool) => tool.name === call.name)) return callAgentTool(call);
  return callOrchestratorTool(call);
}
