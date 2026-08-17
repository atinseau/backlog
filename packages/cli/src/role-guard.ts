// An execution agent gets its whole Backlog surface from the MCP server that
// its run spawns. The binary is on its PATH because we widen PATH for its own
// tooling, and BACKLOG_PROJECT_DIR points at the real project so its reads
// resolve — together those made `backlog task move <id> done` reachable from
// its shell, contradicting what the run prompt and trace_write both tell it.
//
// One rule, no sub-command allowlist: an allowlist has to be revisited every
// time a command is added, and an allowlist that drifts is how this started.
// The two exemptions below are not an allowlist in that sense — neither is a
// convenience, and each one exists because refusing it breaks something the
// refusal itself depends on.
//
// This is not airtight — `env -u BACKLOG_AGENT_ROLE backlog …` still works. It
// moves the CLI from advertised and one command away to explicitly refused.

/**
 * The run's own MCP server, which must survive the refusal.
 *
 * `claude` hands a stdio MCP server the parent environment: probed against
 * 2.1.234, a server declared through `--mcp-config` received `BACKLOG_AGENT_ROLE`
 * and an unrelated parent-only marker verbatim, with the declared `env` merged
 * on top rather than replacing it. So the server a run spawns starts under the
 * same role as the agent it serves. Refusing it would leave the agent with
 * neither the CLI nor the façade this refusal points it at — zero surface.
 *
 * Exempting the command rather than scrubbing the variable in the claude-code
 * provider keeps the property runtime-agnostic: it holds for any provider that
 * spawns `backlog mcp-server`, and does not rest on one third-party CLI's
 * undocumented environment-merge semantics.
 *
 * The cost is that an execution agent can start an `mcp-server --audience
 * orchestrator` and drive it by hand over stdio. That is strictly harder than
 * the `env -u` escape already accepted above, so it widens nothing in practice.
 */
export const EXEMPT_COMMAND = "mcp-server";

const REFUSAL = [
  "backlog: this command is unavailable to an execution agent.",
  "Use the tools on the `backlog` MCP server instead.",
].join("\n");

export function refuseWhenExecutionRole(
  env: Record<string, string | undefined>,
  argv: string[],
): string | null {
  if (env["BACKLOG_AGENT_ROLE"] !== "execution") return null;
  // The pre-commit hook execs this same binary and inherits the agent's
  // environment. Refusing it would not block the commit — the hook's failure
  // path allows the commit when Backlog is unavailable (install-hooks.ts) —
  // it would silently disable claim enforcement. The marker is exported by the
  // generated hook script itself, immediately before the claim check, not by
  // the shim: the shim is a generic launcher, and marking it would exempt
  // `.backlog/bin/backlog task move <id> done` too.
  if (env["BACKLOG_HOOK_INVOCATION"]) return null;
  // Commander parses `process.argv` from index 2, so that is where the
  // sub-command is — for a dev run and for the compiled binary alike.
  if (argv[2] === EXEMPT_COMMAND) return null;
  return REFUSAL;
}
