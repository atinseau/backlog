# Agent context permissions — design

Status: **approved** · not started
Date: 2026-08-17
Prerequisites (both decided the same day, both separate PRs): remove the
`direct` execution mode; remove the Codex provider. Neither blocks the design,
but §9 assumes both have landed.
See also: [agent ticket tools](./2026-08-17-agent-ticket-tools-design.md) — this
spec generalises its §5/§6 tool sets into a table that also owns the built-in
tools, and supersedes its "least privilege is about what the model is handed"
caveat by closing the CLI door it documented.

---

## 1. The problem

Backlog hands an execution agent one MCP tool, `trace_write`, and tells it in
two places that it may not move its own ticket:

- `packages/core/src/agent-tools.ts:76` — *"You cannot mark your own work done"*
- `packages/core/src/run-prompt.ts:49` — *"Do not try to move the ticket
  yourself. The trace moves it"*

Both statements are false in practice. Four independent choices combine to make
them false:

1. `packages/core/src/providers/claude-code/command.ts:53-55` maps every
   non-`read-only` sandbox to `bypassPermissions`, so `Bash` runs unattended.
2. `packages/core/src/providers/claude-code/provider.ts:110-112` passes
   `--allowedTools` but no `--disallowedTools`: *"`--allowedTools` only
   auto-approves; it excludes nothing."*
3. `packages/core/src/providers/process.ts:9-27` widens `PATH` to
   `~/.local/bin`, `~/bin`, `/opt/homebrew/bin` — precisely where `install.sh`
   puts the `backlog` binary.
4. `packages/core/src/run-executor.ts:83` exports `BACKLOG_PROJECT_DIR` pointing
   at the real project, and `run-prompt.ts:30` advertises the CLI out loud.

So `backlog task move <id> done` and `backlog orchestrator start` are one shell
command away, for the whole duration of every run.

Point 4 deserves emphasis: it was added deliberately, and it is what made this
reliable. Before it, a `backlog` command run from a worktree resolved the shadow
`.backlog/` the worktree carries and missed the real project. That was an
accident, not a guard rail. Fixing it for reads fixed it for writes too.

### The second problem, found while measuring the first

There is no permission policy anywhere. There are three hand-written lists that
have drifted apart:

| Call site | Denied built-ins |
| --- | --- |
| `server/src/lib/chat/claude-code-chat.ts:26-45` | 18 |
| `core/src/providers/claude-code/provider.ts:30-41` | 10 |
| `core/src/providers/claude-code/provider.ts` (`buildRunCommand`) | 0 |

The 8-entry gap between the first two (`BashOutput`, `KillBash`, `MultiEdit`,
`NotebookEdit`, `ToolSearch`, `SlashCommand`, `Skill`, `ExitPlanMode`) is
justified nowhere. It is drift.

Answering "what can an execution agent do" today requires opening four files
across three packages and cross-referencing them.

---

## 2. What already exists

- **The MCP transport is sound and small.** `packages/core/src/mcp/` is 3.3 KB
  of server plus a stdio adapter, with an `McpToolHost` interface that a tool
  set plugs into.
- **Two audiences already exist.** `backlog mcp-server --audience
  <agent|orchestrator>` (`packages/cli/src/commands/mcp.ts`), defaulting to the
  less privileged set, with `packages/core/src/agent-tools.test.ts` asserting
  the two never intersect.
- **The tools call core services directly.** Neither `callAgentTool` nor
  `callOrchestratorTool` shells out; they call `recordTrace` and friends, which
  is exactly what the CLI commands do.
- **A run already gets an MCP server attached.** `buildRunCommand` passes
  `--mcp-config` with `--audience agent`.

Nothing here is thrown away. This design widens the tool sets, moves the policy
up one level, and closes the CLI.

---

## 3. Decisions and rationale

**D1 — The façade calls core services directly, not the CLI as a subprocess.**
The CLI is itself a thin shell over the same core services, so a subprocess
would respawn a 63 MB binary per tool call and re-parse text that was structured
one layer down. The cost is that façade and CLI can drift; §10 pays for it with
a coverage test rather than with a spawn.

**D2 — The CLI refuses everything under an execution role, with no
sub-command allowlist.** If the façade covers what an execution agent needs, the
binary has no reason to be reachable at all. One rule beats an allowlist that
must be revisited every time a command is added — and an allowlist that drifts
is how this problem was born.

**D3 — Façade tools map 1:1 onto CLI commands.** A mechanical correspondence is
auditable: for any command, either there is a tool of the same shape or there is
a deliberate absence. Grouping tools by intent would read better for the model
but would make coverage a judgement call.

