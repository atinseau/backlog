# Agent ticket tools — design

Status: **approved** · §5 §9 implemented (traces, MCP tool set, prompt
disclosure) · §6 partly: `trace show` ships, its per-claim consolidation verdict
waits on the consolidator · §7 `proposed` implemented · §8 audit pass not
started
Date: 2026-08-17
Prerequisite for: [agent memory and consolidation](./2026-08-17-agent-memory-consolidation-design.md)
See also: [prompt registry](./2026-08-17-prompt-registry-design.md) — the tool
descriptions and returned texts specified here are registry blocks, and the
prompt disclosure section of §9 is authored there

---

## 1. The problem

An agent on a ticket today is blind and mute. It cannot say it is blocked, it
cannot record what it decided, it cannot see that another agent holds the files
it is about to edit, and it cannot read why the ticket it depends on turned out
the way it did.

The memory spec assumes a tool that writes the trace. That tool does not exist.
The `Stop` hook checks that a trace exists — something has to be able to write
one. So this is not an adjacent nice-to-have: **the memory design is not
implementable without this layer.**

The surprising part is how little is missing.

## 2. What already exists

| Capability | State |
| --- | --- |
| `task show`, `subtask show`, `subtask move`, `subtask block` / `unblock` | ✅ shipped |
| `claim list`, `claim check` | ✅ shipped |
| Dozens of mutating routes on tasks and subtasks | ✅ shipped |
| Binary reachable from a worktree (`.backlog/bin/backlog`, `~/.local/bin`, PATH) | ✅ shipped |
| A shell to call them with | ✅ `Bash`, under `bypassPermissions` |
| Context identity in the environment | ✅ `BACKLOG_TASK_ID`, `BACKLOG_SUBTASK_ID`, `BACKLOG_RUN_ID`, `BACKLOG_REPO`, `BACKLOG_BRANCH`, `BACKLOG_WORKTREE` |
| PR opening and recording its URL | ✅ automated (`create_pr` / `merge_pr`, `artifact{kind:"pr"}`) |
| MCP server | ✅ **shipped** — `packages/core/src/mcp/` + `backlog mcp-server` (see below) |
| **The prompt telling the agent any of this exists** | ❌ **zero mention** |

### The MCP plumbing already exists

Merged shortly before this spec: `packages/core/src/mcp/{server,stdio}.ts`,
`packages/cli/src/commands/mcp.ts`. Its own comment states the intent —
*"Exposes the orchestrator tools over MCP so `claude -p --mcp-config` can drive
Backlog"*. So the `--mcp-config` path is already travelled by the product, and
adding a tool is a registry entry rather than a server.

**But those are the orchestrator's tools, for the chat — not an execution
agent's.** `ORCHESTRATOR_TOOLS` includes `start_orchestrator`, `start_subtask`,
`pause_orchestrator`. Handing them to an agent working on a ticket would let it
launch further runs, duplicate itself, or start the orchestrator: exactly the
runaway cycle the `proposed` status neutralises, coming back in through the MCP
window.

**Two audiences, two disjoint tool sets, and an execution agent must never
receive the orchestration set.** A separate host over the same transport.

The action surface is almost entirely built, the agent has a shell to reach it,
and nobody ever told it. **The single highest-yield item in this spec is a
paragraph of prompt**, not a line of code.

## 3. Decisions and rationale

| # | Decision | Why |
| --- | --- | --- |
| T1 | Channel chosen per tool: CLI for reading, MCP for `trace write` | Revised once the MCP server landed (§2). The original reasoning — "MCP costs a server to write" — no longer holds, so the arbitration is now per tool. Reading stays CLI: `task show` and `claim list` already exist and work on *every* runtime, so re-exposing them over MCP would be redundant work that only serves Claude Code. `trace write` is the one genuinely new tool, the one the `Stop` hook depends on, and the one carrying a nested payload — precisely where a typed, discoverable tool beats JSON on stdin. CLI remains its fallback for runtimes without MCP. |
| T2 | Status only through the trace — no `move` tool | Two channels to the same state diverge. The failure that would actually happen is *blocked with no explanation*, which makes the ticket undebuggable by anyone. And `move` would let an agent mark itself `done`, bypassing `manual_approval_required`, which the system guarantees today. |
| T3 | No agent-to-agent channel | It would reintroduce the synchronous coordination this architecture eliminates: deadlock (A waits on B waits on A), the question of what A does while waiting, and two live runs of which one is idle. "Asking for help" already *is* `outcome: blocked` plus an `open_question`. The ticket is the channel. |
| T4 | Dependencies declared, not edited | Same reasoning as T2: an agent editing its own `depends_on` can block itself or unblock something else as a side effect. It already has `discovered_deps` in the trace. One channel fewer, and it cannot contradict its own trace. |
| T5 | Nothing to build for PRs | Already automated, deterministic, driven by the ticket's config. Handing it to the agent would replace a guaranteed behaviour with a probabilistic one — a regression. |
| T6 | graphify direct for code and canon; `backlog` for what it cannot index | Dictated by what each one knows. graphify indexes repo files; it does not index `.backlog/` — tickets, traces, claims, the consolidation journal. A relay layer over graphify would add indirection and nothing else, now that the coupling is hard. |
| T7 | Trace reading is graph-targeted, never exploratory | Reading a *specific* ticket's trace is navigation. Searching *across* traces would be a parallel memory that short-circuits consolidation — the canon exists precisely so that raw traces are not the interface. |
| T8 | Agent-created tickets land in a new `proposed` status | `backlog` already means "to do". A ticket nobody validated has no business there. `proposed` is AI-only by construction, so a human reading their backlog only sees vetted work. |

