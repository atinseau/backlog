# A run that records nothing has failed — design

Status: **approved** · implemented

## 1. The problem

A coding run's trace is the only thing about it that outlives it: it is what
moves the ticket, and it is the only record of what the agent decided and why.
Nothing checks that one was written. A run whose agent finished without calling
`trace_write` reaches `finalizeSuccessfulRun` exactly like one that did
(`run-executor.ts:196-213`), the worktree is archived, and the ticket carries no
record of what happened to it.

Two previous designs named this and both deferred it, for the same stated
reason: *a legitimately blocked run has nothing to say either, so a naive check
fails correct runs.*

**That reason is false, and it is why this spec is short.** `outcome` is a
closed enum — `implemented | rejected | blocked` — and `blocked` **requires**
`open_question` (`schemas/src/trace.ts:52-72`, enforced by a `superRefine` at
write time). The tool's own description says it: *"`outcome: blocked` is how you
ask for help — there is no agent-to-agent channel."* A blocked run is
contractually obliged to write a trace. There is no state in the contract that
means "nothing to record", so **the absence of a trace is unambiguous by
construction**.

### What this spec does not know

The severity is unmeasured. The often-quoted figure — a trace recorded 2 times
in 10 — was measured under `--permission-mode plan`, a code path that no longer
exists: `command.ts:64` now emits `bypassPermissions` unconditionally, so every
run reaches the MCP façade and its five-tool execution set. **Nobody has
measured the miss rate under the current shape.** This spec is written because a
silent hole is worth closing whatever its size, not because the size is known.

## 2. The rule

> A run that exits 0 without a trace for its own `run_id` has failed.

Not "is flagged", not "is annotated" — failed, in the same way and through the
same path as a run whose command exited non-zero. A run that produced no record
of its reasoning produced nothing a human can act on, and calling that success
is what makes the hole silent.

## 3. Two mechanisms, one authority

The rule is enforced twice, on purpose, and the two halves are not
interchangeable.

**The finalizer is the authority.** In `run-executor.ts`, the success branch
gains one check before `finalizeSuccessfulRun`: does `listTraces(backlogDir,
workItem.id)` contain an entry whose `run_id` is this run's? If not, the run
takes the failure path instead. This is the single place every exit-0 run of
every runtime passes through, so a `custom` run — which attaches no MCP server
and no hooks at all — is covered by the same code, for free, and so is any
runtime added later.

**The `Stop` hook is a net, and it changes no status.** Claude Code fires a
`Stop` hook when the session tries to end; exiting 2 refuses the stop and sends
the hook's stderr to the model as an instruction, which resumes work to comply.
Measured on `claude` 2.1.234 under the real flag shape — `bypassPermissions`, a
real `backlog mcp-server --audience execution` over `--mcp-config`,
`--allowedTools` on the five tools, `BACKLOG_AGENT_ROLE=execution` — a hook that
finds no trace and exits 2 obtains one on the second turn.

The net exists because a run that can still be saved should be saved in-session:
a blocked stop costs one extra turn, a failed run costs the whole run. But it
can only ever *ask*. The status decision stays with the finalizer, which sees
cases the hook cannot — a `custom` run, an abnormal exit, `--bare` (which
disables hooks outright).

**A high block rate is a signal the prompt is failing, not that the hook is
working.** The trace contract lives in `run-prompt.ts` and stays there; the hook
is the last resort, never the normal path.

## 4. The hook

**Form: a generated script, not an inline shell string.** It follows the
pre-commit precedent exactly — `packages/hooks` generates a script,
`packages/config/src/shim.ts` resolves and execs the binary, no runtime and no
package manager at hook time. The alternative, a `sh -c` string embedded in the
`--settings` JSON inside an argv, is quoting inside quoting inside quoting, and
nothing in the existing suite can test it.

**Channel: the CLI, exempted the way the pre-commit hook already is.** The hook
is a child process of `claude` and inherits `BACKLOG_AGENT_ROLE=execution`, so
the CLI would refuse it — except `role-guard.ts:64-76` already exempts any
invocation carrying a non-empty `BACKLOG_HOOK_INVOCATION`, which is precisely
this case and precisely why that exemption exists. The generated script exports
it immediately before the call, as the pre-commit hook does. The hook therefore
parses the trace with the same tested code the rest of the system uses, rather
than grepping an NDJSON file for a substring.

