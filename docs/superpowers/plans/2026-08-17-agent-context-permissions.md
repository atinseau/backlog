# Agent context permissions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every permission decision about a Backlog-launched model into one
table, expose the four ticket reads an execution agent needs as MCP tools, and
make the `backlog` binary refuse an execution agent.

**Architecture:** A context (`execution` / `orchestrator` / `completion`)
declares MCP audience, denied built-ins, allowed tools, user-MCP visibility and
CLI role. The three sites that spawn a model read their context instead of
carrying hand-written lists. Façade tools call the same core services the CLI
commands call. The binary refuses when `BACKLOG_AGENT_ROLE=execution`, with the
pre-commit hook exempt.

**Tech Stack:** Bun 1.3+ (runtime, package manager, test runner, bundler),
TypeScript, Zod (`packages/schemas`), commander (CLI), Svelte 5 (board).

**Spec:** [`docs/superpowers/specs/2026-08-17-agent-context-permissions-design.md`](../specs/2026-08-17-agent-context-permissions-design.md)

## Global Constraints

- **Bun only.** No Node, npm, pnpm, tsx, tsup or vitest. Tests are `bun:test`.
- **Run the whole suite as `bun run test`, never bare `bun test`.** Bare
  `bun test` with no path silently walks only part of the workspace. A single
  file is fine: `bun test packages/core/src/foo.test.ts`.
- **Imports keep the `.js` extension** (`./contexts.js` → `contexts.ts`). Bun
  and TypeScript both resolve it.
- **Use `homeDir()` from `@backlog/config`, never `os.homedir()`.** Bun reads
  `os.homedir()` from the password database and ignores a reassigned `HOME`;
  the test suite sandboxes `HOME`.
- **Never resolve runtime files from `import.meta.url`, never re-invoke the CLI
  via `process.argv[1]`.** Inside the compiled binary both are `/$bunfs/`
  paths. Use `selfExec()` from `packages/cli/src/self-exec.ts`.
- **Visible copy goes in both `packages/board-ui/src/lib/i18n/en.json` and
  `fr.json`**, and stays aligned key for key.
- **Vocabulary:** project · repository · task · subtask · run · claim · agent.
  No new "repo"/"workspace" user-facing copy.
- **If you work in a git worktree under `.claude/worktrees/`, run `bun install`
  inside it first.** The parent repo has no `node_modules/@backlog/`; without
  the install you get ~68 `Cannot find module '@backlog/config'` failures.
- **Ignore LSP `Cannot find module '@backlog/*'` diagnostics.** They appear even
  in the main checkout where the suite passes. Re-run `bun run typecheck` before
  believing any module-resolution complaint.
- **Establish the test baseline yourself before Task 1** with `bun run test`,
  and record the number. At the time of writing `main` is 763 pass / 0 fail
  across 92 files, but a previous plan shipped with a stale baseline — verify,
  do not copy.
- **Before every commit:** `bun run typecheck` and `bun run test`.

---

## File Structure

**New:**

| File | Responsibility |
| --- | --- |
| `packages/core/src/contexts/types.ts` | The `AgentContext` shape and the `AgentContextId` union. Nothing else. |
| `packages/core/src/contexts/contexts.ts` | The table itself, plus `contextFor(id)`. The only place a permission is decided. |
| `packages/core/src/contexts/contexts.test.ts` | Integrity + containment invariants over the table. |
| `packages/core/src/mcp/catalog.ts` | Every façade tool, with no notion of who may see it. |
| `packages/core/src/mcp/read-tools.ts` | The four read tools' definitions and dispatcher. |
| `packages/core/src/mcp/read-tools.test.ts` | Behaviour of the four reads against a temp project. |
| `packages/cli/src/role-guard.ts` | The one rule the binary applies under an execution role, and the hook exemption. |
| `packages/cli/src/role-guard.test.ts` | Refusal, and the exemption that keeps the claim check alive. |

**Modified:** `packages/core/src/run-executor.ts`,
`packages/core/src/run-prompt.ts`,
`packages/core/src/providers/claude-code/provider.ts`,
`packages/core/src/providers/index.ts`,
`packages/core/src/run-launcher.ts`, `packages/core/src/run-service.ts`,
`packages/core/src/worktrees.ts`, `packages/core/src/agents.ts`,
`packages/core/src/usage.ts`, `packages/core/src/run-merge.ts`,
`packages/core/src/provider-usage.ts`,
`packages/server/src/lib/chat/claude-code-chat.ts`,
`packages/server/src/routes/runs.ts`, `packages/cli/src/commands/mcp.ts`,
`packages/cli/src/bin.ts`, `packages/config/src/shim.ts`,
`packages/config/src/init-layout.ts`, `packages/schemas/src/run.ts`,
`packages/schemas/src/task.ts`, and the board files named per task.

**Deleted:** `packages/core/src/providers/codex/` (4 files),
`packages/board-ui/src/lib/DirectDirtyDialog.svelte`.

`packages/core/src/agent-tools.ts` survives as the home of `trace_write` and its
security test; the catalogue imports from it rather than replacing it.

---

## Task 1: Remove the `direct` execution mode

Every run happens in an isolated git worktree. The mode that let an agent work
in the user's own checkout goes, and with it the dirty-checkout inspection, its
dialog and its three typed skip reasons.

Two facts that shape this task:

- `packages/core/src/run-launcher.ts:242` reads
  `workItem.execution_defaults?.worktree_mode ?? "direct"`, and
  `packages/schemas/src/task.ts:88` defaults the field to `"direct"`. **Direct
  is today's effective default**, not a rare option.
- Zod objects here are non-strict, so removing a key from a schema makes
  existing files carrying it parse fine — the key is stripped. Archived
  `run.json` records with `execution_mode: "direct"` keep loading.