**D4 — The permission table lives above MCP, not inside it.** The MCP server is
a separate process launched by the CLI. It cannot observe whether the model in
front of it has `Bash`, and it cannot enforce anything about built-in tools. A
table that lived there would answer only a third of the question. See §4.

**D5 — No speculative fields.** Path restrictions, token ceilings, network
policy and secret access are not in the table, because nothing consumes them
today. The type is a plain record; adding a field later breaks nothing.

**D6 — An execution agent keeps every built-in tool and the user's own MCP
servers.** It is there to write code: `Bash`, `Read`, `Write`, `Edit`, `Task`,
`WebFetch` are its job. The closure targets the Backlog CLI, not its craft.

---

## 4. The context table

A **context** is the complete description of what a model launched by Backlog
may do. Three exist, and they are the only three:

- `execution` — one coding run against one subtask, unattended, in a worktree.
- `orchestrator` — the board's chat drawer, with a human present.
- `completion` — a one-shot prompt (task naming, refinement, split planning).

```
packages/core/src/contexts/
  types.ts       what a context declares
  contexts.ts    the table
```

```ts
export interface AgentContext {
  /** Which Backlog tool set the MCP server should serve, or none. */
  mcpAudience: McpAudience | null;
  /** The tool names that audience resolves to. */
  mcpTools: readonly string[];
  /** Built-in tools the session may not use. */
  deniedBuiltins: readonly string[];
  /** Whether the user's own MCP servers stay reachable. */
  userMcpServers: "visible" | "hidden";
  /** Value exported as BACKLOG_AGENT_ROLE, or none. */
  cliRole: "execution" | null;
}
```

`permissionMode` is deliberately absent: it is already derived from the agent's
`sandbox_mode`, which is per-agent policy rather than per-context policy, and
duplicating it here would create a second source of truth for the same question.

### The table's content

| | `execution` | `orchestrator` | `completion` |
| --- | --- | --- | --- |
| `mcpAudience` | `execution` | `orchestrator` | `null` |
| Backlog tools | `task_show`, `subtask_show`, `trace_show`, `claim_list`, `trace_write` | the nine orchestration tools | none |
| `mcpTools` | the five | the nine | none |
| `deniedBuiltins` | `Bash(backlog:*)` only | the full list | the full list |
| `userMcpServers` | `visible` | `hidden` | `hidden` |
| `cliRole` | `execution` | `null` | `null` |

Three changes to current behaviour are folded in:

1. **`completion` hides the user's MCP servers.** Today it passes no
   `mcpServers`, and `command.ts:87-96` only emits `--strict-mcp-config` inside
   the `if (input.mcpServers)` branch — so a one-shot completion loads the
   user's servers, pays their tool schemas in context, and does not even deny
   them (the current list covers built-ins only). A question needs no tools.
2. **`orchestrator` and `completion` share one denied list.** Both are
   conversations with no checkout. The 8-entry divergence is drift; one constant
   replaces two.
3. **`execution` gains `Bash(backlog:*)`** as a first layer — a signpost, not a
   lock. §5 is the lock. The exact specifier syntax accepted by
   `--disallowedTools` is verified against the installed CLI during
   implementation; if it does not support a command pattern, this entry is
   dropped rather than approximated, and nothing else in the design changes.
   **Verified** against `claude` 2.1.234: `--disallowedTools "Bash(backlog:*)"`
   is accepted, the session starts, and a `Bash` call of `backlog --help` under
   `--permission-mode bypassPermissions` comes back in `permission_denials`
   rather than running. The entry stays.

### Who reads the table

The three sites that launch a model stop deciding anything and read their
context instead:

| Site | Context |
| --- | --- |
| `providers/claude-code/provider.ts` → `buildRunCommand` | `execution` |
| `server/src/lib/chat/claude-code-chat.ts` → `buildChatCommand` | `orchestrator` |
| `providers/claude-code/provider.ts` → `runCompletion` | `completion` |

`DENIED_BUILT_IN_TOOLS` and `COMPLETION_DISALLOWED_TOOLS` are deleted.

### The seam — inverted during implementation, and why that is safe

This section originally kept the `audience → tool names` mapping inside the MCP
layer (`mcpHostFor`), with the context declaring only *which* set. **What was
built is the other way round**, and deliberately: the table owns the names
(`mcpTools`), and `mcpHostFor` filters the shared `CATALOG` by them.

The reason is that the caller needs the names anyway. `buildRunCommand` has to
emit `--allowedTools`, which is a list of tool names, before any server exists —
`--allowedTools` only auto-approves, so getting it wrong silently costs the
agent its tools. Deriving that list from a mapping locked inside another
process meant either spawning the server to ask it, or restating the set in the
provider — a second source of truth for exactly the question this table exists
to answer once.