## 4. Awareness has three layers

The gap was never "agents cannot communicate". It is that awareness has three
distinct horizons and only the useless one was discussed:

| Question | Object | Horizon | State |
| --- | --- | --- | --- |
| Who is holding what? | **claims** | now | exists, invisible to agents |
| What was learned about this ticket? | **traces** | yesterday | to build |
| What is true in general? | **canon** | always | to build (memory spec) |

**A claim is already a communication.** "I hold these paths" is a message
addressed to everyone, with no named recipient and no expected reply — exactly
the right shape here, since it cannot deadlock. `run-launcher.ts:234` creates
one per run from the subtask's `scopes` (or `**` when it declares none, which
locks the whole repository). The mechanism exists; the agent is simply never
told. Making `claim list` visible turns passive communication into awareness at
no cost.

What an agent explicitly does **not** need is a feed of what other agents are
saying: that is noise paid by the token. It needs to know which paths are taken
and where its ticket comes from.

## 5. The write surface: one tool

```
trace_write                # MCP tool, typed schema (preferred)
backlog trace write        # CLI equivalent, JSON on stdin (fallback)
```

That is the only new write tool, and it carries everything an agent decides:

| Field | Effect |
| --- | --- |
| `outcome: implemented` | existing `successMode` logic, unchanged |
| `outcome: rejected` + `rejection_reason` | resolved without implementation, to review |
| `outcome: blocked` + `open_question` | calls the existing `subtask block` |
| `discovered_deps[]` → existing ticket id | the system adds the edge |
| `discovered_deps[]` → work with no ticket | the system creates a `proposed` ticket |
| `constraints[]`, `decisions[]` | the journal, per the memory spec |

JSON arrives on **stdin**, never in argv: a structured trace in a command line
is painful and error-prone, and argv is visible in `ps`.

Everything else the agent needs to act with already exists and only has to be
disclosed.

## 6. The read surface: two domains, no overlap

| Question | Tool | Why |
| --- | --- | --- |
| Code, architecture, canon | `graphify query` / `affected` / `explain` | Already installed, already pushed by its own `PreToolUse` hook. Zero code on our side. |
| A specific ticket, its trace, its neighbourhood | `backlog task show`, `backlog ticket trace <id>` | graphify does not index `.backlog/` |
| Who holds which paths | `backlog claim list` | same |

`backlog ticket trace <id>` is the missing link of the whole design: without it
the ticket graph is decorative — an agent sees that `task_017` exists and can
never find out what happened there.

**It must display the consolidation verdict** alongside each claim in the trace:
promoted, quarantined, or discarded and why. Without that, an agent reading a
trace can take as true a claim the consolidator explicitly refused to promote —
rot coming back in through the window. Quarantine would protect the canon and
not the agents.

## 7. The `proposed` status

A ninth status, upstream of `backlog`:

```
proposed → backlog → ready → in_progress → review → test → released → done
                                                                    + blocked
```

Rules, all of them load-bearing:

- **AI-only entry.** No human path leads to `proposed`. It is written by the
  system when it reads a proposal in a trace, never by hand, never by the board.
- **Never runnable.** The scheduler must never consider a `proposed` ticket, at
  any tick, whatever its priority. This is what neutralises the runaway cycle —
  an agent creating a ticket that launches an agent creating a ticket.
- **Editable.** A human may complete a proposal that lacks detail before
  accepting it. Creation is forbidden, editing is not.
- **One way out, by review:** `proposed → backlog`. Rejection archives with a
  reason (`archived_at` plus a motive) rather than deleting — consistent with the
  project's non-destructive doctrine.
- **A column shown only when non-empty.** Not a config flag: the column appears
  by itself when an agent proposes something and disappears when the inbox is
  drained. Two conditional columns already exist (`show_backlog_column`,
  `show_review_column`) but both are settings; this one is derived from content,
  so it adds no knob.