**Files:**
- Modify: `packages/schemas/src/run.ts:36` — delete the `execution_mode` field
- Modify: `packages/schemas/src/task.ts:88,104` — delete `worktree_mode` from the shape and from the defaults object
- Modify: `packages/core/src/run-launcher.ts:28-51` (delete `inspectDirectCheckout`), `:96`, `:173`, `:242-292`, `:355-400`
- Modify: `packages/core/src/run-service.ts:144,202,397,501,566`
- Modify: `packages/core/src/worktrees.ts:207,218,245,255`
- Modify: `packages/core/src/run-executor.ts:65-69,129-132`
- Modify: `packages/core/src/run-prompt.ts:57,63-68`
- Modify: `packages/server/src/routes/runs.ts:31,212`
- Modify: `packages/board-ui/src/App.svelte:1250-1252,1316`, `lib/api.ts:1020`, `lib/RunStatusDisplay.svelte:45-46`, `lib/ClaimsView.svelte:167`, `lib/run-start-errors.ts:42-44`, `lib/CreateTaskDialog.svelte`, `lib/types.ts`
- Delete: `packages/board-ui/src/lib/DirectDirtyDialog.svelte`
- Modify: `packages/board-ui/src/lib/i18n/en.json` and `fr.json` — delete `run_status.mode.direct`, `claims_view.mode.direct`, `card.play_direct_dirty`, `card.play_direct_busy`, and the `DirectDirtyDialog` keys
- Modify: `packages/core/src/run-launcher.test.ts` — the 5 direct-mode assertions
- Modify: `CLAUDE.md` §2 — the `Run` paragraph naming two execution modes

**Interfaces:**
- Consumes: nothing.
- Produces: `Run` no longer carries `execution_mode`; `Task.execution_defaults`
  no longer carries `worktree_mode`; `startRunsForPlan`'s input no longer
  accepts `allowDirtyDirect`. Later tasks assume a run's cwd is always
  `run.worktree_path` and always a fresh worktree.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/run-launcher.test.ts`:

```ts
test("a repository whose checkout is not a git repository is skipped, not run directly", async () => {
  const { backlogDir, checkoutPath } = await makeProjectWithNonGitCheckout();

  const result = await startRunsForPlan({
    backlogDir,
    config: loadConfig(backlogDir),
    plan: buildExecutionPlan(backlogDir),
    maxStart: 1,
  });

  expect(result.started).toHaveLength(0);
  expect(result.skipped[0]?.reasons).toContain("repository_not_a_git_repository");
  expect(fs.existsSync(path.join(checkoutPath, ".backlog-agent-prompt.md"))).toBe(false);
});
```

Build `makeProjectWithNonGitCheckout` from the fixtures already in that file:
same project setup, but do not `git init` the checkout.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/core/src/run-launcher.test.ts -t "not a git repository"`
Expected: FAIL — today the launcher falls back to direct mode and starts a run,
so `result.started` has one entry.

- [ ] **Step 3: Delete the mode from the schemas**

In `packages/schemas/src/run.ts`, delete line 36 entirely. In
`packages/schemas/src/task.ts`, delete the `worktree_mode` field (line 88, with
its comment block) and the `worktree_mode: "direct"` entry in the defaults
object (line 104).

- [ ] **Step 4: Collapse the launcher**

In `packages/core/src/run-launcher.ts`: delete `inspectDirectCheckout`
(lines 28-51), the `allowDirtyDirect` field (`:96`) and its destructuring
(`:173`), and replace the mode-selection block with an unconditional worktree.
The `!checkoutHasGit` branch becomes a typed skip:

```ts
const checkoutHasGit = await hasGitMetadata(checkoutPath);
if (!checkoutHasGit) {
  archiveClaim(backlogDir, claim.id);
  skipped.push({ taskId: task.id, reasons: ["repository_not_a_git_repository"] });
  continue;
}
let branch = buildRunBranchName(task.id, task.title, runId);
let worktreePath: string;
try {
  worktreePath = await ensureWorktree({ backlogDir, repoId: repo.id, repoPath: checkoutPath, branch, runId });
} catch (worktreeError) {
  // unchanged: archive the claim, report worktree_failed:<message>
}
```

Delete `modeAdjustmentMessage`, `allowedDirtyDirectFiles`, the
`workspace.mode_adjusted` and `workspace.direct*` events, and the
`executionMode === "direct" ? … : …` ternaries at `:386-393`.

- [ ] **Step 5: Follow the type errors**

Run: `bun run typecheck`

Work through every error. They are all the same shape — a branch on a field
that no longer exists. In `run-service.ts` (`:144,202,397,501,566`) and
`worktrees.ts` (`:207,218,245,255`) the `!== "direct"` guards become
unconditional. In `run-executor.ts`, `scratchDirFor` collapses to
`params.run.worktree_path` and `collectArtifacts` drops `isDirect`. In
`run-prompt.ts`, the `direct` parameter and its two prompt variants collapse to
the worktree wording.

- [ ] **Step 6: Strip the API and the board**

`packages/server/src/routes/runs.ts`: delete `allow_dirty_direct` from the
request schema (`:31`) and its use (`:212`).

`packages/board-ui`: delete `DirectDirtyDialog.svelte` and every import of it;
delete `allowDirtyDirect` from `App.svelte:1250-1252` and the retry call at
`:1316`; delete `allow_dirty_direct` from `lib/api.ts:1020` and the
`execution_mode` field from `lib/types.ts`; in `RunStatusDisplay.svelte:45-46`
and `ClaimsView.svelte:167` keep only the worktree label; in
`run-start-errors.ts` delete lines 42-44 and drop `"direct_dirty"` from the
`StartRunAction` union at `:4`.

