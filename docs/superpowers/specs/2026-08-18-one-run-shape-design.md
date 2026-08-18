# One run shape — design

Status: **approved** · implemented

## 1. The problem

Three settings in this repository claim to describe what an agent may do:

| Setting | Where | Values |
| --- | --- | --- |
| `sandbox_mode` | agent (`agents.yaml`) | `read-only` / `workspace-write` / `danger-full-access` |
| `access_mode` | repository (`config.toml`) | `read-write` / `read-only` / `no-access` |
| `enabled` | repository (`config.toml`) | boolean |

Six values across two enums, plus a boolean. Measured against the code, they
resolve to far less than they advertise.

**`sandbox_mode` has exactly one branch in the whole codebase.**

```ts
// providers/claude-code/command.ts:53
sandboxMode === "read-only" ? "plan" : "bypassPermissions"
```

`workspace-write` and `danger-full-access` are indistinguishable — the UI
offers a `⚠ danger-full-access` option that changes nothing. The only other
site is `BACKLOG_SANDBOX_MODE`, exported into a run's environment
(`run-executor.ts:87`) and read by no code in the repository.

**`access_mode`'s three values are one deletion and one duplicate.**
`read-only` coerces `sandbox_mode` downward (`run-executor.ts:46`); `no-access`
stops the scheduler targeting the repository — which is what `enabled` is for.
The schema comment says so itself: *"effectively equivalent to enabled=false but
lets you keep the repo registered"*. Meanwhile `enabled` does **not** gate
scheduling at all today; its only use is picking a default repository
(`scheduler.ts:226`). Two overlapping fields, and the wrong one does the work.

**And `read-only` is not what its name promises.** Two facts, both measured:

- The real isolation is the **worktree**, not the mode. Since the `direct`
  execution mode was removed (#17), every run executes in
  `.backlog/worktrees/<repo>/<run-id>/`. An agent in `danger-full-access`
  already cannot touch the user's checkout.
- `--permission-mode plan` is enforced by the model's system prompt, not by the
  permission system. Probed on `claude` 2.1.234: a mutating `Bash` call under
  `plan` runs, and `permission_denials` stays empty.

So `read-only` is neither a sandbox nor a permission. It is a declaration of
intent addressed to the model — whose one hard consequence is inflicted by
Backlog itself, and is a regression: plan mode refuses MCP calls, so a
`read-only` run gets no façade, keeps the CLI, and records its trace **2 times
in 10** (measured, `claude` 2.1.234, real run prompt). The run whose only
deliverable *is* the report is the one that cannot file it.

## 2. The rule

There is one discriminant, and it is structural rather than configured:

> **A run has a worktree. It produces a diff and a trace. That is the only shape
> of run.**

A repository answers one question, and a field that already exists answers it:
`enabled`. Enabled means agents may be sent there. Disabled means the scheduler
does not target it.

An analysis run — one that inspects and reports without changing code — needs no
mode. It gets a worktree like every other run and writes nothing in it. **A
worktree with no commit is the read-only outcome**, obtained by doing nothing
rather than by configuring something, and its report lives in the trace.

## 3. What follows

- `--permission-mode bypassPermissions` becomes a constant. Plan mode leaves the
  run pipeline entirely.
- `facadeReachable` disappears with it, and the trade it guarded becomes
  unconditional: every run gets `--mcp-config`, `BACKLOG_AGENT_ROLE=execution`
  and `--disallowedTools Bash(backlog:*)`. The two halves can no longer drift
  apart because there is no longer a condition to get wrong — which is exactly
  the bug caught in review during #17.
- **Every run reaches `trace_write`.** The 2-in-10 trace channel is gone, along
  with the "if `trace_write` is not in your tool list" fallback clause in
  `run-prompt.ts:54`. The `Stop` hook specified in the memory-consolidation
  design becomes what it should be — a net under a reliable channel, not a
  rescue for a broken one.
- The fourth context floated in the previous handoff (`execution-readonly`, or
  an `analysis` context) is **not needed and will not be built**. It existed to
  repair the damage plan mode caused.

## 4. What is deleted

### `sandbox_mode`

| File | Change |
| --- | --- |
| `packages/schemas/src/agent.ts` | drop `sandboxModeSchema`, the `sandbox_mode` field, the `SandboxMode` export |
| `packages/core/src/providers/claude-code/command.ts` | drop `permissionModeFor` and `permitsMcpTools`; `--permission-mode bypassPermissions` emitted unconditionally; drop `sandboxMode` from `ClaudeCodeCommandInput` |
| `packages/core/src/providers/claude-code/provider.ts` | drop `facadeReachable`; `executionCliRole` and `executionDeniedBuiltins` return the table's values directly |
| `packages/core/src/providers/types.ts` | drop `sandboxModes` from the provider descriptor |
| `packages/core/src/providers/{anthropic-api,custom}/provider.ts` | drop their empty `sandboxModes` |
| `packages/core/src/run-executor.ts` | drop the `BACKLOG_SANDBOX_MODE` export |
| `packages/core/src/agents.ts` | drop `sandboxMode` from create/update inputs and the default `workspace-write` |
| `packages/cli/src/commands/agent.ts` | drop `--sandbox-mode`, `normalizeSandboxMode`, the `Sandbox:` line in `agents show` |
| `packages/server/src/routes/agents.ts` | drop `sandbox_mode` from request and response schemas and `sandbox_modes` from the provider descriptor route |
| `packages/board-ui/src/lib/AgentsView.svelte` | drop the sandbox selector (4 options) |
| `packages/board-ui/src/lib/{api,types}.ts` | drop the field and the `SandboxMode` type |
| `packages/config/src/init-layout.ts` | drop the three `sandbox_mode: workspace-write` lines from the generated `agents.yaml` |
| `packages/board-ui/src/lib/i18n/{en,fr}.json` | drop `agents_view.field_sandbox`, `agents_view.sandbox.*` (5 keys), and the orphan `permissions.field.sandbox` |

### `access_mode`

| File | Change |
| --- | --- |
| `packages/schemas/src/config.ts` | drop `repoAccessModeSchema` and the `access_mode` field |
| `packages/core/src/run-executor.ts` | drop `applyRepoAccessPolicy` entirely |
| `packages/core/src/scheduler.ts` | replace the `repo_no_access` reason with an `enabled` check |
| `packages/core/src/repo-service.ts` | drop `accessMode` from add/update inputs |
| `packages/server/src/routes/repos.ts` | drop `access_mode` from three route schemas |
| `packages/board-ui/src/lib/RepositoriesView.svelte` | drop the access pill and its change dialog; the `enabled` toggle stays |
| `packages/board-ui/src/App.svelte:588` | the runnable-repository predicate reads `enabled` |
| `packages/board-ui/src/lib/run-start-errors.ts:32` | map the new reason instead of `repo_no_access` |
| `packages/board-ui/src/lib/{api,types}.ts` | drop the field and `RepositoryAccessMode` |
| `packages/board-ui/src/lib/i18n/{en,fr}.json` | drop `repos_view.access_*` (8 keys per language) |

### Tests

Roughly fifteen test files carry `access_mode: "read-write"` in a repository
fixture; those lines go. Three carry behavioural assertions that go with the
behaviour: `run-executor.test.ts` (the `no-access` throw and the `read-only`
coercion), `provider.test.ts:193` (`executionCliRole` returns null under
`read-only`), and `command.test.ts`'s permission-mode matrix.

Two assertions are **added**: `--permission-mode` is always
`bypassPermissions`, and a run against a disabled repository is not scheduled.

## 5. What replaces `no-access`

`enabled: false` blocks the scheduler and nothing else. The repository stays
visible in the board, greyed, with its toggle — hiding it would make it
unrecoverable from the UI, and it stays consistent with the standing rule that
removing a repository detaches it rather than cascading.

This is a behaviour change to `enabled`, not only a rename: today the flag gates
nothing. The scheduler gains the check `no-access` used to carry, under a new
skip reason (`repository_disabled`).

## 6. On-disk compatibility

Zod objects in `packages/schemas` are non-strict, so an existing `agents.yaml`
carrying `sandbox_mode` and an existing `config.toml` carrying `access_mode`
both keep parsing — the keys are stripped on read and dropped the next time the
file is written. No migration step, no version bump.

One case deserves a line in the release note rather than code: a user who had
set a repository to `no-access` will find it runnable again unless they also
untick `enabled`. It is the only setting whose meaning is not preserved, and it
fails **open**. Nothing in the product can surface it either: `access_mode` is
stripped by Zod on read, so by the time `doctor` or the board's repository list
renders, the key is gone and the row looks entirely normal. The release note is
the only mitigation.

## 7. What is explicitly not changed

- **The context table stays.** `execution` / `orchestrator` / `completion` are
  three different situations a model is launched in — an unattended coding run,
  a chat with a human present, a one-shot prompt — not three permission levels.
  What it loses is a conditional, not a row.
- **Worktrees, claims and the pre-commit hook are untouched.** They are the
  enforcement; this spec only removes settings that pretended to be.
- **`allowed_repos`, `allowed_risk` and `capabilities` on an agent stay.** They
  select which agent takes which subtask. That is scheduling, not permission.

## 8. Limits worth stating

Deleting `read-only` does not make Backlog *less* safe, because the deleted
setting was not providing safety — but it does remove a control someone might
have believed in. What remains, and what actually binds:

- The run cannot touch the user's checkout: it is in a worktree.
- The run cannot commit over another agent's paths: the pre-commit hook enforces
  claims.
- The run cannot reach Backlog's own CLI: `BACKLOG_AGENT_ROLE=execution` is
  refused at the entrypoint — now on every run rather than on some.

What was never true, and stays untrue: nothing stops an agent from writing files
inside its own worktree. That was already the case in `read-only`, since plan
mode does not block a mutating `Bash` call.

## 9. Out of scope

- The `Stop` hook enforcing the trace contract — specified in
  [agent memory and consolidation](./2026-08-17-agent-memory-consolidation-design.md)
  §7. This spec removes its hardest case; it does not implement it.
- Failing a run that produced no trace. Cheaper to decide once every run has a
  reliable channel, and it belongs with the hook.
- The inert cloud layer, and the legacy `repo` naming. Untouched.
