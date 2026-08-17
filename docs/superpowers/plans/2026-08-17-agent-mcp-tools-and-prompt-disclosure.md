# Agent MCP tools and prompt disclosure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an execution agent a typed `trace_write` tool over MCP, a
project-correct `backlog` CLI, and a prompt that tells it all of this exists —
without ever handing it an orchestration tool.

**Architecture:** A second MCP tool set (`AGENT_TOOLS`) lives beside
`ORCHESTRATOR_TOOLS` in `core` and is served by the same `backlog mcp-server`
over the same stdio transport, selected by a new `--audience` flag that
defaults to the *least* privileged set. `ClaudeCodeProvider.executeRun` attaches
that server to every coding run via `--mcp-config`. The disclosure paragraph
goes in `run-prompt.ts`, so every runtime gets it, and it names both channels
(the MCP tool, and `backlog trace write` as the fallback).

**Tech Stack:** Bun 1.3+, TypeScript, Zod (`packages/schemas`), Commander (CLI),
hand-rolled JSON-RPC MCP server (`packages/core/src/mcp/`), `bun:test`.

**Spec:** [`docs/superpowers/specs/2026-08-17-agent-ticket-tools-design.md`](../specs/2026-08-17-agent-ticket-tools-design.md)
— this plan implements §5 (write surface), §6 (read surface, disclosure half),
§9 (prompt disclosure) and the §12 tests that cover them.

---

## Global Constraints

Copied from `CLAUDE.md` and the spec. Every task's requirements implicitly
include this section.

- **Bun only.** No Node, npm, pnpm, tsx, tsup or vitest. Tests are `bun:test`.
- **Always pass a path to the test runner.** `bun test` with no path silently
  misses packages. Use `bun run test`, which scopes to `./packages`.
- **Before committing:** `bun run typecheck`, then `bun run test`. The final
  task also runs `bun run build`.
- **Dependency direction:** `schemas` ← everything; `cli` and `server` sit on
  `core`. `core` must never import from `server` or `cli`.
- **Imports keep the `.js` extension** (`./agent-tools.js` → `agent-tools.ts`).
- **Never resolve runtime files relative to `import.meta.url`**, and never
  re-invoke the CLI via `process.argv[1]` — use `selfExec()` from
  `packages/core/src/self-exec.ts`.
- **Use `homeDir()` from `@backlog/config`, never `os.homedir()`.**
- **Vocabulary:** project · repository · task · subtask · run · claim · agent.
  No "repo"/"repos" in new user-facing copy.
- **Tests share one process.** Keep fixtures in temp dirs
  (`fs.mkdtempSync(path.join(os.tmpdir(), "backlog-<name>-"))`).
- **A fresh worktree has no `node_modules`.** The LSP will report
  `Cannot find module 'zod'`; `bun test` and `bun run typecheck` resolve
  correctly by walking up to the parent repo. Ignore that diagnostic class —
  do not "fix" it with an install.
- **A `.default()` Zod field is optional on the input type but required on the
  inferred output type.** Widen a test fixture's type narrowly; never the schema.

## Spec divergences this plan applies deliberately

Three places where the spec's text and the shipped code disagree. The code
wins; each is recorded here so the next reader does not "fix" the plan back.