A proposal carries its title, its motive, the run and trace that produced it,
and the scope it expects to touch. Provenance is free — it comes from the trace
it was born in.

## 8. The audit pass

Accepting proposals is **the same pattern as consolidation**, on different
objects:

| | Consolidation | Audit |
| --- | --- | --- |
| Input | traces of resolved tickets | proposals |
| Output | canon, or nothing | `backlog`, or a motivated rejection |
| Trigger | batch threshold | batch threshold |
| Right to refuse everything | yes, journalled | yes, journalled |

Two distinct functions — different objects, different criteria — but they share
the machinery: the batch, the cursor, the journal. Worth building once.

Audit criteria mirror the canon's: **no verifiable justification, no entry**,
plus duplicate detection against existing tickets. That last check runs against
`.backlog/`, not graphify, which does not index tickets — plain title and scope
matching is enough.

A human is the default reviewer. An auditing agent is a later option, not a
prerequisite.

## 9. Prompt disclosure

The cheapest and most valuable change in this spec. The run prompt gains a short
section stating: the ticket ids in the environment, that a `backlog` binary is on
PATH, the handful of commands that matter (`task show`, `ticket trace`,
`claim list`, `trace write`), and that the trace is expected at the end.

Two constraints from the memory spec's measured findings:

- **The trace contract belongs in the prompt from the start.** The `Stop` hook is
  a net; a blocked stop costs a full extra turn, so relying on the hook as the
  normal path would tax every run.
- **It goes in `run-prompt.ts`**, so every runtime gets it — the CLI works
  everywhere, unlike hooks.

`--append-system-prompt` (`providers/claude-code/command.ts:65`, already wired)
is a candidate channel for the trace contract specifically, since the main
prompt's instruction list is already long enough that trailing lines get dropped.

## 10. Impact on existing code

| Area | Change |
| --- | --- |
| `packages/schemas/src/task.ts` | `proposed` in `taskStatusSchema`; a `proposal` block (origin run, trace ref, motive, audit verdict) |
| `packages/core/src/scheduler.ts` | `proposed` is never runnable — assert it, do not merely omit it |
| `packages/core/src/run-prompt.ts` | the disclosure section and the trace contract |
| `packages/core` | `trace-store.ts` (shared with the memory spec); status derivation from `outcome`; proposal creation |
| `packages/cli` | `backlog trace write` (stdin), `backlog ticket trace <id>`; disclose `claim list` |
| `packages/core/src/mcp/` | a second tool set and host for execution agents, alongside `ORCHESTRATOR_TOOLS`, over the existing stdio transport |
| `packages/core/src/providers/claude-code/command.ts` | pass `--mcp-config` for the agent tool set, next to the `--settings` hook payload |
| `packages/server` | trace write route; proposal accept / reject routes |
| `packages/board-ui` | conditional `proposed` column, read-only for creation, editable, accept / reject actions; strings in **both** `i18n/en.json` and `i18n/fr.json` |
| migration | existing tasks have no `proposed` state; the Zod default keeps old files loading unchanged |

## 11. Out of scope

- **Re-exposing the read surface over MCP.** T1 keeps reading on the CLI, which
  already works on every runtime. Only `trace_write` gets an MCP tool.
- **The auditing agent.** Human review is the default path; automating it is a
  later decision once we see what proposals actually look like.
- **Resuming a blocked ticket.** The mechanism falls out of `open_question` plus
  the trace, but the status transitions and triggers deserve their own pass.
- **Scope enforcement.** `Allowed scopes` in the prompt remains advisory — the
  claim only bites at commit time, and the run's auto-commit uses `--no-verify`
  (`run-merge.ts:339`). Real enforcement would be a `PreToolUse` hook on
  Edit/Write. Worth doing, not here.

## 12. Testing

Backend tests, `bun test ./packages`, temp-dir fixtures, sandboxed `HOME` via
`homeDir()`.

- `trace write` reads stdin, rejects a payload whose `outcome` lacks its required
  field, and refuses a claim with no evidence.
- Status derivation: each `outcome` produces exactly one transition; no path lets
  an agent reach `done` directly; `manual_approval_required` still forces review.
- `discovered_deps` splits correctly: an existing id becomes an edge, an unknown
  proposal becomes a `proposed` ticket carrying its provenance.
- The scheduler never returns a `proposed` ticket as runnable, at any priority.
- `proposed` accepts no creation from the API, accepts edits, and only exits to
  `backlog` or to archive-with-motive.
- `ticket trace` shows the consolidation verdict per claim, and there is no
  command that searches across traces.
- Prompt: the disclosure section is present for every runtime, not only
  claude-code.
- **The agent tool set contains no orchestration tool.** Assert it against the
  list, so adding one to `ORCHESTRATOR_TOOLS` later cannot silently leak it to
  execution agents.