Delete the matching keys from both `i18n/en.json` and `i18n/fr.json`. Verify
alignment: `bun run typecheck` runs `svelte-check`, which will not catch a
missing key — grep both files for `direct` and confirm the same keys remain.

- [ ] **Step 7: Run the new test and the suite**

Run: `bun test packages/core/src/run-launcher.test.ts`
Expected: PASS, including the new case.

Run: `bun run typecheck && bun run test`
Expected: clean typecheck; suite green at your recorded baseline minus the
direct-mode assertions you deleted.

- [ ] **Step 8: Correct CLAUDE.md**

§2's `Run` paragraph says *"Two `execution_mode`s: `isolated_worktree`
(default) or `direct`"*. Replace with a sentence stating every run happens in an
isolated worktree, and that a repository without git metadata cannot be run.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: every run happens in an isolated worktree

Direct mode let an agent work in the user's own checkout, and it was the
effective default. It carried its own dirty-checkout inspection, dialog and
three typed skip reasons, and it capped a repository at one run at a time.
A repository whose checkout is not a git repository is now skipped rather
than silently run in place."
```

---

## Task 2: Remove the Codex provider

Codex is the one runtime that never got an MCP channel: its only way to record a
trace is the CLI, which Task 5 closes. Rather than build a façade for a runtime
this fork does not target, it goes.

**Files:**
- Delete: `packages/core/src/providers/codex/` (`provider.ts`, `provider.test.ts`, `stream.ts`, `stream.test.ts`)
- Modify: `packages/core/src/providers/index.ts:3,19,27,37`
- Modify: `packages/core/src/agents.ts:19,80,88,94-95`
- Modify: `packages/config/src/init-layout.ts:133-135` — the default agent set
- Modify: `packages/core/src/usage.ts:14,69-73` — the `UsageProvider` union and OpenAI pricing rows
- Modify: `packages/core/src/run-executor.ts:112`
- Modify: `packages/core/src/run-merge.ts:37-39` — the three `.backlog-codex-*` scratch names
- Modify: `packages/core/src/provider-usage.ts:71-75` — `parseCodexJsonStream` and its tests
- Modify: `packages/board-ui/src/lib/run-start-errors.ts:38` — `missing_codex_executable`
- Modify: `packages/core/src/run-store.ts:188`, `orchestrator-loop.ts:332`, `providers/registry.ts:4` — comments naming codex

**Interfaces:**
- Consumes: nothing.
- Produces: `providerRegistry()` no longer resolves `codex`; `UsageProvider` is
  `"anthropic" | "custom"`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/providers/registry.test.ts` (create it if absent —
follow the fixture style of `packages/core/src/agent-tools.test.ts`):

```ts
import { expect, test } from "bun:test";
import { resolveProvider } from "./index.js";

test("codex is not a resolvable runtime", () => {
  expect(() => resolveProvider("codex")).toThrow();
});

test("claude-code and its aliases still resolve", () => {
  expect(resolveProvider("claude-code").id).toBe("claude-code");
  expect(resolveProvider("claude").id).toBe("claude-code");
});
```

Check the exact export name and throw-vs-null behaviour in
`packages/core/src/providers/registry.ts` before writing the assertion, and
match it.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/core/src/providers/registry.test.ts`
Expected: FAIL — `resolveProvider("codex")` currently returns the provider.

- [ ] **Step 3: Delete the provider**

```bash
git rm -r packages/core/src/providers/codex
```

Remove the four lines that reference it in
`packages/core/src/providers/index.ts` (`:3` import, `:19` and `:27`
re-exports, `:37` registry entry).

- [ ] **Step 4: Remove the default agent**

In `packages/config/src/init-layout.ts:133-135`, drop Codex from the default
agent set and correct the comment, which currently names four agents. In
`packages/core/src/agents.ts`, delete the `codex` id from the "were the defaults
deleted on purpose" check (`:88`) and the insertion-point lookup (`:94-95`) —
insert at `file.agents.length` instead.

- [ ] **Step 5: Follow the type errors**

Run: `bun run typecheck`

`usage.ts:14` narrows to `"anthropic" | "custom"`; delete the OpenAI pricing
rows at `:69-73`. `run-executor.ts:112` loses its ternary and becomes
`provider: "anthropic"`. Delete `parseCodexJsonStream` from
`provider-usage.ts:71-75` and its tests. Delete the three `.backlog-codex-*`
entries from `run-merge.ts:37-39` and `missing_codex_executable` from
`run-start-errors.ts:38`.

- [ ] **Step 6: Run the tests**

Run: `bun run typecheck && bun run test`
Expected: clean; suite green minus the deleted Codex test files.

- [ ] **Step 7: Correct CLAUDE.md**

§3 lists `codex/` under `providers/`, and §1 says "Keep the other providers
working". Update both: the runtimes are `claude-code`, `anthropic-api` and
`custom`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove the Codex provider

It is the one runtime with no MCP channel, so its only way to record a
trace is the CLI that the context work closes. This fork targets Claude
Code; a second runtime can come back as one folder and one registry line
when there is a reason for it."
```

---

## Task 3: The four read tools and the catalogue

The façade's read surface. Each tool maps 1:1 onto an existing command and calls
the same core service, per the spec's D1 and D3.

**Files:**
- Create: `packages/core/src/mcp/read-tools.ts`
- Create: `packages/core/src/mcp/read-tools.test.ts`
- Create: `packages/core/src/mcp/catalog.ts`
- Modify: `packages/core/src/index.ts` — the new modules are covered by the existing `export * from "./mcp/index.js"` only if re-exported there; add them to `packages/core/src/mcp/index.ts`