1. **`backlog ticket trace <id>` does not exist. `backlog trace show <id>`
   does** (shipped in PR #11, `packages/cli/src/commands/trace.ts:124`). Spec §6
   names the former. Everything in this plan — prompt copy included — uses the
   shipped name.
2. **Spec §6 requires `trace show` to display the consolidation verdict per
   claim.** The consolidator does not exist yet (it is the next spec), so there
   is no verdict to display. Out of scope here; it lands with the consolidator.
3. **Spec §9 offers `--append-system-prompt` as a candidate channel for the
   trace contract.** This plan puts the contract in `run-prompt.ts` only, which
   is the §9 requirement ("so every runtime gets it"). Duplicating it into
   `--append-system-prompt` would make Claude Code diverge from the other
   runtimes for no measured benefit. Not done.

## The bug this plan has to fix first

Verified empirically, not inferred. In an `in_repo` project, `.backlog/config.toml`
is **tracked** (`packages/config/src/init-layout.ts:72` gitignores `claims/`,
`runs/`, `traces/`, `worktrees/` — not `config.toml`). A run's isolated worktree
is a checkout of that repository, so it contains its own `.backlog/config.toml`.
`findProject()` walks up from cwd looking for exactly that file
(`packages/config/src/find-project.ts:87-95`), so **every `backlog` command an
agent runs from inside its worktree resolves to the worktree's shadow project,
not the real one.**

Reproduction, run against this repository's own sources:

```
worktree cwd, no env   → …/repo/.backlog/worktrees/probe-run/.backlog   ← shadow
worktree cwd, with env → …/repo/.backlog                                ← correct
```

A trace written there lands in the worktree's gitignored `traces/`, and is
deleted with the worktree at garbage-collection time. The whole read surface of
§6 reads an empty project. `BACKLOG_PROJECT_DIR` already exists and is already
honoured by `findProject` (added for the pre-commit hook,
`find-project.ts:66`); the run environment simply never sets it. Task 1.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/trace-context.ts` | **Create.** Fill a trace payload's context fields (`version`, `run_id`, `task_id`, `subtask_id`, `created_at`) from an environment. One responsibility, shared by both write channels so they cannot drift. |
| `packages/core/src/agent-tools.ts` | **Create.** `AGENT_TOOLS` (the execution-agent MCP set) and `callAgentTool`. Mirrors `orchestrator-tools.ts`; deliberately a separate file so the two sets can never be spread into one another by accident. |
| `packages/core/src/agent-tools.test.ts` | **Create.** The security boundary, asserted three ways. |
| `packages/core/src/trace-context.test.ts` | **Create.** Context defaults. |
| `packages/core/src/run-executor.ts` | Modify: export `BACKLOG_PROJECT_DIR`, pass `backlogDir` to the provider. |
| `packages/core/src/providers/types.ts` | Modify: `ProviderRunRequest.backlogDir`. |
| `packages/core/src/providers/claude-code/command.ts` | Modify: `strictMcpConfig` opt-out. |
| `packages/core/src/providers/claude-code/provider.ts` | Modify: attach the agent MCP server to a coding run. |
| `packages/core/src/run-prompt.ts` | Modify: the disclosure and trace-contract sections. |
| `packages/cli/src/commands/mcp.ts` | Modify: `--audience`, defaulting to `agent`. |
| `packages/cli/src/commands/mcp.test.ts` | **Create.** Host selection per audience. |
| `packages/cli/src/commands/trace.ts` | Modify: drop the local `withContextDefaults` in favour of `trace-context.ts`. |
| `packages/server/src/lib/chat/claude-code-chat.ts` | Modify: pass `--audience orchestrator` explicitly. |
| `CLAUDE.md` | Modify: §3 and §8 are wrong once this lands. |

## Task dependency order

Task 1 is independent. Task 2 → Task 3 → Task 4 is a chain. Task 5 is
independent. Task 6 is last. Execute in order; nothing here parallelises
cleanly enough to be worth the coordination.

---

### Task 1: The run environment points at the real project

**Files:**
- Modify: `packages/core/src/run-executor.ts:71-87` (`environmentFor`)
- Test: `packages/core/src/run-executor.test.ts` (append one case)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: every process spawned inside a run inherits
  `BACKLOG_PROJECT_DIR=<backlogDir>`. Tasks 4 and 5 depend on this being true —
  Task 5's prompt tells the agent to run `backlog` commands, and they are wrong
  without it.

- [x] **Step 1: Write the failing test**

Append to the `describe("executeAgentRun", …)` block in
`packages/core/src/run-executor.test.ts`. The `custom` provider runs a shell
snippet and its stdout becomes the run's `summary` artifact, so echoing the
variable is enough to observe the environment.

```ts
  it("points every command the agent runs at the real project, not the worktree's shadow copy", async () => {
    // An in_repo worktree contains its own tracked .backlog/config.toml, so
    // findProject() would resolve to it and the agent would read and write a
    // project that is deleted with the worktree.
    const f = fixture('echo "$BACKLOG_PROJECT_DIR"');

    await executeAgentRun({ ...f, run: f.run });

    const run = loadRun(f.backlogDir, f.run.id);
    expect(run?.artifacts.find((artifact) => artifact.kind === "summary")?.value).toBe(f.backlogDir);
  });
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./packages/core/src/run-executor.test.ts`
Expected: FAIL — the summary artifact is `""` (the variable is unset), not the
backlog directory.

- [x] **Step 3: Write the implementation**

In `packages/core/src/run-executor.ts`, add one entry to the object returned by
`environmentFor`, and take `backlogDir` off the params it already receives:

```ts
function environmentFor(params: ExecuteAgentRunParams): NodeJS.ProcessEnv {
  const { run, task, workItem, agent } = params;
  return {
    ...process.env,
    PATH: expandedPath(),
    ...agent.environment,
    // An in_repo project tracks .backlog/config.toml, so the run's worktree
    // carries a shadow copy of it. Without this, findProject() walking up from
    // the worktree resolves to that shadow: the agent would read an empty
    // project and write its trace into a directory the worktree GC deletes.
    // BACKLOG_PROJECT_DIR is checked before the upward walk (find-project.ts).
    BACKLOG_PROJECT_DIR: params.backlogDir,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: workItem.id,
    BACKLOG_SUBTASK_ID: task.id,
    BACKLOG_TARGET_TYPE: task.target_type ?? "subtask",
    BACKLOG_TARGET_ID: task.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
    ...(agent.sandbox_mode ? { BACKLOG_SANDBOX_MODE: agent.sandbox_mode } : {}),
  };
}
```

Note the placement: **before** `agent.environment` would let a user's agent
config silently override it; **after** is deliberate — this one is not
negotiable. (`...agent.environment` stays where it is, above.)

- [x] **Step 4: Run the test to verify it passes**

Run: `bun test ./packages/core/src/run-executor.test.ts`
Expected: PASS, and every pre-existing case in the file still passes.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/run-executor.ts packages/core/src/run-executor.test.ts
git commit -m "fix(core): point an agent's backlog commands at the real project"
```

---

### Task 2: The agent tool set, and the boundary that keeps it disjoint

**Files:**
- Create: `packages/core/src/trace-context.ts`
- Create: `packages/core/src/trace-context.test.ts`
- Create: `packages/core/src/agent-tools.ts`
- Create: `packages/core/src/agent-tools.test.ts`
- Modify: `packages/core/src/index.ts` (two `export *` lines)
- Modify: `packages/cli/src/commands/trace.ts:42-63` (delete the duplicate)

**Interfaces:**
- Consumes: `recordTrace` / `RecordTraceResult` from `./trace-service.js`;
  `McpToolDefinition` / `McpToolOutcome` from `./mcp/server.js`;
  `orchestratorToolNames()` from `./orchestrator-tools.js`.
- Produces, for Tasks 3 and 4:
  - `withTraceContextDefaults(payload: Record<string, unknown>, env: NodeJS.ProcessEnv): Record<string, unknown>`
  - `AGENT_TOOLS: McpToolDefinition[]`
  - `agentToolNames(): string[]`
  - `callAgentTool(call: { backlogDir: string; name: string; input: unknown }): Promise<McpToolOutcome>`

**Why there is no confirmation gate here.** `ORCHESTRATOR_TOOLS` gates every
write on `confirmed: true` because the chat acts on a human's behalf and a human
is present to say yes. An execution agent is alone: a gate would refuse the one
action the run exists to produce, and there is nobody to confirm it. The safety
property on this side is not consent, it is *scope* — the set contains exactly
one tool, and that tool cannot reach `done` (see `recordTrace`: `implemented`
derives no transition).

- [x] **Step 1: Write the failing tests for the context helper**

Create `packages/core/src/trace-context.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { withTraceContextDefaults } from "./trace-context.js";

describe("withTraceContextDefaults", () => {
  it("fills version, ids and created_at from the environment", () => {
    const filled = withTraceContextDefaults(
      { outcome: "implemented", summary: "done" },
      { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_SUBTASK_ID: "subtask_1" },
    );

    expect(filled.version).toBe(1);
    expect(filled.run_id).toBe("run_1");
    expect(filled.task_id).toBe("task_1");
    expect(filled.subtask_id).toBe("subtask_1");
    expect(typeof filled.created_at).toBe("string");
  });

  it("lets the payload win over the environment", () => {
    const filled = withTraceContextDefaults(
      { task_id: "task_9", created_at: "2020-01-01T00:00:00.000Z" },
      { BACKLOG_TASK_ID: "task_1" },
    );

    expect(filled.task_id).toBe("task_9");
    expect(filled.created_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("leaves a field absent when neither the payload nor the environment has it", () => {
    const filled = withTraceContextDefaults({ outcome: "implemented" }, {});

    expect("run_id" in filled).toBe(false);
    expect("subtask_id" in filled).toBe(false);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `bun test ./packages/core/src/trace-context.test.ts`
Expected: FAIL — `Cannot find module './trace-context.js'`.

- [x] **Step 3: Write the context helper**

Create `packages/core/src/trace-context.ts`. This is the body currently sitting
in `packages/cli/src/commands/trace.ts`, moved into `core` and given an explicit
`env` parameter so it is testable and so both write channels share it.

```ts
// A trace payload's context fields — who wrote it, about what, when. An agent
// already has these in its environment (run-executor.ts sets them), so the
// payload it writes may omit them. Lives in core rather than in the CLI command
// because two channels fill them now: `backlog trace write` and the MCP
// `trace_write` tool. One copy, so they cannot drift.
//
// Anything the payload states wins, so a caller can still write a trace for
// another context deliberately.
export function withTraceContextDefaults(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const filled: Record<string, unknown> = { ...payload };
  if (filled.version === undefined) {
    filled.version = 1;
  }
  if (filled.run_id === undefined && env.BACKLOG_RUN_ID) {
    filled.run_id = env.BACKLOG_RUN_ID;
  }
  if (filled.task_id === undefined && env.BACKLOG_TASK_ID) {
    filled.task_id = env.BACKLOG_TASK_ID;
  }
  if (filled.subtask_id === undefined && env.BACKLOG_SUBTASK_ID) {
    filled.subtask_id = env.BACKLOG_SUBTASK_ID;
  }
  if (filled.created_at === undefined) {
    filled.created_at = new Date().toISOString();
  }
  return filled;
}
```

- [x] **Step 4: Run to verify they pass**

Run: `bun test ./packages/core/src/trace-context.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Write the failing tests for the agent tool set**

Create `packages/core/src/agent-tools.test.ts`. The first three cases are the
security boundary — spec §12's last bullet — asserted at three different depths
so no single refactor can quietly remove all of them.

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { AGENT_TOOLS, agentToolNames, callAgentTool } from "./agent-tools.js";
import { orchestratorToolNames } from "./orchestrator-tools.js";
import { createTask } from "./task-service.js";
import { listTraces } from "./trace-store.js";

function project(): { backlogDir: string; taskId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agent-tools-"));
  initLayout({
    root,
    projectName: "agent-tools-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const task = createTask(backlogDir, { title: "Ship it", repoTargets: [path.basename(root)] });
  return { backlogDir, taskId: task.id };
}

describe("the agent tool set's boundary", () => {
  it("exposes exactly one tool", () => {
    expect(agentToolNames()).toEqual(["trace_write"]);
  });

  it("shares no name with the orchestrator set", () => {
    const agentNames = new Set(agentToolNames());
    for (const name of orchestratorToolNames()) {
      expect(agentNames.has(name)).toBe(false);
    }
  });

  it("refuses an orchestration tool by name, even when it is asked for confirmed", async () => {
    const { backlogDir } = project();

    for (const name of orchestratorToolNames()) {
      const outcome = await callAgentTool({ backlogDir, name, input: { confirmed: true } });
      expect(outcome.ok).toBe(false);
    }
  });
});

describe("trace_write", () => {
  it("records a trace, filling the context from the environment", async () => {
    const { backlogDir, taskId } = project();
    process.env.BACKLOG_RUN_ID = "run_agent_tools";
    process.env.BACKLOG_TASK_ID = taskId;

    const outcome = await callAgentTool({
      backlogDir,
      name: "trace_write",
      input: { outcome: "implemented", summary: "Renamed the widget" },
    });

    delete process.env.BACKLOG_RUN_ID;
    delete process.env.BACKLOG_TASK_ID;

    expect(outcome.ok).toBe(true);
    const traces = listTraces(backlogDir, taskId);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.summary).toBe("Renamed the widget");
  });

  it("returns the refusal, not an exception, when the payload is invalid", async () => {
    const { backlogDir, taskId } = project();

    const outcome = await callAgentTool({
      backlogDir,
      name: "trace_write",
      input: { outcome: "rejected", summary: "no", run_id: "run_1", task_id: taskId },
    });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).toContain("rejection_reason");
  });

  it("declares an input schema the model can fill without guessing", () => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === "trace_write")!;
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };

    expect(schema.required).toEqual(["outcome", "summary"]);
    expect(Object.keys(schema.properties)).toContain("open_question");
    expect(Object.keys(schema.properties)).toContain("constraints");
  });
});
```

- [x] **Step 6: Run them to verify they fail**

Run: `bun test ./packages/core/src/agent-tools.test.ts`
Expected: FAIL — `Cannot find module './agent-tools.js'`.

- [x] **Step 7: Write the agent tool set**

Create `packages/core/src/agent-tools.ts`:

```ts
import type { McpToolDefinition, McpToolOutcome } from "./mcp/server.js";
import { withTraceContextDefaults } from "./trace-context.js";
import { recordTrace } from "./trace-service.js";

