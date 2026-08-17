import { agentToolNames } from "../agent-tools.js";
import { READ_TOOLS } from "../mcp/read-tools.js";
import { orchestratorToolNames } from "../orchestrator-tools.js";
import type { AgentContext, AgentContextId } from "./types.js";

export type { AgentContext, AgentContextId, McpAudience } from "./types.js";

// Every permission decision about a model Backlog launches lives here, and
// nowhere else. It sits above MCP on purpose: the MCP server is a separate
// process that cannot observe whether the model in front of it has Bash, so a
// table living there could only answer a third of the question (spec §4, D4).

// A conversation with no checkout needs no tool at all. One list, shared by the
// two contexts that are conversations: they had drifted to 18 and 10 entries
// with no decision behind the gap.
const NO_BUILT_IN_TOOLS = [
  "Bash",
  "BashOutput",
  "KillBash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "ExitPlanMode",
  "ToolSearch",
  "SlashCommand",
  "Skill",
] as const;

const readToolNames = READ_TOOLS.map((tool) => tool.name);

export const CONTEXTS: Record<AgentContextId, AgentContext> = {
  // One coding run, unattended, in a worktree. It keeps every built-in tool:
  // it is here to write code, and taking Bash from it would take its job. The
  // closure targets the Backlog CLI, which Task 5 refuses outright.
  //
  // `Bash(backlog:*)` is Claude Code's own specifier syntax: the `:*` suffix is
  // an equivalent spelling of a trailing wildcard, so this reads as
  // `Bash(backlog *)` — any shell command whose first word is `backlog`. Deny
  // rules still apply under `bypassPermissions`, which is what a coding run
  // gets. It is a closure, not a lock: an absolute path, a `sh -c` wrapper or
  // an env-runner still reaches the binary, which is why the refusal that
  // actually binds lives in the CLI itself.
  execution: {
    mcpAudience: "execution",
    mcpTools: [...readToolNames, ...agentToolNames()],
    deniedBuiltins: ["Bash(backlog:*)"],
    userMcpServers: "visible",
    cliRole: "execution",
  },
  // The board's chat. A human is present, so the write tools keep their
  // confirmation gate; it drives the orchestrator and has no business in a
  // checkout.
  orchestrator: {
    mcpAudience: "orchestrator",
    mcpTools: orchestratorToolNames(),
    deniedBuiltins: [...NO_BUILT_IN_TOOLS],
    userMcpServers: "hidden",
    cliRole: null,
  },
  // A one-shot prompt: naming, refining, split planning. A question, not a
  // mission.
  completion: {
    mcpAudience: null,
    mcpTools: [],
    deniedBuiltins: [...NO_BUILT_IN_TOOLS],
    userMcpServers: "hidden",
    cliRole: null,
  },
};

export function contextFor(id: AgentContextId): AgentContext {
  return CONTEXTS[id];
}