**Interfaces:**
- Consumes: `getTask(backlogDir, id)`, `getSubTask(backlogDir, id)` from core;
  `listTraces(backlogDir, taskId)` from `./trace-store.js`;
  `listActiveClaims(backlogDir)` from `@backlog/claims`; `AGENT_TOOLS` and
  `callAgentTool` from `./agent-tools.js`.
- Produces: `READ_TOOLS: McpToolDefinition[]`,
  `callReadTool({ backlogDir, name, input }): Promise<McpToolOutcome>`,
  `CATALOG: McpToolDefinition[]`, `catalogToolNames(): string[]`,
  `catalogTool(name): McpToolDefinition | undefined`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/mcp/read-tools.test.ts`:

```ts
import { expect, test } from "bun:test";
import { callReadTool, READ_TOOLS } from "./read-tools.js";
import { makeTempProject } from "../test-helpers.js"; // match the helper the neighbouring tests use

test("the read surface is exactly four tools", () => {
  expect(READ_TOOLS.map((tool) => tool.name).sort()).toEqual([
    "claim_list",
    "subtask_show",
    "task_show",
    "trace_show",
  ]);
});

test("task_show returns the ticket", async () => {
  const { backlogDir, taskId } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "task_show", input: { task_id: taskId } });
  expect(outcome.ok).toBe(true);
  expect((outcome.result as { task: { id: string } }).task.id).toBe(taskId);
});

test("an unknown task is a readable refusal, not a throw", async () => {
  const { backlogDir } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "task_show", input: { task_id: "task_999" } });
  expect(outcome.ok).toBe(false);
  expect(String((outcome.result as { error: string }).error)).toContain("task_999");
});

test("the dispatcher refuses a name outside the read surface", async () => {
  const { backlogDir } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "start_subtask", input: { confirmed: true } });
  expect(outcome.ok).toBe(false);
  expect(String((outcome.result as { error: string }).error)).toContain("Unknown tool");
});
```

Before writing, open `packages/core/src/agent-tools.test.ts` and reuse its
project fixture rather than inventing `makeTempProject`; keep fixtures in temp
directories, since the suite runs in one process.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/core/src/mcp/read-tools.test.ts`
Expected: FAIL — `./read-tools.js` does not exist.

- [ ] **Step 3: Write the read tools**

Create `packages/core/src/mcp/read-tools.ts`. Mirror the structure of
`agent-tools.ts`: schema constants, an exported definition array, and a
dispatcher that never throws.

```ts
export const READ_TOOLS: McpToolDefinition[] = [
  {
    name: "task_show",
    description:
      "Read one ticket: its status, priority, description, acceptance criteria and dependencies. Call it on your own BACKLOG_TASK_ID before you start, and on any task id you discover you depend on.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", description: "Task id, e.g. task_017." } },
      required: ["task_id"],
    },
  },
  {
    name: "subtask_show",
    description:
      "Read the unit of work this run is scoped to: its scopes, claim mode, dependencies and completion criteria. Only a subtask-scoped run has one — BACKLOG_SUBTASK_ID is absent on a task-level run.",
    inputSchema: {
      type: "object",
      properties: { subtask_id: { type: "string", description: "Subtask id, e.g. sub_004." } },
      required: ["subtask_id"],
    },
  },
  {
    name: "trace_show",
    description:
      "What earlier runs on this ticket decided, and why. Read it before you start: it is the only record of reasoning that survives a run, and re-deciding what a previous run already settled is the failure this exists to prevent.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string", description: "Task id, e.g. task_017." } },
      required: ["task_id"],
    },
  },
  {
    name: "claim_list",
    description:
      "Which paths other agents currently hold. Do not edit a path someone else holds. Claims expire and are taken during a run, so this can change under you — read it again before touching anything outside your own scopes.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function callReadTool(call: ReadToolCall): Promise<McpToolOutcome> {
  try {
    switch (call.name) {
      case "task_show": {
        const id = requireString(call.input, "task_id");
        const task = getTask(call.backlogDir, id);
        if (!task) throw new Error(`Unknown task: ${id}`);
        return { ok: true, result: { task } };
      }
      case "subtask_show": {
        const id = requireString(call.input, "subtask_id");
        const subtask = getSubTask(call.backlogDir, id);
        if (!subtask) throw new Error(`Unknown subtask: ${id}`);
        return { ok: true, result: { subtask } };
      }
      case "trace_show": {
        const id = requireString(call.input, "task_id");
        const traces = listTraces(call.backlogDir, id);
        return { ok: true, result: { task_id: id, count: traces.length, traces } };
      }
      case "claim_list": {
        const claims = listActiveClaims(call.backlogDir);
        return { ok: true, result: { count: claims.length, claims } };
      }
      default:
        throw new Error(
          `Unknown tool: ${call.name}. The read surface is: ${READ_TOOLS.map((t) => t.name).join(", ")}.`,
        );
    }
  } catch (error) {
    return { ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
```

Declare the call shape in the same file, mirroring `AgentToolCall` in
`agent-tools.ts:116-120`:

```ts
export interface ReadToolCall {
  backlogDir: string;
  name: string;
  input: unknown;
}
```

Write `requireString(input, key)` in the same file too: it reads the key, trims
it, and throws `` `${key} is required` `` when blank — the same contract
`readTool` in `orchestrator-tools.ts:204-205` uses.

- [ ] **Step 4: Write the catalogue**

Create `packages/core/src/mcp/catalog.ts`. It holds every façade tool and knows
nothing about who may see one:

```ts
import { AGENT_TOOLS, callAgentTool } from "../agent-tools.js";
import { ORCHESTRATOR_TOOLS, callOrchestratorTool } from "../orchestrator-tools.js";
import { READ_TOOLS, callReadTool } from "./read-tools.js";
import type { McpToolDefinition, McpToolOutcome } from "./server.js";

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

export function catalogTool(name: string): McpToolDefinition | undefined {
  return CATALOG.find((tool) => tool.name === name);
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
```