// The tools an agent executing one ticket may call. A separate file from
// orchestrator-tools.ts, and a separate exported constant, because the whole
// safety property of this layer is that the two sets never merge: an execution
// agent holding `start_subtask` or `start_orchestrator` could launch further
// runs or duplicate itself — the runaway cycle the `proposed` status was built
// to close, re-entering through the MCP window (spec §2).
//
// One tool, deliberately. Reading stays on the CLI (`task show`, `trace show`,
// `claim list`), which works on every runtime; re-exposing it here would be
// work that only serves Claude Code (spec T1, §11).

const CONSTRAINT_SCHEMA = {
  type: "object",
  properties: {
    statement: { type: "string", description: "What is true, stated so a later run can act on it." },
    evidence: {
      type: "string",
      description: "Where you saw it: `path:line`, a test name, or a command's error output. No evidence, no entry.",
    },
    confidence: {
      type: "string",
      enum: ["verified", "observed"],
      description: "`verified` if you executed something that proved it; `observed` if you read code and interpreted it.",
    },
  },
  required: ["statement", "evidence", "confidence"],
} as const;

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    chose: { type: "string", description: "The option you took." },
    rejected: { type: "string", description: "The option you did not take." },
    because: { type: "string", description: "Why. This is the part a later run cannot rediscover." },
  },
  required: ["chose", "rejected", "because"],
} as const;

const DISCOVERED_DEP_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["existing"] },
        task_id: { type: "string", description: "Id of a task that already exists, e.g. task_017." },
      },
      required: ["kind", "task_id"],
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["proposal"] },
        proposal: {
          type: "object",
          properties: {
            title: { type: "string" },
            motive: { type: "string", description: "Why this work is needed, in terms a human reviewer can judge." },
            scopes: { type: "array", items: { type: "string" }, description: "Path globs it expects to touch." },
          },
          required: ["title", "motive"],
        },
      },
      required: ["kind", "proposal"],
    },
  ],
} as const;