The safety property the original seam was protecting is untouched, because it
never rested on where the *names* live:

- The command line still carries an **audience**, never a tool list.
  `parseAudience` still fails closed on an unknown one, and still defaults to
  the less privileged `execution`.
- `mcpHostFor` still refuses to *call* a name outside its set, not merely to
  advertise it — a caller that speaks JSON-RPC by hand gains nothing.
- `resolveMcpHost` still refuses to serve a wider audience than the role the
  process runs under.

A caller could always ask for a set it should not have; what it cannot do is
name tools. That is what makes the audience the trust boundary, and it stayed
one. `packages/core/src/agent-tools.test.ts` asserts the two write sets never
intersect, so widening the table cannot quietly hand an execution agent
`start_subtask`.

---

## 5. Closing the CLI

`packages/cli/src/bin.ts` refuses before dispatch when
`BACKLOG_AGENT_ROLE=execution` is set:

```
backlog: this command is unavailable to an execution agent.
Use the tools on the `backlog` MCP server instead.
```

Exit code non-zero, message on stderr, stdout untouched — the same fail-closed
shape `--audience` already uses for an unknown value.

### Who stamps the role — corrected during the final review

This section first had `run-executor.ts` export the role from `environmentFor`,
for every run whatever the runtime. That was wrong, and it cost a run its only
channel twice over. The CLI is closed *because* the façade replaces it, so the
closure has to follow the façade and not the pipeline:

- `CustomProvider` attaches no MCP server at all. Its runs got the role and no
  façade — and the prompt telling them "every interaction is a tool on the
  `backlog` MCP server" was false in both halves.
- A `read-only` repository coerces its agent's `sandbox_mode`, which maps to
  `--permission-mode plan`, and plan mode refuses MCP calls. Such a run could
  reach neither `trace_write` nor `backlog trace write`: it finished with no
  trace, the ticket did not move, and nothing said why.

So `run-executor.ts` stamps nothing — it is runtime-agnostic and cannot know
whether anything replaced the CLI — and clears an inherited role so none can
arrive by accident. The claude-code provider decides, where it attaches
`--mcp-config`, and only when the permission mode lets the model call an MCP
tool. The table still owns the *value*; the runtime owns *whether this run
earned it*.

**Both halves of the closure move together.** A first pass gated only the role
and left `--disallowedTools Bash(backlog:*)` on every execution run. That deny
rule fires under `plan` exactly as it does under `bypassPermissions`, so gating
the role alone only changed *which component* refused a read-only run — it still
had no `trace_write` and no `backlog trace write`. One predicate,
`facadeReachable`, now feeds both `executionCliRole` and
`executionDeniedBuiltins`; when the façade is unreachable, neither applies.
Note this was a regression the branch introduced, not a pre-existing gap: at the
merge base a run emitted no `--disallowedTools` at all.

### What a read-only run's channel is actually worth

Probed on `claude` 2.1.234 with the prompt `buildProviderPrompt` really emits,
a fake `backlog` on PATH, and no MCP server:

| condition | trace recorded |
| --- | --- |
| `--permission-mode plan`, no deny rule | 2 / 10 |
| `--permission-mode plan`, `--disallowedTools "Bash(backlog:*)"` | 0 / 4 |

Plan mode does **not** hard-block a mutating `Bash` call: the write lands and
`permission_denials` stays empty. What suppresses it is the model's own reading
of plan mode — it usually answers that it may only take read-only actions and
asks for approval, which `-p` has no channel to give. So the deny rule was the
difference between *never* and *sometimes*, which is why removing it is right;
but the honest claim is that a read-only run's trace is best-effort, not
guaranteed. The prompt now tells such a run that recording is required even in a
read-only session. Detecting a run that produced no trace and failing it loudly
is the real fix, and it is deliberately **out of scope** here: a legitimately
blocked run has nothing to record either, so the check needs a design of its
own.

### The hook exemption

`packages/config/src/shim.ts` execs the `backlog` binary from the git pre-commit
hook. An agent that commits runs that hook, and the hook inherits the agent's
environment. Without an exemption, the claim check would be refused at exactly
the moment it matters, and — worse — the hook's failure path is written to
*allow* the commit when Backlog is unavailable (`install-hooks.ts:67`,
`install-hooks.ts:93`). A refusal there would silently disable claim
enforcement rather than block it.

The exemption is explicit and narrow: the hook's invocation carries a marker the
role check honours. It is asserted by a test that commits from a worktree with
`BACKLOG_AGENT_ROLE=execution` set and observes the claim check still running.

### What this does not achieve