Re-export both modules from `packages/core/src/mcp/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `bun test packages/core/src/mcp/read-tools.test.ts`
Expected: PASS, four tests.

Run: `bun run typecheck && bun run test`
Expected: clean; suite green at baseline + 4.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: expose the ticket reads an execution agent needs as MCP tools

Four tools mapping 1:1 onto task show / subtask show / trace show /
claim list, calling the same core services those commands call. A
catalogue collects them alongside the existing write and orchestration
tools, with no notion yet of who may see which."
```

---

## Task 4: The context table

The policy moves above MCP, where it can also cover built-in tools. The three
hand-written denied-tool lists are deleted.

**Files:**
- Create: `packages/core/src/contexts/types.ts`
- Create: `packages/core/src/contexts/contexts.ts`
- Create: `packages/core/src/contexts/contexts.test.ts`
- Modify: `packages/core/src/index.ts` — add `export * from "./contexts/contexts.js";`
- Modify: `packages/cli/src/commands/mcp.ts` — audience `agent` → `execution`, host reads the table
- Modify: `packages/core/src/providers/claude-code/provider.ts` — `buildRunCommand` and `runCompletion` read a context; delete `COMPLETION_DISALLOWED_TOOLS`
- Modify: `packages/server/src/lib/chat/claude-code-chat.ts` — reads a context; delete `DENIED_BUILT_IN_TOOLS`

**Interfaces:**
- Consumes: `catalogToolNames()` from Task 3.
- Produces: `AgentContextId = "execution" | "orchestrator" | "completion"`,
  `contextFor(id): AgentContext`, and `AgentContext` as specified below. Task 5
  reads `contextFor("execution").cliRole`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/contexts/contexts.test.ts`:

```ts
import { expect, test } from "bun:test";
import { catalogToolNames } from "../mcp/catalog.js";
import { orchestratorToolNames } from "../orchestrator-tools.js";
import { CONTEXTS, contextFor } from "./contexts.js";

test("every tool a context grants exists in the catalogue", () => {
  const known = new Set(catalogToolNames());
  for (const [id, context] of Object.entries(CONTEXTS)) {
    for (const name of context.mcpTools) {
      expect(known.has(name), `${id} grants unknown tool ${name}`).toBe(true);
    }
  }
});

test("the execution context grants no orchestration tool", () => {
  const orchestration = new Set(orchestratorToolNames());
  for (const name of contextFor("execution").mcpTools) {
    expect(orchestration.has(name)).toBe(false);
  }
});

test("the execution context is the only one carrying a CLI role", () => {
  expect(contextFor("execution").cliRole).toBe("execution");
  expect(contextFor("orchestrator").cliRole).toBe(null);
  expect(contextFor("completion").cliRole).toBe(null);
});

test("only the execution context sees the user's own MCP servers", () => {
  expect(contextFor("execution").userMcpServers).toBe("visible");
  expect(contextFor("orchestrator").userMcpServers).toBe("hidden");
  expect(contextFor("completion").userMcpServers).toBe("hidden");
});