export const AGENT_TOOLS: McpToolDefinition[] = [
  {
    name: "trace_write",
    description:
      "Record what you decided on this ticket. This is the only channel that moves the ticket's status, and the only thing about this run that survives it. Call it once, before you finish. `outcome: blocked` is how you ask for help — there is no agent-to-agent channel. You cannot mark your own work done: `implemented` records the trace and lets the run's own success handling decide review-vs-complete.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["implemented", "rejected", "blocked"],
          description:
            "`implemented`: you did the work. `rejected`: the ticket should not be done, and you say why. `blocked`: you cannot proceed, and you state the open question.",
        },
        summary: { type: "string", description: "What happened, in a few sentences." },
        rejection_reason: { type: "string", description: "Required when outcome is `rejected`." },
        open_question: {
          type: "string",
          description: "Required when outcome is `blocked`. The question a human has to answer to unblock this.",
        },
        constraints: { type: "array", items: CONSTRAINT_SCHEMA },
        decisions: { type: "array", items: DECISION_SCHEMA },
        discovered_deps: {
          type: "array",
          items: DISCOVERED_DEP_SCHEMA,
          description:
            "Work this ticket turned out to depend on. An existing id becomes an edge; anything else becomes a proposed ticket a human reviews.",
        },
        consolidation_hint: {
          type: "string",
          enum: ["none", "high"],
          description: "`high` marks a trace worth reading when the project's documentation is next rewritten.",
        },
        consolidation_hint_reason: { type: "string", description: "Required when consolidation_hint is `high`." },
      },
      required: ["outcome", "summary"],
    },
  },
];

export function agentToolNames(): string[] {
  return AGENT_TOOLS.map((tool) => tool.name);
}

export interface AgentToolCall {
  backlogDir: string;
  name: string;
  input: unknown;
}

/**
 * Run one agent tool. Never throws: a failure comes back as `ok: false` with a
 * message the model can read and act on, exactly like the orchestrator side.
 *
 * The unknown-tool branch is the boundary's last line of defence. The host
 * built in `packages/cli/src/commands/mcp.ts` already advertises only
 * AGENT_TOOLS, and `handleMcpRequest` rejects a call to anything it did not
 * advertise — but a name that leaked into the advertised list through some
 * later refactor would still die here rather than dispatch. Guard the writer,
 * not only the readers.
 */