A shell is a shell. An agent that wants to can `env -u BACKLOG_AGENT_ROLE
backlog …`. The refusal moves the CLI from *advertised and one command away* to
*explicitly refused and requiring deliberate circumvention*. That is the honest
claim, and §1's two prompt statements become true under it in every ordinary
case. Overstating it would repeat the mistake this spec exists to correct.

---

## 6. The façade's tools

Five tools for `execution`, each mapping onto one existing command and calling
the same core service:

| Tool | Command | Service |
| --- | --- | --- |
| `task_show` | `backlog task show <id>` | task-service |
| `subtask_show` | `backlog subtask show <id>` | subtask-service |
| `trace_show` | `backlog trace show <id>` | trace-service |
| `claim_list` | `backlog claim list` | claim-store |
| `trace_write` | `backlog trace write` | trace-service (unchanged) |

`trace_write` is not touched: it already exists, already has the right shape,
and already refuses every other name at dispatch.

The four read tools are scoped to the project resolved by `--project`; none of
them takes a project argument. Their descriptions say what the CLI's `--help`
says, in the register the tool descriptions in `agent-tools.ts` already use —
what to call it for, and when.

The nine orchestrator tools are unchanged in this design. They already exist,
already carry the confirmation gate, and moving them into the catalogue is
mechanical.

---

## 7. Prompt disclosure

`run-prompt.ts` currently tells the agent the CLI is on its PATH and lists four
commands (`BACKLOG_CONTEXT`, lines 27-35). Once §5 lands, those five lines are
false.

They are replaced by a statement that the `backlog` MCP server carries every
interaction this context is allowed to make, that the CLI is not available, and
that `trace_write` remains the required closing call. `TRACE_CONTRACT` keeps its
current wording except for the CLI fallback in its first bullet, which no longer
exists for this context.

This section stays runtime-agnostic, as it is today: it describes what is
available, not which runtime provides it.

---

## 8. Testing

Four properties, three of them invariants over the table rather than examples:

1. **Integrity** — every tool name in every context exists in the catalogue.
2. **Containment** — the `execution` context contains no tool that moves a
   status, starts a run, or drives the orchestrator. This generalises the
   disjointness assertion in `agent-tools.test.ts`, which is kept.
3. **Coverage** — the price of D1. Every command named in §6's mapping table has
   a catalogue tool dispatching to the service that command dispatches to. The
   two cannot diverge in *behaviour*, since they share the service; they can
   diverge by a tool going missing, and that is what this asserts.
4. **Refusal** — the CLI refuses under the role, the hook does not (§5).

Plus one probe that is not a unit test, because a unit test is what missed the
task-level bug in PR #14: the compiled binary, driven on both run shapes, with
the role set — the façade answers, `backlog task move` refuses, `git commit`
still validates claims.

---

## 9. Impact on existing code

| File | Change |
| --- | --- |
| `core/src/contexts/` | new — types and table |
| `core/src/mcp/catalog.ts` | new — the tool catalogue |
| `core/src/mcp/tools/` | new — one definition per tool |
| `core/src/agent-tools.ts` | folded into the catalogue; its test is kept |
| `core/src/orchestrator-tools.ts` | folded into the catalogue; handlers unchanged |
| `cli/src/commands/mcp.ts` | `mcpHostFor` reads the catalogue |
| `cli/src/bin.ts` | role refusal before dispatch |
| `config/src/shim.ts` | hook exemption marker |
| `core/src/run-executor.ts` | exports `BACKLOG_AGENT_ROLE` |
| `core/src/providers/claude-code/provider.ts` | both call sites read a context; two constants deleted |
| `server/src/lib/chat/claude-code-chat.ts` | reads a context; one constant deleted |
| `core/src/run-prompt.ts` | §7 |

`packages/core` gains a folder and loses two flat modules of hand-written
policy. No new package, no new dependency, no change to the `AgentProvider`
contract — a context is assembled before the provider is called.

---

## 10. Out of scope

- **Removing the `direct` execution mode** and **removing the Codex provider**.
  Both were decided alongside this design and both are prerequisites, but each
  is a mechanical deletion with no design content and belongs in its own PR.
- **Removing the inert cloud layer** — 196 references, unrelated to agents.
- **The consolidator and the audit pass** — they consume traces; this spec
  governs who may write one.
- **Configuring contexts per agent in `agents.yaml`.** The table is code. If a
  user-facing knob is ever wanted, it reads the table rather than replacing it.
- **Non-Claude-Code runtimes.** With Codex removed, `custom` remains an
  escape hatch that Backlog cannot instrument, and `anthropic-api` answers
  prompts with no tools at all. Neither needs a context.