test("a completion gets no tools at all", () => {
  expect(contextFor("completion").mcpTools).toHaveLength(0);
  expect(contextFor("completion").mcpAudience).toBe(null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/core/src/contexts/contexts.test.ts`
Expected: FAIL — `./contexts.js` does not exist.

- [ ] **Step 3: Write the type**

Create `packages/core/src/contexts/types.ts`:

```ts
export type AgentContextId = "execution" | "orchestrator" | "completion";
export type McpAudience = "execution" | "orchestrator";

export interface AgentContext {
  /** Which tool set the MCP server should serve, or null for no server at all. */
  mcpAudience: McpAudience | null;
  /** The tool names that audience resolves to. The MCP server owns the
   *  authoritative copy; this one exists so the table can be asserted and so
   *  callers can build --allowedTools without spawning anything. */
  mcpTools: readonly string[];
  /** Built-in tools the session may not use. */
  deniedBuiltins: readonly string[];
  /** Whether the user's own MCP servers stay reachable. */
  userMcpServers: "visible" | "hidden";
  /** Exported as BACKLOG_AGENT_ROLE, or null to export nothing. */
  cliRole: "execution" | null;
}
```

- [ ] **Step 4: Write the table**

Create `packages/core/src/contexts/contexts.ts`:

```ts
import { agentToolNames } from "../agent-tools.js";
import { orchestratorToolNames } from "../orchestrator-tools.js";
import { READ_TOOLS } from "../mcp/read-tools.js";
import type { AgentContext, AgentContextId } from "./types.js";

// Every permission decision about a model Backlog launches lives here, and
// nowhere else. It sits above MCP on purpose: the MCP server is a separate
// process that cannot observe whether the model in front of it has Bash, so a
// table living there could only answer a third of the question (spec §4, D4).

// A conversation with no checkout needs no tool at all. One list, shared by the
// two contexts that are conversations: they had drifted to 18 and 10 entries
// with no decision behind the gap.
const NO_BUILT_IN_TOOLS = [
  "Bash", "BashOutput", "KillBash", "Read", "Write", "Edit", "MultiEdit",
  "NotebookEdit", "Glob", "Grep", "Task", "WebFetch", "WebSearch", "TodoWrite",
  "ExitPlanMode", "ToolSearch", "SlashCommand", "Skill",
] as const;

const readToolNames = READ_TOOLS.map((tool) => tool.name);

export const CONTEXTS: Record<AgentContextId, AgentContext> = {
  // One coding run, unattended, in a worktree. It keeps every built-in tool:
  // it is here to write code, and taking Bash from it would take its job. The
  // closure targets the Backlog CLI, which Task 5 refuses outright.
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
```

- [ ] **Step 5: Run the table's tests**

Run: `bun test packages/core/src/contexts/contexts.test.ts`
Expected: PASS, five tests.

- [ ] **Step 6: Rename the audience and read the catalogue**

`packages/cli/src/commands/mcp.ts:22` currently declares its own
`McpAudience`. Delete that declaration and import the type from
`@backlog/core` instead — Task 4 Step 3 makes core the owner, and two
definitions of the same union in two packages is exactly the drift this task
exists to remove.

Then rename the `agent` audience to `execution` (the `AUDIENCES` array, the
default returned by `parseAudience`, and the doc comment). Nobody runs this
command by hand — it is spawned by `buildRunCommand` and `buildChatCommand` —
so no compatibility alias is needed. Then serve the tool set the table names:

```ts
export function mcpHostFor(backlogDir: string, audience: McpAudience): McpToolHost {
  const names = new Set(contextFor(audience === "orchestrator" ? "orchestrator" : "execution").mcpTools);
  return {
    tools: CATALOG.filter((tool) => names.has(tool.name)).map((tool) => ({ ...tool })),
    callTool: (name, input) =>
      names.has(name)
        ? callCatalogTool({ backlogDir, name, input })
        : Promise.resolve({ ok: false, result: { error: `Unknown tool: ${name}.` } }),
  };
}
```

The `names.has(name)` guard is the server refusing on its own account: it must
not depend on its caller having advertised honestly.

- [ ] **Step 7: Make the three launch sites read their context**

`providers/claude-code/provider.ts` — `buildRunCommand` replaces its literal
flags:

```ts
const context = contextFor("execution");
return buildClaudeCodeCommand({
  // …unchanged: executable, prompt, model, reasoningEffort, profile, sandboxMode
  mcpServers: {
    [MCP_SERVER_NAME]: {
      command: self.command,
      args: [...self.prefixArgs, "mcp-server", "--audience", context.mcpAudience!, "--project", request.backlogDir],
      env: mcpServerEnv(request.env),
    },
  },
  allowedTools: context.mcpTools.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`),
  disallowedTools: context.deniedBuiltins,
  strictMcpConfig: context.userMcpServers === "hidden",
});
```

`runCompletion` reads `contextFor("completion")` and passes its
`deniedBuiltins`; delete `COMPLETION_DISALLOWED_TOOLS` (`:30-41`).

`server/src/lib/chat/claude-code-chat.ts` reads `contextFor("orchestrator")` the
same way; delete `DENIED_BUILT_IN_TOOLS` (`:26-45`) and `namespacedToolNames`.

- [ ] **Step 8: Close the completion's MCP hole**

`command.ts:87-96` only emits `--strict-mcp-config` inside `if (input.mcpServers)`,
so a completion — which passes no servers — silently loads the user's. Hoist the
flag so it is emitted whenever `strictMcpConfig !== false`, regardless of
whether we declare servers of our own:

```ts
if (input.mcpServers) {
  args.push("--mcp-config", JSON.stringify({ mcpServers: input.mcpServers }));
}
if (input.strictMcpConfig !== false) {
  args.push("--strict-mcp-config");
}
```

Add a test in `packages/core/src/providers/claude-code/command.test.ts`
asserting a completion command contains `--strict-mcp-config` and no
`--mcp-config`.

- [ ] **Step 9: Run everything**

Run: `bun run typecheck && bun run test`
Expected: clean. Existing tests in `claude-code-chat.test.ts` that assert the
denied list by literal contents keep passing — the list moved, its contents did
not. If one asserts 10 entries for a completion, update it to the shared list
and note the change in the commit message.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: one table decides what a Backlog-launched model may do

Three contexts — execution, orchestrator, completion — each declaring MCP
audience, denied built-ins, user-MCP visibility and CLI role. The three
sites that spawn a model read the table instead of carrying their own
lists, which had drifted to 18 / 10 / 0 entries.

Two corrections fall out: a one-shot completion no longer loads the
user's MCP servers (--strict-mcp-config was only emitted when we declared
servers ourselves), and the two conversation contexts now share one
denied list."
```

---

## Task 5: The binary refuses an execution agent

**Files:**
- Modify: `packages/core/src/run-executor.ts:71-106` — export `BACKLOG_AGENT_ROLE`
- Modify: `packages/cli/src/bin.ts` — refuse before dispatch
- Modify: `packages/config/src/shim.ts` — the hook exemption
- Create: `packages/cli/src/role-guard.ts`
- Create: `packages/cli/src/role-guard.test.ts`
- Modify: `packages/hooks/src/*.test.ts` — the claim check survives the role (Step 7)

**Interfaces:**
- Consumes: `contextFor("execution").cliRole` from Task 4.
- Produces: `refuseWhenExecutionRole(env, argv): string | null` — the refusal
  message, or `null` to proceed. Exported so it is testable without spawning.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/role-guard.test.ts`:

```ts
import { expect, test } from "bun:test";
import { refuseWhenExecutionRole } from "./role-guard.js";

test("no role set: everything proceeds", () => {
  expect(refuseWhenExecutionRole({}, ["node", "backlog", "task", "move", "t_1", "done"])).toBe(null);
});

test("execution role: a write is refused", () => {
  const message = refuseWhenExecutionRole(
    { BACKLOG_AGENT_ROLE: "execution" },
    ["node", "backlog", "task", "move", "t_1", "done"],
  );
  expect(message).toContain("execution agent");
  expect(message).toContain("MCP");
});

test("execution role: a read is refused too — there is no allowlist", () => {
  expect(
    refuseWhenExecutionRole({ BACKLOG_AGENT_ROLE: "execution" }, ["node", "backlog", "task", "show", "t_1"]),
  ).not.toBe(null);
});

test("the pre-commit hook is exempt", () => {
  expect(
    refuseWhenExecutionRole(
      { BACKLOG_AGENT_ROLE: "execution", BACKLOG_HOOK_INVOCATION: "1" },
      ["node", "backlog", "claim", "check", "--paths", "src/a.ts"],
    ),
  ).toBe(null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/cli/src/role-guard.test.ts`
Expected: FAIL — `./role-guard.js` does not exist.

- [ ] **Step 3: Write the guard**

Create `packages/cli/src/role-guard.ts`:

```ts
// An execution agent gets its whole Backlog surface from the MCP server that
// its run spawns. The binary is on its PATH because we widen PATH for its own
// tooling, and BACKLOG_PROJECT_DIR points at the real project so its reads
// resolve — together those made `backlog task move <id> done` reachable from
// its shell, contradicting what the run prompt and trace_write both tell it.
//
// One rule, no sub-command allowlist: an allowlist has to be revisited every
// time a command is added, and an allowlist that drifts is how this started.
//
// This is not airtight — `env -u BACKLOG_AGENT_ROLE backlog …` still works. It
// moves the CLI from advertised and one command away to explicitly refused.

const REFUSAL = [
  "backlog: this command is unavailable to an execution agent.",
  "Use the tools on the `backlog` MCP server instead.",
].join("\n");

export function refuseWhenExecutionRole(
  env: Record<string, string | undefined>,
  _argv: string[],
): string | null {
  if (env["BACKLOG_AGENT_ROLE"] !== "execution") return null;
  // The pre-commit hook execs this same binary and inherits the agent's
  // environment. Refusing it would not block the commit — the hook's failure
  // path allows the commit when Backlog is unavailable (install-hooks.ts:67)
  // — it would silently disable claim enforcement.
  if (env["BACKLOG_HOOK_INVOCATION"]) return null;
  return REFUSAL;
}
```

`_argv` is unused today and named accordingly; it is in the signature because
any future narrowing of the rule is argv-shaped, and changing a signature that
`bin.ts` already calls is churn.

- [ ] **Step 4: Wire it into `bin.ts`**

Immediately before `program.parseAsync(...)` at `packages/cli/src/bin.ts:99`:

```ts
const refusal = refuseWhenExecutionRole(process.env, process.argv);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
```

stdout stays untouched — the same fail-closed shape `parseAudience` already
uses, and the MCP transport depends on it.

- [ ] **Step 5: Export the role and mark the hook**

In `packages/core/src/run-executor.ts`, add to the map in `environmentFor`:

```ts
...(contextFor("execution").cliRole ? { BACKLOG_AGENT_ROLE: contextFor("execution").cliRole } : {}),
```

In `packages/config/src/shim.ts`, the generated shell shim sets the marker
before every `exec`:

```sh
export BACKLOG_HOOK_INVOCATION=1
```

Put it once, above the resolution chain, so all four `exec` branches inherit it.

- [ ] **Step 6: Run the guard tests**

Run: `bun test packages/cli/src/role-guard.test.ts`
Expected: PASS, four tests.

- [ ] **Step 7: Prove the hook still validates claims**

Add to the hook test file (`packages/hooks/src/*.test.ts` — follow its existing
temp-repo fixture): install the hook in a temp git repository, take an exclusive
claim on a path, then attempt a commit touching that path with
`BACKLOG_AGENT_ROLE=execution` in the environment. Expect the commit to be
blocked by the claim check, not allowed through by a refusal.

This is the assertion that matters most in this task: getting it wrong turns a
security feature into a silent hole.

- [ ] **Step 8: Run everything**

Run: `bun run typecheck && bun run test`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: the binary refuses an execution agent

An execution agent's Backlog surface is the MCP server its run spawns.
The CLI now refuses under BACKLOG_AGENT_ROLE=execution — every command,
no sub-command allowlist to drift — with one exemption: the pre-commit
hook, which execs this binary and inherits the agent's environment. That
exemption is not a convenience. The hook allows the commit when Backlog
is unavailable, so refusing it would have silently disabled claim
enforcement instead of blocking anything.

Not airtight: env -u still works. It moves the CLI from advertised and
one command away to explicitly refused."
```

---

## Task 6: Tell the agent the truth

`run-prompt.ts:27-35` advertises a CLI that Task 5 refuses. Five lines that
became false.

**Files:**
- Modify: `packages/core/src/run-prompt.ts:27-35` (`BACKLOG_CONTEXT`) and `:41-50` (`TRACE_CONTRACT`)
- Modify: `packages/core/src/run-prompt.test.ts`

**Interfaces:**
- Consumes: the tool names from Task 3.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/run-prompt.test.ts`:

```ts
test("the prompt does not advertise the CLI", () => {
  const prompt = buildProviderPrompt(target, workItem);
  expect(prompt).not.toContain("on your PATH");
  expect(prompt).not.toContain("backlog task show");
  expect(prompt).not.toContain("backlog trace write");
});

test("the prompt names the tools the run actually has", () => {
  const prompt = buildProviderPrompt(target, workItem);
  for (const name of ["task_show", "subtask_show", "trace_show", "claim_list", "trace_write"]) {
    expect(prompt).toContain(name);
  }
});
```

Reuse the fixtures already at the top of that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/core/src/run-prompt.test.ts -t "advertise the CLI"`
Expected: FAIL — the prompt currently contains all three strings.

- [ ] **Step 3: Rewrite the disclosure**

```ts
const BACKLOG_CONTEXT = [
  "Backlog context:",
  "- Your environment carries BACKLOG_TASK_ID, BACKLOG_RUN_ID, BACKLOG_REPO, BACKLOG_BRANCH and BACKLOG_WORKTREE, plus BACKLOG_SUBTASK_ID when this run is scoped to a subtask.",
  "- Every interaction you may have with Backlog is a tool on the `backlog` MCP server. There is no command-line access: the `backlog` binary refuses an execution agent.",
  "- `task_show` — a ticket, its status and its dependencies. Read your own before you start.",
  "- `subtask_show` — this unit of work. Only a subtask-scoped run has one.",
  "- `trace_show` — what earlier runs on this ticket decided, and why. Read it before you start.",
  "- `claim_list` — which paths other agents currently hold. Do not edit a path someone else holds.",
];
```

In `TRACE_CONTRACT`, the first bullet loses its CLI fallback:

```ts
"- Before you finish, record a trace by calling the `trace_write` tool.",
```

Every other bullet stays as it is: the payload shapes are unchanged and were
written field by field for a reason.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/core/src/run-prompt.test.ts`
Expected: PASS.

Run: `bun run typecheck && bun run test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: the run prompt names its tools instead of a refused CLI

It advertised four commands and a binary on PATH. The binary now refuses
an execution agent, so those five lines had become false — which is the
exact failure mode this whole change exists to correct."
```

---

## Task 7: Prove it against the compiled binary

A unit test is what missed the task-level bug in PR #14: every fixture in the
suite built the subtask shape, so a whole class of runs was dead in both write
channels and nothing noticed. This task is the counterweight, and it is not
optional.

**Files:**
- Modify: `CLAUDE.md` §3 — the "that disjointness holds on the MCP channel only" paragraph is now wrong
- Create: nothing. The output is evidence in the PR description.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Build**

Run: `bun run build`
Expected: `dist/backlog`, ~63 MB.

- [ ] **Step 2: Probe both audiences**

Drive `dist/backlog mcp-server --audience execution --project <dir>` over stdio
with a `tools/list` request. Expected: exactly `claim_list`, `subtask_show`,
`task_show`, `trace_show`, `trace_write`.

Repeat with `--audience orchestrator`. Expected: exactly the nine orchestration
tools.

Repeat with `--audience AGENT` (wrong case). Expected: exit 1, message on
stderr, stdout untouched.

- [ ] **Step 3: Call a tool, do not just list it**

On the execution audience, send `tools/call` for `task_show` with a real task
id, and for `start_subtask` with `confirmed: true`. Expected: the first returns
the ticket; the second returns `Unknown tool`.

Listing is what the previous plan stopped at, and it is why a dead tool shipped.

- [ ] **Step 4: Probe both run shapes**

Record a trace through `trace_write` on a **subtask-scoped** run and on a
**task-level** run (no split, `BACKLOG_SUBTASK_ID` absent). Both must record.
Build the environments the way `environmentFor` does, including
`BACKLOG_TARGET_TYPE`.

- [ ] **Step 5: Probe the refusal and the hook together**

With `BACKLOG_AGENT_ROLE=execution` in the environment:

- `dist/backlog task move <id> done` → exit 1, refusal on stderr, ticket unchanged.
- `dist/backlog task show <id>` → refused too.
- `git commit` in a repository with the hook installed and a conflicting claim
  held → **blocked by the claim check**, not allowed through.

The last one is the assertion that distinguishes a working exemption from a
silently disabled hook.

- [ ] **Step 6: Correct CLAUDE.md**

§3's closing paragraph says the disjointness holds on the MCP channel only, that
`backlog task move <id> done` is reachable from a shell, and that closing it is
a feature with its own design. That is now done. Rewrite it to describe the
context table, the façade and the role refusal — including the honest limit
(`env -u`) and the hook exemption. §8's bullet about permission modes being
coarse stays: it is still true.

- [ ] **Step 7: Full verification**

Run: `bun run typecheck && bun run test && bun run build`
Expected: clean, green, built. Record the final test count.

- [ ] **Step 8: Commit and open the PR**

```bash
git add -A
git commit -m "docs: CLAUDE.md describes the closed CLI, not the open one"
```

Open the PR with the probe output from Steps 2-5 in the description — the
evidence, not a claim that it was checked.

---

## Self-review notes

**Spec coverage.** §4's table → Task 4. §4's "who reads the table" → Task 4
Step 7. §4's seam → Task 4 Step 6. §5 refusal → Task 5. §5 hook exemption →
Task 5 Steps 5 and 7, plus Task 7 Step 5. §6's five tools → Task 3. §7 prompt →
Task 6. §8's four properties → Task 3 Step 1 (containment at dispatch), Task 4
Step 1 (integrity, containment), Task 5 Step 1 (refusal), Task 7 (the probe).
§9's file table → the File Structure section. §10 out-of-scope items appear in
no task. Prerequisites → Tasks 1 and 2.

**One coverage property is weaker than the spec implies.** §8.3 asks that every
command in §6's mapping table have a catalogue tool dispatching to the same
service. Tasks 3 and 4 assert that the four tools exist and that every granted
name is in the catalogue, but nothing mechanically ties `task_show` to
`backlog task show`. A test could import both and compare, but the CLI's action
handler is an inline closure with no exported seam. Rather than restructure four
commands to make an assertion possible, the tie is the 1:1 naming convention and
this note. If a fifth read is added later without a tool, no test catches it.

**`Bash(backlog:*)` is unverified.** Task 4's table includes it as
`deniedBuiltins` for the execution context. Verify against the installed
`claude` CLI during Task 4 — if the specifier form is rejected, drop the entry
and leave `deniedBuiltins: []`. Nothing else in the design depends on it; Task 5
is the actual lock.