export async function callAgentTool(call: AgentToolCall): Promise<McpToolOutcome> {
  try {
    if (call.name !== "trace_write") {
      throw new Error(`Unknown tool: ${call.name}. An execution agent may only call: ${agentToolNames().join(", ")}.`);
    }
    const payload = (call.input ?? {}) as Record<string, unknown>;
    const result = recordTrace({
      backlogDir: call.backlogDir,
      trace: withTraceContextDefaults(payload, process.env),
    });
    return {
      ok: true,
      result: {
        recorded: true,
        task_id: result.trace.task_id,
        outcome: result.trace.outcome,
        transitions: result.transitions,
        linked_dependencies: result.linkedDeps,
        created_proposals: result.createdProposals,
      },
    };
  } catch (error) {
    return { ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
```

`callAgentTool` is `async` even though nothing in it awaits: it has to satisfy
`McpToolHost.callTool`, whose signature returns a promise because the
orchestrator side genuinely does I/O.

- [x] **Step 8: Export both modules from `core`**

In `packages/core/src/index.ts`, beside the existing
`export * from "./orchestrator-tools.js";` (line 9) and
`export * from "./trace-service.js";` (line 38):

```ts
export * from "./agent-tools.js";
export * from "./trace-context.js";
```

- [x] **Step 9: Delete the CLI's duplicate of the context helper**

In `packages/cli/src/commands/trace.ts`: delete the `withContextDefaults`
function (lines 42-63 as shipped) and its comment block, add
`withTraceContextDefaults` to the existing `@backlog/core` import, and change
the one call site inside `runTraceWrite`:

```ts
import { listTraces, recordTrace, withTraceContextDefaults, type RecordTraceResult } from "@backlog/core";

// …

export function runTraceWrite(
  backlogDir: string,
  payload: Record<string, unknown>,
): RecordTraceResult {
  const filled = withTraceContextDefaults(payload, process.env);
  // recordTrace re-parses through traceSchema, so an invalid payload throws
  // before anything is persisted.
  return recordTrace({ backlogDir, trace: filled });
}
```

- [x] **Step 10: Run the tests to verify they pass**

Run: `bun run test`
Expected: PASS. `agent-tools.test.ts` (6 cases) and `trace-context.test.ts`
(3 cases) are new; the existing `trace.test.ts` cases in `packages/cli` must
still pass unchanged — they exercise `runTraceWrite`, whose behaviour is
identical.

- [x] **Step 11: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/agent-tools.ts packages/core/src/agent-tools.test.ts \
        packages/core/src/trace-context.ts packages/core/src/trace-context.test.ts \
        packages/core/src/index.ts packages/cli/src/commands/trace.ts
git commit -m "feat(core): give execution agents their own MCP tool set"
```

---

### Task 3: `backlog mcp-server` serves the set you ask for, least privilege by default

**Files:**
- Modify: `packages/cli/src/commands/mcp.ts`
- Create: `packages/cli/src/commands/mcp.test.ts`
- Modify: `packages/server/src/lib/chat/claude-code-chat.ts:74-79`
- Modify: `packages/server/src/lib/chat/claude-code-chat.test.ts:29`

**Interfaces:**
- Consumes: `AGENT_TOOLS` / `callAgentTool` / `agentToolNames` (Task 2),
  `ORCHESTRATOR_TOOLS` / `callOrchestratorTool` (shipped),
  `McpToolHost` (shipped).
- Produces, for Task 4:
  - `export type McpAudience = "agent" | "orchestrator"`
  - `export function mcpHostFor(backlogDir: string, audience: McpAudience): McpToolHost`
  - the CLI contract `backlog mcp-server [--audience agent|orchestrator] [--project <path>]`,
    whose `--audience` **defaults to `agent`**.

**Why the default flips to the less privileged set.** `backlog mcp-server`
today serves the orchestrator set implicitly. If the default stayed there and
any future caller forgot the flag, an execution agent would silently receive
`start_subtask` — a silent privilege escalation. With `agent` as the default,
the same mistake makes the *chat* lose its tools, which fails loudly and harms
nothing. The chat is the one caller today, and it is updated here to say what
it wants.

- [x] **Step 1: Write the failing test**

Create `packages/cli/src/commands/mcp.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { agentToolNames, orchestratorToolNames } from "@backlog/core";
import { mcpHostFor, parseAudience } from "./mcp.js";

describe("mcpHostFor", () => {
  it("serves only the agent tool set to an execution agent", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "agent");

    expect(host.tools.map((tool) => tool.name)).toEqual(agentToolNames());
  });

  it("serves the orchestrator tool set to the chat", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "orchestrator");

    expect(host.tools.map((tool) => tool.name)).toEqual(orchestratorToolNames());
  });

  it("never advertises an orchestration tool to an execution agent", () => {
    const advertised = new Set(mcpHostFor("/tmp/project/.backlog", "agent").tools.map((tool) => tool.name));

    for (const name of orchestratorToolNames()) {
      expect(advertised.has(name)).toBe(false);
    }
  });
});

describe("parseAudience", () => {
  it("defaults to the least privileged set", () => {
    expect(parseAudience(undefined)).toBe("agent");
  });

  it("accepts both audiences", () => {
    expect(parseAudience("agent")).toBe("agent");
    expect(parseAudience("orchestrator")).toBe("orchestrator");
  });

  it("rejects anything else rather than falling back to a privileged default", () => {
    expect(() => parseAudience("admin")).toThrow(/agent|orchestrator/);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `bun test ./packages/cli/src/commands/mcp.test.ts`
Expected: FAIL — `mcpHostFor` and `parseAudience` are not exported.

- [x] **Step 3: Write the implementation**

Replace the body of `packages/cli/src/commands/mcp.ts`:

```ts
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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `bun test ./packages/cli/src/commands/mcp.test.ts`
Expected: PASS (6 cases).

- [x] **Step 5: Make the chat ask for its set explicitly**

In `packages/server/src/lib/chat/claude-code-chat.ts`, inside
`buildChatCommand`:

```ts
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: input.selfCommand,
        // Explicit: `mcp-server` defaults to the agent tool set, which has no
        // orchestration tools. The chat is the one caller that needs them.
        args: [...input.selfPrefixArgs, "mcp-server", "--audience", "orchestrator", "--project", input.backlogDir],
      },
    },
```

- [x] **Step 6: Update the chat's test to the new argv**

In `packages/server/src/lib/chat/claude-code-chat.test.ts`, the case
`"declares Backlog's own MCP server and nothing else"`:

```ts
    expect(config.mcpServers.backlog?.args).toEqual([
      "mcp-server",
      "--audience",
      "orchestrator",
      "--project",
      "/tmp/project/.backlog",
    ]);
```

The neighbouring case `"re-invokes itself through the prefix args a dev run
needs"` asserts `args.slice(0, 2)` equals `["/repo/bin.ts", "mcp-server"]` — the
new flag lands after `mcp-server`, so that case needs no change. Verify it, do
not assume it.

- [x] **Step 7: Run the full suite**

Run: `bun run test`
Expected: PASS across all packages.

- [x] **Step 8: Typecheck and commit**

```bash
bun run typecheck
git add packages/cli/src/commands/mcp.ts packages/cli/src/commands/mcp.test.ts \
        packages/server/src/lib/chat/claude-code-chat.ts \
        packages/server/src/lib/chat/claude-code-chat.test.ts
git commit -m "feat(cli): serve two disjoint MCP tool sets, least privilege by default"
```

---

### Task 4: A coding run carries the agent tool set

**Files:**
- Modify: `packages/core/src/providers/types.ts:73-84` (`ProviderRunRequest`)
- Modify: `packages/core/src/providers/claude-code/command.ts:27-28, 80-84`
- Modify: `packages/core/src/providers/claude-code/provider.ts:95-104`
- Modify: `packages/core/src/run-executor.ts` (the `executeRun` call site)
- Test: `packages/core/src/providers/claude-code/command.test.ts`
- Test: `packages/core/src/providers/claude-code/provider.test.ts`

**Interfaces:**
- Consumes: `agentToolNames()` (Task 2), the `--audience agent` CLI contract
  (Task 3), `selfExec()` and `MCP_SERVER_NAME` (shipped, exported from `core`).
- Produces: every Claude Code coding run is spawned with
  `--mcp-config {"mcpServers":{"backlog":{…"mcp-server","--audience","agent","--project",<backlogDir>}}}`
  and `--allowedTools mcp__backlog__trace_write`.

**Two deliberate choices, both testable.**

*No `--strict-mcp-config` on a run.* The flag means "only what we declare", and
the chat wants it: the chat drives the orchestrator and has no business reaching
a user's own servers. A coding agent is different — the user's configured MCP
servers are capability they chose, and silently removing them from every run is
a regression nobody asked for. `command.ts` gains `strictMcpConfig`, defaulting
to `true` so the chat's behaviour does not change, and the run passes `false`.

*A `read-only` agent cannot use this tool.* `permissionModeFor` maps
`read-only` to `plan`, and plan mode refuses MCP calls (measured, `CLAUDE.md`
§3). The server is still attached — the cost is one spawned subprocess — and
such an agent falls back to `backlog trace write`, which Task 5's prompt names.
Making the trace reachable under plan mode is a permissions problem, not an MCP
one, and is out of scope here.

- [x] **Step 1: Write the failing tests for the command builder**

Append to `packages/core/src/providers/claude-code/command.test.ts`:

```ts
  it("keeps --strict-mcp-config by default, so the chat is unaffected", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "hi",
      mcpServers: { backlog: { command: "/usr/local/bin/backlog", args: ["mcp-server"] } },
    });

    expect(command.args).toContain("--strict-mcp-config");
  });

  it("leaves a run's own MCP servers in place when strictness is waived", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "hi",
      mcpServers: { backlog: { command: "/usr/local/bin/backlog", args: ["mcp-server"] } },
      strictMcpConfig: false,
    });

    expect(command.args).toContain("--mcp-config");
    expect(command.args).not.toContain("--strict-mcp-config");
  });
```

- [x] **Step 2: Run them to verify the second fails**

Run: `bun test ./packages/core/src/providers/claude-code/command.test.ts`
Expected: the first PASSES (current behaviour), the second FAILS — TypeScript
rejects `strictMcpConfig`, and the flag is present regardless.

- [x] **Step 3: Add the opt-out to the command builder**

In `packages/core/src/providers/claude-code/command.ts`, add to
`ClaudeCodeCommandInput` beside `mcpServers`:

```ts
  /**
   * Whether to hide the user's own MCP servers behind ours. Default true, which
   * is what the chat wants: it drives the orchestrator and has no business
   * reaching a user's servers. A coding run passes false — those servers are
   * capability the user configured, and removing them silently is a regression.
   */
  strictMcpConfig?: boolean | undefined;
```

and change the block at line 80:

```ts
  if (input.mcpServers) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: input.mcpServers }));
    if (input.strictMcpConfig !== false) {
      args.push("--strict-mcp-config");
    }
  }
```

- [x] **Step 4: Run to verify both pass**

Run: `bun test ./packages/core/src/providers/claude-code/command.test.ts`
Expected: PASS, including every pre-existing case.

- [x] **Step 5: Write the failing test for the provider**

Append to `packages/core/src/providers/claude-code/provider.test.ts`. That file
already has an `agentFixture(overrides)` helper (line 5) and a `noSecrets`
const (line 23) — reuse both. It has no seam that observes `executeRun`'s argv
without spawning a real `claude`, so Step 8 extracts one: `buildRunCommand`,
exported from `provider.ts`, which `executeRun` then calls.

Add `import { buildRunCommand, ClaudeCodeProvider } from "./provider.js";` to
the file's existing import.

```ts
  it("attaches the agent tool set to a coding run, and nothing else", () => {
    const command = buildRunCommand({
      agent: agentFixture({ sandbox_mode: "workspace-write" }),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    expect(config.mcpServers.backlog?.args).toContain("--audience");
    expect(config.mcpServers.backlog?.args).toContain("agent");
    expect(config.mcpServers.backlog?.args.slice(-2)).toEqual(["--project", "/tmp/project/.backlog"]);

    const allowed = command.args[command.args.indexOf("--allowedTools") + 1]!.split(",");
    expect(allowed).toEqual(["mcp__backlog__trace_write"]);
    expect(command.args).not.toContain("--strict-mcp-config");
  });
```

- [x] **Step 6: Run it to verify it fails**

Run: `bun test ./packages/core/src/providers/claude-code/provider.test.ts`
Expected: FAIL — `backlogDir` is not on `ProviderRunRequest`, and no
`--mcp-config` is produced.

- [x] **Step 7: Add `backlogDir` to the provider contract**

In `packages/core/src/providers/types.ts`, inside `ProviderRunRequest`:

```ts
export interface ProviderRunRequest {
  agent: Agent;
  prompt: string;
  cwd: string;
  /**
   * The project this run belongs to. Not derivable from `cwd`: an in_repo
   * project's worktree carries a shadow `.backlog/config.toml`, so walking up
   * from the worktree finds the wrong project. Runtimes that spawn Backlog's
   * own MCP server pass it through explicitly.
   */
  backlogDir: string;
  /** Where a runtime may drop its own scratch files. Defaults to `cwd`. */
  scratchDir?: string | undefined;
  // … rest unchanged
}
```

- [x] **Step 8: Attach the server in the Claude Code provider**

In `packages/core/src/providers/claude-code/provider.ts`, add the imports and
build the command through a named helper so it stays testable without spawning:

```ts
import { MCP_SERVER_NAME } from "../../mcp/server.js";
import { agentToolNames } from "../../agent-tools.js";
import { selfExec } from "../../self-exec.js";
import type { ProviderCommand } from "./command.js";
```

```ts
/** MCP tools are namespaced by their server; the CLI needs the full name to allow them. */
function namespacedAgentTools(): string[] {
  return agentToolNames().map((name) => `mcp__${MCP_SERVER_NAME}__${name}`);
}

/**
 * The `claude` invocation for one coding run. Extracted from executeRun so the
 * flag matrix — which tool set the agent gets, and which it does not — is
 * asserted by a unit test rather than by spawning a real CLI.
 */
export function buildRunCommand(request: ProviderRunRequest): ProviderCommand {
  const { agent } = request;
  const self = selfExec();
  return buildClaudeCodeCommand({
    executable: resolveExecutable(claudeExecutableFor(agent)),
    prompt: request.prompt,
    model: agent.model,
    reasoningEffort: request.reasoningEffort,
    profile: agent.profile,
    sandboxMode: agent.sandbox_mode,
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: self.command,
        // --audience agent is what keeps `start_subtask` and friends out of an
        // execution agent's reach. --project is mandatory: the run's cwd is a
        // worktree carrying a shadow .backlog/, so resolution from cwd is wrong.
        args: [...self.prefixArgs, "mcp-server", "--audience", "agent", "--project", request.backlogDir],
      },
    },
    // `--allowedTools` only auto-approves; it excludes nothing. The agent keeps
    // every built-in tool it needs to do the work.
    allowedTools: namespacedAgentTools(),
    // The user's own MCP servers stay available to a coding agent — see the
    // note on strictMcpConfig in command.ts.
    strictMcpConfig: false,
  });
}
```

and replace the first statements of `executeRun`:

```ts
  async executeRun(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const { agent } = request;
    const command = buildRunCommand(request);
```

- [x] **Step 9: Pass `backlogDir` from the run executor**

In `packages/core/src/run-executor.ts:180`, add `backlogDir: params.backlogDir,`
to the `provider.executeRun({ … })` call. That is the only call site in the
codebase — three providers *implement* the contract (`claude-code`, `codex`,
`custom`), but one place builds the request, so a required field breaks exactly
one line. Confirm with:

```bash
grep -rn "executeRun(" packages --include="*.ts" | grep -v "\.test\."
```

- [x] **Step 10: Run the tests to verify they pass**

Run: `bun run test`
Expected: PASS. `run-executor.test.ts` must still pass unchanged — it drives a
`custom` agent, which ignores the new field.

- [x] **Step 11: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/providers packages/core/src/run-executor.ts
git commit -m "feat(core): hand every Claude Code run its agent tool set over MCP"
```

---

### Task 5: The prompt tells the agent all of this exists

**Files:**
- Modify: `packages/core/src/run-prompt.ts`
- Create: `packages/core/src/run-prompt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — `buildProviderPrompt`'s signature does
  not change. The prompt names *environment variables*, not values, so it needs
  no new inputs.
- Produces: nothing later tasks consume.

**Why this is the highest-yield item in the spec.** The action surface has been
shipped for months and no agent has ever been told it exists (spec §2). This is
a paragraph of prose, and it is worth more than the four tasks above it.

It lives in `run-prompt.ts` rather than in `--append-system-prompt` so that
every runtime gets it — the CLI works everywhere, hooks and system-prompt flags
do not (spec §9). The trace contract is a section of its own at the end, and is
also referenced from the instruction list, because a contract that gets dropped
with the tail of a long list is a contract that does not exist.

- [x] **Step 1: Write the failing test**

Create `packages/core/src/run-prompt.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { Task } from "@backlog/schemas";
import { buildProviderPrompt } from "./run-prompt.js";
import type { ExecutionTarget } from "./execution-target.js";

const workItem = {
  id: "task_001",
  title: "Rename the widget",
  description: "",
  status: "in_progress",
  acceptance_criteria: [],
} as unknown as Task;

const target = {
  id: "subtask_001",
  title: "Rename it in the board",
  target_type: "subtask",
  repo: "backlog",
  risk: "low",
  scopes: ["packages/board-ui/**"],
  depends_on: [],
  completion: { done_when: [] },
  planner: { origin: "explicit" },
} as unknown as ExecutionTarget;

describe("buildProviderPrompt", () => {
  it("discloses the ids the agent's environment carries", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt).toContain("BACKLOG_TASK_ID");
    expect(prompt).toContain("BACKLOG_SUBTASK_ID");
    expect(prompt).toContain("BACKLOG_RUN_ID");
  });

  it("names the read commands that exist, and only those", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt).toContain("backlog task show");
    expect(prompt).toContain("backlog subtask show");
    expect(prompt).toContain("backlog trace show");
    expect(prompt).toContain("backlog claim list");
    // `backlog ticket trace` is the spec's name for a command that shipped as
    // `trace show`. Advertising a command that does not exist costs the agent a
    // wasted turn and teaches it the CLI lies.
    expect(prompt).not.toContain("ticket trace");
  });

  it("states the trace contract, with both channels", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt).toContain("trace_write");
    expect(prompt).toContain("backlog trace write");
    expect(prompt).toContain("rejection_reason");
    expect(prompt).toContain("open_question");
  });

  it("tells the agent that blocking is how it asks for help", () => {
    const prompt = buildProviderPrompt(target, workItem);

    expect(prompt.toLowerCase()).toContain("blocked");
  });

  it("keeps the trace contract reachable from the instruction list too", () => {
    const prompt = buildProviderPrompt(target, workItem);
    // Bounded on both sides: sliced only from "Instructions:" onwards, this
    // would swallow the trace section itself and pass no matter what.
    const instructions = prompt.slice(
      prompt.indexOf("Instructions:"),
      prompt.indexOf("Recording your work"),
    );

    expect(instructions).toContain("trace");
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `bun test ./packages/core/src/run-prompt.test.ts`
Expected: FAIL on the first case — the prompt mentions none of this today.

- [x] **Step 3: Write the implementation**

In `packages/core/src/run-prompt.ts`, add the two blocks and one instruction
line:

```ts
// What the agent can see and do beyond editing files. The whole action surface
// below has been shipped for a long time; until this section existed, no agent
// was ever told about any of it (spec §2). It lives here rather than behind
// --append-system-prompt so every runtime gets it: the CLI works everywhere,
// runtime-specific prompt flags do not (spec §9).
const BACKLOG_CONTEXT = [
  "Backlog context:",
  "- Your environment carries BACKLOG_TASK_ID, BACKLOG_SUBTASK_ID, BACKLOG_RUN_ID, BACKLOG_REPO, BACKLOG_BRANCH and BACKLOG_WORKTREE.",
  "- A `backlog` CLI is on your PATH and already resolves this project. You do not need --project.",
  "- `backlog task show <task-id>` — the ticket, its status, its dependencies.",
  "- `backlog subtask show <subtask-id>` — this unit of work.",
  "- `backlog trace show <task-id>` — what earlier runs on this ticket decided, and why. Read it before you start.",
  "- `backlog claim list` — which paths other agents currently hold. Do not edit a path someone else holds.",
];

// The trace is the only channel out of this run: it is what moves the ticket,
// and it is the only thing about this run that outlives it. Stated as its own
// closing section, and referenced from the instruction list above, because a
// contract that gets dropped with the tail of a long list is not a contract.
const TRACE_CONTRACT = [
  "Recording your work (required):",
  "- Before you finish, record a trace. Call the `trace_write` tool if you have it; otherwise pipe the same JSON object into `backlog trace write`.",
  '- The payload is {"outcome": "implemented" | "rejected" | "blocked", "summary": "..."}.',
  "- `rejected` also requires `rejection_reason`. `blocked` also requires `open_question` — that is how you ask a human for help, and it is the only way. There is no channel to another agent.",
  "- Add `constraints` for anything a later run would otherwise rediscover. Each one needs `evidence`: a path:line, a test name, or a command's output. No evidence, no entry.",
  "- Add `decisions` for what you chose, what you rejected, and why. The `why` is the part nobody can reconstruct from the diff.",
  "- Add `discovered_deps` for work this ticket turned out to depend on. An existing task id becomes a dependency edge; anything else becomes a proposal a human reviews.",
  "- Do not try to move the ticket yourself. The trace moves it, and it cannot mark your own work done.",
];
```

Add one line to `INSTRUCTIONS`, after the existing closing-summary line:

```ts
  "- end with a concise summary of what changed and any follow-up risk",
  "- then record your trace, as described under 'Recording your work' below",
```

And place both blocks in `lines`, inside `buildProviderPrompt`. `BACKLOG_CONTEXT`
goes before `Allowed scopes:` — an agent should know what it can consult before
it is told what it may touch. `TRACE_CONTRACT` closes the prompt, after the
acceptance criteria:

```ts
    `Repository: ${task.repo}`,
    `Risk: ${task.risk}`,
    "",
    ...BACKLOG_CONTEXT,
    "",
    ...section("Allowed scopes:", task.scopes, "**"),
```

```ts
  if (workItem.acceptance_criteria.length > 0) {
    lines.push("", "Task acceptance criteria:", ...workItem.acceptance_criteria.map((item) => `- ${item}`));
  }

  lines.push("", ...TRACE_CONTRACT);

  return lines.join("\n");
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `bun test ./packages/core/src/run-prompt.test.ts`
Expected: PASS (6 cases).

- [x] **Step 5: Check what else asserts on the prompt**

Run: `bun run test`
Expected: PASS. `run-executor.test.ts` has a case reading the written prompt
file and asserting it contains `"Allowed scopes:"` — that still holds. If any
snapshot-style assertion breaks, update it rather than trimming the prompt.

- [x] **Step 6: Read the whole prompt once, as a human**

A test proves the words are present. It cannot tell you the paragraph reads as
an instruction rather than as boilerplate an agent will skim. Print one and read
it top to bottom:

```bash
bun -e '
import { buildProviderPrompt } from "./packages/core/src/run-prompt.ts";
const workItem = { id: "task_001", title: "Rename the widget", description: "", acceptance_criteria: [] };
const target = {
  id: "subtask_001", title: "Rename it in the board", target_type: "subtask",
  repo: "backlog", risk: "low", scopes: ["packages/board-ui/**"], depends_on: [],
  completion: { done_when: [] }, planner: { origin: "explicit" },
};
console.log(buildProviderPrompt(target, workItem));
'
```

Check three things specifically: that the trace section reads as required
rather than optional, that no command named in it is one you have not verified
exists, and that the whole prompt still fits on roughly two screens. If it has
grown past that, cut from `INSTRUCTIONS`, not from the trace contract.

- [x] **Step 7: Commit**

```bash
bun run typecheck
git add packages/core/src/run-prompt.ts packages/core/src/run-prompt.test.ts
git commit -m "feat(core): tell the agent what it can see and what it must record"
```

---

### Task 6: Make the documentation true again

**Files:**
- Modify: `CLAUDE.md` §3 ("How the AI is wired") and §8 ("Tooling depth")
- Modify: `docs/superpowers/specs/2026-08-17-agent-ticket-tools-design.md:3` (status line)
- Modify: this plan's own status — mark every task's checkboxes

**Interfaces:** none.

Three statements in the repository become false the moment Task 5 lands. A
future agent will trust them; the standing rule in `CLAUDE.md` §1 is that a
change nobody can discover is not finished.

- [x] **Step 1: Correct `CLAUDE.md` §3**

The "How the AI is wired" section describes MCP as the orchestrator chat's
transport only. Add, under the orchestrator-chat subsection or as its own
paragraph:

```markdown
**Two MCP audiences, one transport.** `backlog mcp-server` serves whichever
tool set `--audience` asks for, and defaults to `agent` — the less privileged
one — so a caller that forgets the flag loses tools rather than gaining the
ability to start runs. The chat asks for `orchestrator` explicitly
(`ORCHESTRATOR_TOOLS`, nine tools, confirmation-gated). A coding run gets
`AGENT_TOOLS`: exactly one tool, `trace_write`, attached by
`providers/claude-code/provider.ts` via `--mcp-config`. The two sets are
separate files and separate dispatchers, and
`packages/core/src/agent-tools.test.ts` asserts they never intersect — an
execution agent holding `start_subtask` could launch further runs and duplicate
itself, which is the runaway cycle `proposed` exists to close.
```

- [x] **Step 2: Correct `CLAUDE.md` §8**

The bullet reading *"Claude Code's real surface is still mostly unused: skills,
MCP servers, hooks, subagents and session resumption have no representation in
the provider contract. `--model`, `--effort`, `--permission-mode` and
`--append-system-prompt` are the whole integration."* is now wrong on two
counts. Replace it with:

```markdown
- Claude Code's real surface is still only partly used: skills, hooks,
  subagents and session resumption have no representation in the provider
  contract. MCP does — a coding run is spawned with `--mcp-config` and
  Backlog's own `trace_write` tool — but `--model`, `--effort`,
  `--permission-mode`, `--append-system-prompt` and `--mcp-config` are still
  the whole integration.
```

Also revise the bullet *"Permission modes are coarse: `read-only` maps to
`plan`…"* to record the consequence this plan discovered:

```markdown
- Permission modes are coarse: `read-only` maps to `plan`, everything else to
  `bypassPermissions`. There is no per-tool or per-path story — and because
  plan mode refuses MCP calls, a `read-only` agent cannot reach `trace_write`
  at all; it has to fall back to `backlog trace write`.
```

- [x] **Step 3: Update the spec's status line**

`docs/superpowers/specs/2026-08-17-agent-ticket-tools-design.md` line 3 reads
`Status: **approved design, not yet planned**`, which PR #11 already made
stale. Replace with:

```markdown
Status: **approved** · §5 §6 §9 implemented (traces, MCP tool set, prompt
disclosure) · §7 `proposed` implemented · §8 audit pass not started
```

- [x] **Step 4: Verify the whole thing, for real**

```bash
bun run typecheck
bun run test
bun run build
```

Expected: typecheck clean; every test passing with a strictly higher count than
the baseline and no pre-existing expectation weakened; the binary compiles.

The baseline is **728 pass / 0 fail across 88 files**, measured with `bun run
test` on `a6ae29b`. (The PR #11 handoff records 630; that figure does not
reproduce and should not be used.)

Then check the binary actually carries the new flag — the build has silently
diverged from a dev run before:

```bash
./dist/backlog mcp-server --help
```

Expected: the `--audience` option is listed and its description names both
audiences.

- [x] **Step 5: Prove the tool set is really disjoint at runtime**

A unit test asserts the lists do not intersect. This asserts the *server* obeys
it, which is what an agent actually talks to:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | ./dist/backlog mcp-server --project "$PWD/.backlog" 2>/dev/null
```

Expected: the `tools/list` response advertises `trace_write` and nothing else.
Re-run it with `--audience orchestrator` and confirm the nine orchestrator
tools come back instead. If this project has no `.backlog/`, run it against any
project that does.

- [x] **Step 6: Commit and open the PR**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-17-agent-ticket-tools-design.md \
        docs/superpowers/plans/2026-08-17-agent-mcp-tools-and-prompt-disclosure.md
git commit -m "docs: record the agent tool set and the prompt disclosure"
```

Then follow `CLAUDE.md` §10: open the PR, merge it directly, `git checkout main
&& git pull`, and delete the worktree.

---

## What this plan deliberately does not do

Each of these is in the spec and is left for a later pass, with the reason.

- **The audit pass (spec §8).** `proposal.audit` is written by `recordTrace` and
  read by nothing. It shares machinery with the consolidator — batch, cursor,
  journal — so building it before the consolidator would build that machinery
  twice.
- **The consolidation verdict in `trace show` (spec §6).** There is no
  consolidator, so there is no verdict.
- **The `proposed` column in the board (spec §10).** The whole board half of the
  spec: conditional column, accept/reject actions, `i18n/{en,fr}.json`. This
  plan is backend-only and produces working software without it — proposals are
  created and are already invisible to the scheduler.
- **Re-exposing the read surface over MCP (spec §11).** T1 stands: reading works
  on every runtime through the CLI.
- **Scope enforcement (spec §11).** Allowed scopes stay advisory. Real
  enforcement is a `PreToolUse` hook on Edit/Write.
- **`trace_write` for non-Claude runtimes.** Codex and custom agents get the
  prompt disclosure and the CLI fallback, which is the whole point of putting
  the disclosure in `run-prompt.ts`. Only Claude Code gets the typed tool,
  because only Claude Code speaks `--mcp-config`.