The HTTP route the memory-consolidation design assumed (*"the server knows
whether the ticket's trace exists, so the hook is an HTTP call"*) is a dead end
and this spec abandons it: no route reads a trace, the run's environment carries
no server URL or port, and a run launched from the CLI may have no server at
all.

**Delivery: the existing `--settings` payload.** `command.ts` already builds one
to inject `CLAUDE_CODE_PROFILE`, and a single `--settings` JSON was verified to
carry `env` and `hooks` simultaneously with both taking effect. It becomes
unconditional — today it is emitted only when a profile is set.

**Ceiling: exactly one block, and no counter anywhere.** Claude Code passes
`stop_hook_active` on the hook's stdin: verified `false` on the first call and
`true` on the call following a block. The hook allows the stop whenever that
flag is true. This is a free one-bit ceiling with no state to store, no file to
maintain, and no way to hang an agent — the failure mode a guardrail must never
have.

## 5. The form of the failure

`failRun`, with the reason prefixed `trace_missing:` in `run.result`.

No new run status, no schema change, no new i18n key. `run.result` is the only
free-text field on the Run record, the board already parses a structured reason
out of a string (`Card.svelte:252-256`), and `failRun` already writes a blocker
the card renders. The nine-value status enum is duplicated across three board
components and eighteen locale keys; a tenth value is not worth a case that
should be rare.

This is deliberately the cheap form. A typed `failure_reason` field on
`runSchema` is the right answer **when a second reason exists** — not before.

## 6. What this does not claim

- **The hook does not fire on every ending.** Whether `Stop` fires on an API
  error, a non-zero exit, a `SIGKILL`, or the orchestrator reaping a stale run
  is unmeasured. This is not a gap in the design — it is the reason the
  finalizer holds the authority. If the hook never fires, the rule still binds.
- **The hook may read a trace a moment too early.** The trace is appended by the
  MCP server, a separate process, with `fs.appendFileSync`; the hook reads the
  file. Whether a read can miss a write that just landed is unmeasured. The
  consequence is bounded by design: a false "missing" from the hook costs one
  wasted turn and nothing else, because the finalizer — which runs after the
  process has exited — is what decides.
- **The ceiling is decided by a substring, not by a parsed field.** The hook
  greps `"stop_hook_active"[[:space:]]*:[[:space:]]*true` over the entire stdin
  payload, so *any* unescaped occurrence in it — wherever it sits, whatever
  field it belongs to — releases the stop. That payload carries agent-authored
  text in `last_assistant_message`, and the realistic writer of those exact
  characters is not an adversary but a self-hosted run: an agent implementing
  this very feature, naming the field in its closing summary. What stands
  between that message and a self-granted exemption is JSON escaping, measured
  and not designed: the quotes in a string field arrive as `\"`, which the
  pattern does not match, while the same characters unescaped anywhere in the
  payload do. The cost if it ever lands is exactly one missed nudge — the
  finalizer still fails a run that recorded nothing. Tightening it means
  parsing JSON inside a shell hook, which is the dependency the pre-commit shim
  precedent exists to avoid.
- **The ceiling rests on a single field.** `stop_hook_active` is verified
  present on `claude` 2.1.234; nothing guarantees a future version or another
  runtime sends it. A runtime that omits it would produce block after block, so
  §4's "no way to hang an agent" holds *conditional on that field being
  present* — the hook stores no state of its own to fall back on.
- **Hook enforcement and `--bare` are mutually exclusive.** `--bare` disables
  hooks outright, so a run spawned that way carries no net at all. `--bare` is
  the standing candidate for cutting the ~25k cache-creation tokens a Claude
  Code invocation pays (CLAUDE.md §8); adopting it costs the in-session rescue.
  The rule still binds in that case, which is the point of putting the
  authority in the finalizer.
- **This does not make an agent's trace honest**, only present. A trace whose
  `summary` is wrong passes this check. Judging content is the consolidator's
  problem, not this one.
- **This measures nothing.** Once it ships, the miss rate becomes observable for
  the first time: every miss is now a failed run with a named reason.

## 7. Impact on existing code

| Area | Change |
| --- | --- |
| `packages/core/src/run-executor.ts` | the success branch checks for a trace with this `run_id` before `finalizeSuccessfulRun`; on absence it takes the `failRun` path with the `trace_missing:` reason |
| `packages/core/src/providers/claude-code/command.ts` | the `--settings` payload becomes unconditional and gains a `hooks` block |
| `packages/core/src/providers/claude-code/provider.ts` | supplies the hook declaration for a run, alongside the MCP config it already builds |
| `packages/hooks` | generates the `Stop` hook script, next to the pre-commit generator |
| `packages/cli` | a subcommand the hook calls to answer "does a trace exist for this run", exempt via `BACKLOG_HOOK_INVOCATION` |
| tests | the finalizer check is unit-testable with the `custom` runtime and needs no `claude`; the hook script is testable as a script |

## 8. Out of scope

- **Judging what a trace says.** The consolidator's problem.
- **A typed `failure_reason` field.** Deferred until a second reason exists (§5).
- **Measuring the miss rate.** This spec makes it observable; reading the number
  is a later exercise.
- **`SessionStart` hooks and the memory push.** Specified in the
  memory-consolidation design; this spec touches only `Stop`.
