# Agent trace core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent record what it decided on a ticket, and let that record drive the ticket's status and any work it discovered — all testable from the backend, with no UI and no MCP yet.

**Architecture:** A Zod trace schema in `schemas`, an append-only per-ticket NDJSON store in `core`, and a `trace-service` that turns one `outcome` into exactly one status transition. Nothing writes status twice: `implemented` is deliberately left to the existing `finalizeSuccessfulRun` path. Discovered work becomes a task in a new `proposed` status that the scheduler must never run.

**Tech Stack:** Bun 1.3+ (runtime, test runner, bundler), TypeScript, Zod, `yaml`, Commander for the CLI. No Node, npm, tsx or vitest.

**Spec:** [docs/superpowers/specs/2026-08-17-agent-ticket-tools-design.md](../specs/2026-08-17-agent-ticket-tools-design.md)

## Global Constraints

- Internal packages expose TypeScript source directly; imports keep the `.js` extension (`./trace-store.js` → `trace-store.ts`).
- Dependency direction: `schemas` ← everything. Never import `server` from `core`, nor `cli` from either.
- Cross-boundary shapes go in `packages/schemas` first, then call sites.
- Use `homeDir()` from `@backlog/config`, never `os.homedir()`.
- Tests: `bun test <path>` — always pass a path. Tests share one process, so keep fixtures in temp dirs.
- Vocabulary in user-facing copy and new names: project · repository · task · subtask · run · claim · agent. No "repo"/"repos" in new copy.
- Zod defaults on every new field so existing `.backlog/` files keep loading unmigrated.
- This plan adds no user-facing UI strings. If one appears, it goes in **both** `i18n/en.json` and `i18n/fr.json`.

---

### Task 1: Trace schema

**Files:**
- Create: `packages/schemas/src/trace.ts`
- Modify: `packages/schemas/src/index.ts`
- Test: `packages/schemas/src/trace.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `traceSchema`, `type Trace`, `type TraceOutcome`, `type TraceConstraint`, `type TraceDecision`, `type TraceDiscoveredDep`, `type TraceProposal`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/trace.test.ts
import { describe, expect, it } from "bun:test";
import { traceSchema } from "./trace.js";

const base = {
  version: 1 as const,
  run_id: "run_001",
  task_id: "task_001",
  created_at: "2026-08-17T10:00:00.000Z",
  summary: "Wired the reentrancy guard.",
};

describe("traceSchema", () => {
  it("accepts an implemented trace and defaults the collections", () => {
    const trace = traceSchema.parse({ ...base, outcome: "implemented" });
    expect(trace.constraints).toEqual([]);
    expect(trace.decisions).toEqual([]);
    expect(trace.discovered_deps).toEqual([]);
    expect(trace.consolidation_hint).toBe("none");
  });

  it("requires rejection_reason when the outcome is rejected", () => {
    expect(() => traceSchema.parse({ ...base, outcome: "rejected" })).toThrow(
      /rejection_reason/,
    );
    const trace = traceSchema.parse({
      ...base,
      outcome: "rejected",
      rejection_reason: "Already satisfied by task_003.",
    });
    expect(trace.outcome).toBe("rejected");
  });

  it("requires open_question when the outcome is blocked", () => {
    expect(() => traceSchema.parse({ ...base, outcome: "blocked" })).toThrow(
      /open_question/,
    );
  });

  it("requires evidence on every constraint", () => {
    expect(() =>
      traceSchema.parse({
        ...base,
        outcome: "implemented",
        constraints: [{ statement: "writers must be reentrant", confidence: "verified" }],
      }),
    ).toThrow();
  });

  it("accepts both shapes of discovered dependency", () => {
    const trace = traceSchema.parse({
      ...base,
      outcome: "implemented",
      discovered_deps: [
        { kind: "existing", task_id: "task_017" },
        { kind: "proposal", proposal: { title: "Split the store writer", motive: "Found while editing." } },
      ],
    });
    expect(trace.discovered_deps).toHaveLength(2);
    expect(trace.discovered_deps[1]!.kind).toBe("proposal");
  });

  it("requires a reason when the consolidation hint is high", () => {
    expect(() =>
      traceSchema.parse({ ...base, outcome: "implemented", consolidation_hint: "high" }),
    ).toThrow(/consolidation_hint_reason/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/schemas/src/trace.test.ts`
Expected: FAIL — `Cannot find module './trace.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/schemas/src/trace.ts
import { z } from "zod";

export const traceOutcomeSchema = z.enum(["implemented", "rejected", "blocked"]);

// `verified` means the claim came out of executing something (a failing test, a
// reproducible error). `observed` means an agent read code and interpreted it.
// The consolidator treats the two differently: facts enter the canon on first
// sight, interpretations wait for a second witness.
export const traceConfidenceSchema = z.enum(["verified", "observed"]);

export const traceConstraintSchema = z.object({
  statement: z.string().min(1),
  // A resolvable pointer: `path:line`, a test name, a command's error output.
  // No evidence, no promotion to the canon — enforced here at write time.
  evidence: z.string().min(1),
  confidence: traceConfidenceSchema,
});

export const traceDecisionSchema = z.object({
  chose: z.string().min(1),
  rejected: z.string().min(1),
  because: z.string().min(1),
});

export const traceProposalSchema = z.object({
  title: z.string().min(1),
  motive: z.string().min(1),
  scopes: z.array(z.string()).default([]),
});

export const traceDiscoveredDepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), task_id: z.string().min(1) }),
  z.object({ kind: z.literal("proposal"), proposal: traceProposalSchema }),
]);

export const traceSchema = z
  .object({
    version: z.literal(1),
    run_id: z.string().min(1),
    task_id: z.string().min(1),
    subtask_id: z.string().min(1).optional(),
    created_at: z.string().min(1),
    outcome: traceOutcomeSchema,
    summary: z.string().min(1),
    constraints: z.array(traceConstraintSchema).default([]),
    decisions: z.array(traceDecisionSchema).default([]),
    rejection_reason: z.string().min(1).optional(),
    open_question: z.string().min(1).optional(),
    discovered_deps: z.array(traceDiscoveredDepSchema).default([]),
    consolidation_hint: z.enum(["none", "high"]).default("none"),
    consolidation_hint_reason: z.string().min(1).optional(),
  })
  .superRefine((trace, ctx) => {
    if (trace.outcome === "rejected" && !trace.rejection_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rejection_reason"],
        message: "rejection_reason is required when outcome is 'rejected'",
      });
    }
    if (trace.outcome === "blocked" && !trace.open_question) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["open_question"],
        message: "open_question is required when outcome is 'blocked'",
      });
    }
    if (trace.consolidation_hint === "high" && !trace.consolidation_hint_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consolidation_hint_reason"],
        message: "consolidation_hint_reason is required when consolidation_hint is 'high'",
      });
    }
  });

export type TraceOutcome = z.infer<typeof traceOutcomeSchema>;
export type TraceConstraint = z.infer<typeof traceConstraintSchema>;
export type TraceDecision = z.infer<typeof traceDecisionSchema>;
export type TraceProposal = z.infer<typeof traceProposalSchema>;
export type TraceDiscoveredDep = z.infer<typeof traceDiscoveredDepSchema>;
export type Trace = z.infer<typeof traceSchema>;
```

Then add to `packages/schemas/src/index.ts`, following the existing export style in that file:

```ts
export * from "./trace.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/schemas/src/trace.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/schemas/src/trace.ts packages/schemas/src/trace.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add the agent trace schema"
```

---

### Task 2: The `proposed` status and the proposal block

**Files:**
- Modify: `packages/schemas/src/task.ts` (`taskStatusSchema` at the top; add `proposal` to `taskSchema`)
- Test: `packages/schemas/src/task-proposal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `"proposed"` as a valid `TaskStatus`; `taskSchema.proposal` of type `TaskProposal` with fields `origin_run_id`, `origin_task_id`, `motive`, `audit`, `audit_reason?`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/task-proposal.test.ts
import { describe, expect, it } from "bun:test";
import { taskSchema, taskStatusSchema } from "./task.js";

const base = {
  id: "task_009",
  title: "Split the store writer",
  status: "proposed" as const,
  priority: "P2" as const,
  planning: { split_status: "pending" as const, risk: "medium" as const },
  created_at: "2026-08-17T10:00:00.000Z",
  updated_at: "2026-08-17T10:00:00.000Z",
};

describe("proposed status", () => {
  it("accepts 'proposed' as a task status", () => {
    expect(taskStatusSchema.parse("proposed")).toBe("proposed");
  });

  it("carries provenance and defaults the audit to pending", () => {
    const task = taskSchema.parse({
      ...base,
      proposal: {
        origin_run_id: "run_004",
        origin_task_id: "task_002",
        motive: "The writer is not reentrant; found while editing state-files.",
      },
    });
    expect(task.proposal?.audit).toBe("pending");
  });

  it("keeps loading a task with no proposal block", () => {
    const task = taskSchema.parse({ ...base, status: "backlog" });
    expect(task.proposal).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/schemas/src/task-proposal.test.ts`
Expected: FAIL — `"proposed"` is not a member of the status enum

- [ ] **Step 3: Write minimal implementation**

In `packages/schemas/src/task.ts`, add `"proposed"` as the **first** member of `taskStatusSchema` — it sits upstream of `backlog` in the flow:

```ts
export const taskStatusSchema = z.enum([
  "proposed",
  "backlog",
  "ready",
  "in_progress",
  "review",
  "test",
  "released",
  "done",
  "blocked",
]);
```

Then add this to `taskSchema`, next to `archived_at` (same orthogonal-metadata neighbourhood):

```ts
  // Set only on tasks an agent proposed from a trace. `proposed` tasks are
  // never runnable (asserted in the scheduler) and are invisible in default
  // board views until a human accepts them into `backlog`.
  proposal: z
    .object({
      origin_run_id: z.string().min(1),
      origin_task_id: z.string().min(1),
      motive: z.string().min(1),
      audit: z.enum(["pending", "accepted", "rejected"]).default("pending"),
      audit_reason: z.string().min(1).optional(),
    })
    .optional(),
```

Add the type export next to the existing ones at the bottom of the file:

```ts
export type TaskProposal = NonNullable<z.infer<typeof taskSchema>["proposal"]>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/schemas/src/task-proposal.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Run the whole suite to catch exhaustive switches**

Run: `bun run test`
Expected: PASS. A new enum member can break exhaustive `switch` statements over task status. If anything fails, fix the switch to handle `"proposed"` explicitly — do not add a `default` that swallows it.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add packages/schemas/src/task.ts packages/schemas/src/task-proposal.test.ts
git commit -m "feat(schemas): add the proposed task status and proposal provenance"
```

---

### Task 3: Append-only trace store

**Files:**
- Create: `packages/core/src/trace-store.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/trace-store.test.ts`

**Interfaces:**
- Consumes: `Trace`, `traceSchema` from Task 1.
- Produces: `tracesDir(backlogDir): string`, `traceFilePath(backlogDir, taskId): string`, `appendTrace(backlogDir, trace): string`, `listTraces(backlogDir, taskId): Trace[]`.

One NDJSON file per task under `.backlog/traces/`, append-only: a task that ran three times carries three lines, and a retry appends rather than correcting its predecessor.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/trace-store.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import type { Trace } from "@backlog/schemas";
import { appendTrace, listTraces, traceFilePath } from "./trace-store.js";

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    version: 1,
    run_id: "run_001",
    task_id: "task_001",
    created_at: "2026-08-17T10:00:00.000Z",
    outcome: "implemented",
    summary: "Did the thing.",
    constraints: [],
    decisions: [],
    discovered_deps: [],
    consolidation_hint: "none",
    ...overrides,
  } as Trace;
}

describe("trace-store", () => {
  let backlogDir: string;

  beforeEach(() => {
    backlogDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-trace-"));
  });

  it("creates the traces directory on first append", () => {
    appendTrace(backlogDir, trace());
    expect(fs.existsSync(path.join(backlogDir, "traces"))).toBe(true);
  });

  it("appends rather than replacing, keeping chronological order", () => {
    appendTrace(backlogDir, trace({ run_id: "run_001", summary: "first" }));
    appendTrace(backlogDir, trace({ run_id: "run_002", summary: "second" }));
    const traces = listTraces(backlogDir, "task_001");
    expect(traces.map((t) => t.summary)).toEqual(["first", "second"]);
  });

  it("keeps each task's traces in its own file", () => {
    appendTrace(backlogDir, trace({ task_id: "task_001" }));
    appendTrace(backlogDir, trace({ task_id: "task_002" }));
    expect(listTraces(backlogDir, "task_001")).toHaveLength(1);
    expect(listTraces(backlogDir, "task_002")).toHaveLength(1);
  });

  it("returns an empty list for a task with no traces", () => {
    expect(listTraces(backlogDir, "task_404")).toEqual([]);
  });

  it("skips an unparseable line instead of throwing", () => {
    appendTrace(backlogDir, trace());
    fs.appendFileSync(traceFilePath(backlogDir, "task_001"), "{ not json\n", "utf8");
    expect(listTraces(backlogDir, "task_001")).toHaveLength(1);
  });

  it("rejects a task id that would escape the traces directory", () => {
    expect(() => appendTrace(backlogDir, trace({ task_id: "../escape" }))).toThrow(
      /invalid task id/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/trace-store.test.ts`
Expected: FAIL — `Cannot find module './trace-store.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/trace-store.ts
import fs from "node:fs";
import path from "node:path";
import { traceSchema, type Trace } from "@backlog/schemas";

// Traces live outside git, one append-only NDJSON file per task. Append-only is
// load-bearing: a trace is a journal entry, so it is never edited or replaced —
// a retried run adds a line, it does not correct its predecessor.

export function tracesDir(backlogDir: string): string {
  return path.join(backlogDir, "traces");
}

// Task ids are generated internally, but this store is reachable from the CLI
// and the API, so the id is treated as untrusted input before it becomes a path.
function assertSafeTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error(`invalid task id for a trace file: ${taskId}`);
  }
}

export function traceFilePath(backlogDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return path.join(tracesDir(backlogDir), `${taskId}.ndjson`);
}

export function appendTrace(backlogDir: string, trace: Trace): string {
  const parsed = traceSchema.parse(trace);
  const filePath = traceFilePath(backlogDir, parsed.task_id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(parsed) + "\n", "utf8");
  return filePath;
}

export function listTraces(backlogDir: string, taskId: string): Trace[] {
  const filePath = traceFilePath(backlogDir, taskId);
  if (!fs.existsSync(filePath)) return [];
  const traces: Trace[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      traces.push(traceSchema.parse(JSON.parse(trimmed)));
    } catch {
      // A hand-corrupted line must not make the whole history unreadable.
    }
  }
  return traces;
}
```

Then export it from `packages/core/src/index.ts`, matching the existing export style there:

```ts
export * from "./trace-store.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/trace-store.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/trace-store.ts packages/core/src/trace-store.test.ts packages/core/src/index.ts
git commit -m "feat(core): store agent traces append-only, one file per task"
```

---

### Task 4: Status derivation from the outcome

**Files:**
- Create: `packages/core/src/trace-service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/trace-service.test.ts`

**Interfaces:**
- Consumes: `appendTrace` (Task 3); `blockTask`, `updateSubTaskStatus`, `getSubTask` from `./subtask-service.js`; `getTask`, `updateTaskStatus` from `./task-service.js`.
- Produces: `recordTrace(input: RecordTraceInput): RecordTraceResult`, where

```ts
export interface RecordTraceInput { backlogDir: string; trace: Trace }
export interface RecordTraceResult {
  trace: Trace;
  transitions: string[];      // human-readable, e.g. "subtask_002 → blocked"
  createdProposals: string[]; // task ids created in `proposed`
  linkedDeps: string[];       // existing task ids added as dependencies
}
```

`implemented` deliberately produces **no** transition: the existing
`finalizeSuccessfulRun` path already decides review-vs-complete from
`successMode`, and a second writer would be able to contradict it. This task
covers `rejected` and `blocked` only; proposals come in Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/trace-service.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import type { Trace } from "@backlog/schemas";
import { createSubTask, getSubTask } from "./subtask-service.js";
import { createTask, getTask } from "./task-service.js";
import { recordTrace } from "./trace-service.js";
import { listTraces } from "./trace-store.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-trace-svc-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "trace-svc-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("recordTrace", () => {
  let root: string;
  let backlogDir: string;
  let taskId: string;
  let subtaskId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
    taskId = createTask(backlogDir, { title: "Harden the store" }).id;
    subtaskId = createSubTask(backlogDir, {
      workItemId: taskId,
      title: "Guard the writer",
      repo: "backlog",
    }).id;
  });

  function trace(overrides: Partial<Trace> = {}): Trace {
    return {
      version: 1,
      run_id: "run_001",
      task_id: taskId,
      subtask_id: subtaskId,
      created_at: "2026-08-17T10:00:00.000Z",
      outcome: "implemented",
      summary: "Did the thing.",
      constraints: [],
      decisions: [],
      discovered_deps: [],
      consolidation_hint: "none",
      ...overrides,
    } as Trace;
  }

  it("persists the trace whatever the outcome", () => {
    recordTrace({ backlogDir, trace: trace() });
    expect(listTraces(backlogDir, taskId)).toHaveLength(1);
  });

  it("leaves the status alone for an implemented outcome", () => {
    const before = getSubTask(backlogDir, subtaskId)!.status;
    const result = recordTrace({ backlogDir, trace: trace() });
    expect(result.transitions).toEqual([]);
    expect(getSubTask(backlogDir, subtaskId)!.status).toBe(before);
  });

  it("sends a rejected outcome to review", () => {
    const result = recordTrace({
      backlogDir,
      trace: trace({ outcome: "rejected", rejection_reason: "Overkill for now." }),
    });
    expect(getSubTask(backlogDir, subtaskId)!.status).toBe("review");
    expect(result.transitions).toHaveLength(1);
  });

  it("blocks on a blocked outcome and records the question as the blocker", () => {
    recordTrace({
      backlogDir,
      trace: trace({ outcome: "blocked", open_question: "Which credential should it use?" }),
    });
    const subtask = getSubTask(backlogDir, subtaskId)!;
    expect(subtask.status).toBe("blocked");
    expect(subtask.blockers).toContain("Which credential should it use?");
  });

  it("rejects a trace whose task does not exist", () => {
    expect(() => recordTrace({ backlogDir, trace: trace({ task_id: "task_404" }) })).toThrow(
      /Unknown task/,
    );
  });

  it("offers no path to a completed subtask or a done task", () => {
    // Spec §12: an agent must not be able to mark its own work finished. Every
    // outcome is tried; none may land on a terminal status, which is what keeps
    // manual_approval_required a guarantee rather than a suggestion.
    for (const variant of [
      trace({ run_id: "run_a", outcome: "implemented" }),
      trace({ run_id: "run_b", outcome: "rejected", rejection_reason: "Overkill." }),
      trace({ run_id: "run_c", outcome: "blocked", open_question: "Which credential?" }),
    ]) {
      recordTrace({ backlogDir, trace: variant });
      expect(getSubTask(backlogDir, subtaskId)!.status).not.toBe("completed");
      expect(getTask(backlogDir, taskId)!.status).not.toBe("done");
    }
  });

  it("rejects a trace whose subtask does not belong to the task", () => {
    const otherTask = createTask(backlogDir, { title: "Unrelated" }).id;
    const foreign = createSubTask(backlogDir, {
      workItemId: otherTask,
      title: "Elsewhere",
      repo: "backlog",
    }).id;
    expect(() => recordTrace({ backlogDir, trace: trace({ subtask_id: foreign }) })).toThrow(
      /does not belong/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/trace-service.test.ts`
Expected: FAIL — `Cannot find module './trace-service.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/trace-service.ts
import { traceSchema, type Trace } from "@backlog/schemas";
import { blockTask, getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask, updateTaskStatus } from "./task-service.js";
import { appendTrace } from "./trace-store.js";

export interface RecordTraceInput {
  backlogDir: string;
  trace: Trace;
}

export interface RecordTraceResult {
  trace: Trace;
  transitions: string[];
  createdProposals: string[];
  linkedDeps: string[];
}

// One outcome produces at most one transition. `implemented` produces none on
// purpose: finalizeSuccessfulRun already derives review-vs-complete from the
// agent's success_mode and manual_approval_required, and a second writer here
// could contradict it — which is the whole reason the trace is the only status
// channel (spec T2).
export function recordTrace(input: RecordTraceInput): RecordTraceResult {
  const { backlogDir } = input;
  const trace = traceSchema.parse(input.trace);

  const task = getTask(backlogDir, trace.task_id);
  if (!task) {
    throw new Error(`Unknown task: ${trace.task_id}`);
  }
  if (trace.subtask_id) {
    const subtask = getSubTask(backlogDir, trace.subtask_id);
    if (!subtask) {
      throw new Error(`Unknown subtask: ${trace.subtask_id}`);
    }
    if (subtask.task_id !== trace.task_id) {
      throw new Error(
        `Subtask ${trace.subtask_id} does not belong to task ${trace.task_id}`,
      );
    }
  }

  appendTrace(backlogDir, trace);

  // A trace without a subtask_id targets the parent task directly. That is not
  // an edge case: `worktree_mode: "direct"` is the default and produces exactly
  // these targets, so the transition must be applied here too — otherwise an
  // agent declaring itself blocked on a default-mode run blocks nothing, and
  // unblock-and-resume never fires for the common path. The if/else stays a
  // strict either/or: a trace never writes status through both channels.
  const transitions: string[] = [];
  if (trace.outcome === "rejected") {
    if (trace.subtask_id) {
      updateSubTaskStatus(backlogDir, trace.subtask_id, "review");
      transitions.push(`${trace.subtask_id} → review`);
    } else {
      updateTaskStatus(backlogDir, trace.task_id, "review");
      transitions.push(`${trace.task_id} → review`);
    }
  } else if (trace.outcome === "blocked") {
    // open_question is guaranteed present by traceSchema for this outcome.
    const question = trace.open_question!;
    if (trace.subtask_id) {
      blockTask(backlogDir, trace.subtask_id, [question]);
      transitions.push(`${trace.subtask_id} → blocked`);
    } else {
      updateTaskStatus(backlogDir, trace.task_id, "blocked");
      transitions.push(`${trace.task_id} → blocked`);
    }
  }

  return { trace, transitions, createdProposals: [], linkedDeps: [] };
}
```

Export it from `packages/core/src/index.ts`:

```ts
export * from "./trace-service.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/trace-service.test.ts`
Expected: PASS, 10 tests

Three of those cover the task-level branch (no `subtask_id`), which the
subtask-scoped tests never reach: rejected → the parent task in `review` with
exactly one transition, blocked → the parent task in `blocked`, and implemented →
the parent task untouched with no transitions.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/trace-service.ts packages/core/src/trace-service.test.ts packages/core/src/index.ts
git commit -m "feat(core): derive the ticket status from the trace outcome"
```

---

### Task 5: Discovered dependencies and proposals

**Files:**
- Modify: `packages/core/src/trace-service.ts`
- Modify: `packages/core/src/trace-service.test.ts`

**Interfaces:**
- Consumes: `recordTrace` (Task 4); `updateTask` from `./task-service.js`.
- Produces: `recordTrace` now fills `createdProposals` and `linkedDeps`. Proposed tasks are created with `status: "proposed"` and a `proposal` block whose `audit` is `pending`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/trace-service.test.ts`, inside the existing `describe("recordTrace", ...)` block:

```ts
  it("links an existing task as a dependency", () => {
    const upstream = createTask(backlogDir, { title: "Upstream work" }).id;
    const result = recordTrace({
      backlogDir,
      trace: trace({ discovered_deps: [{ kind: "existing", task_id: upstream }] }),
    });
    expect(result.linkedDeps).toEqual([upstream]);
    expect(getTask(backlogDir, taskId)!.dependencies).toContain(upstream);
  });

  it("does not duplicate a dependency that is already declared", () => {
    const upstream = createTask(backlogDir, { title: "Upstream work" }).id;
    const dep = { kind: "existing" as const, task_id: upstream };
    recordTrace({ backlogDir, trace: trace({ run_id: "run_001", discovered_deps: [dep] }) });
    recordTrace({ backlogDir, trace: trace({ run_id: "run_002", discovered_deps: [dep] }) });
    const dependencies = getTask(backlogDir, taskId)!.dependencies;
    expect(dependencies.filter((id) => id === upstream)).toHaveLength(1);
  });

  it("rejects a dependency pointing at an unknown task", () => {
    expect(() =>
      recordTrace({
        backlogDir,
        trace: trace({ discovered_deps: [{ kind: "existing", task_id: "task_404" }] }),
      }),
    ).toThrow(/Unknown dependency/);
  });

  it("creates a proposal in the proposed status, never runnable", () => {
    const result = recordTrace({
      backlogDir,
      trace: trace({
        discovered_deps: [
          {
            kind: "proposal",
            proposal: { title: "Make the writer reentrant", motive: "Found while editing." },
          },
        ],
      }),
    });
    expect(result.createdProposals).toHaveLength(1);
    const created = getTask(backlogDir, result.createdProposals[0]!)!;
    expect(created.status).toBe("proposed");
    expect(created.proposal?.audit).toBe("pending");
    expect(created.proposal?.origin_run_id).toBe("run_001");
    expect(created.proposal?.origin_task_id).toBe(taskId);
    expect(created.proposal?.motive).toBe("Found while editing.");
  });

  it("carries the proposal's scopes onto the created task", () => {
    const result = recordTrace({
      backlogDir,
      trace: trace({
        discovered_deps: [
          {
            kind: "proposal",
            proposal: {
              title: "Make the writer reentrant",
              motive: "Found while editing.",
              scopes: ["packages/core/src/state-files.ts"],
            },
          },
        ],
      }),
    });
    const created = getTask(backlogDir, result.createdProposals[0]!)!;
    expect(created.description).toContain("packages/core/src/state-files.ts");
  });
```

`getTask` is already imported in the test file from Task 4 — no import change is
needed here.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/trace-service.test.ts`
Expected: FAIL — `expect(result.linkedDeps).toEqual([upstream])` receives `[]`

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/trace-service.ts`, add the import:

```ts
import { createTask, getTask, updateTask } from "./task-service.js";
```

Add this helper above `recordTrace`:

```ts
// A discovered dependency is either an edge to a ticket that exists, or work
// that has no ticket yet. The second case creates a task in `proposed` — never
// `ready`, never `backlog` — so nothing an agent invents can schedule itself.
// `backlog` already means "to do"; unvetted work does not belong there.
function applyDiscoveredDeps(
  backlogDir: string,
  trace: Trace,
): { createdProposals: string[]; linkedDeps: string[] } {
  const createdProposals: string[] = [];
  const linkedDeps: string[] = [];

  for (const dep of trace.discovered_deps) {
    if (dep.kind === "existing") {
      if (!getTask(backlogDir, dep.task_id)) {
        throw new Error(`Unknown dependency: ${dep.task_id}`);
      }
      if (dep.task_id === trace.task_id) continue;
      const current = getTask(backlogDir, trace.task_id)!;
      if (!current.dependencies.includes(dep.task_id)) {
        updateTask(backlogDir, trace.task_id, {
          dependencies: [...current.dependencies, dep.task_id],
        });
      }
      if (!linkedDeps.includes(dep.task_id)) linkedDeps.push(dep.task_id);
      continue;
    }

    const scopeNote =
      dep.proposal.scopes.length > 0
        ? `\n\nExpected scope:\n${dep.proposal.scopes.map((s) => `- ${s}`).join("\n")}`
        : "";
    const created = createTask(backlogDir, {
      title: dep.proposal.title,
      description: `${dep.proposal.motive}${scopeNote}`,
      status: "proposed",
    });
    updateTask(backlogDir, created.id, {
      proposal: {
        origin_run_id: trace.run_id,
        origin_task_id: trace.task_id,
        motive: dep.proposal.motive,
        audit: "pending",
      },
    });
    createdProposals.push(created.id);
  }

  return { createdProposals, linkedDeps };
}
```

Then replace the return statement of `recordTrace` with:

```ts
  const { createdProposals, linkedDeps } = applyDiscoveredDeps(backlogDir, trace);
  return { trace, transitions, createdProposals, linkedDeps };
```

`updateTask` must accept the proposal field. In
`packages/core/src/task-service.ts`, add to `UpdateTaskInput` (and add
`TaskProposal` — exported in Task 2 — to the `@backlog/schemas` import at the top
of that file):

```ts
  proposal?: TaskProposal;
```

and inside `updateTask`, next to the existing field assignments:

```ts
  if (input.proposal !== undefined) {
    item.proposal = input.proposal;
  }
```

(`dependencies` is already handled — `task-service.ts` assigns it when present.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/trace-service.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/trace-service.ts packages/core/src/trace-service.test.ts packages/core/src/task-service.ts
git commit -m "feat(core): link discovered dependencies and create proposals from a trace"
```

---

### Task 6: The scheduler never runs a proposed task

**Files:**
- Modify: `packages/core/src/scheduler.ts:215-216`
- Modify: `packages/core/src/scheduler.ts` — the funnel every candidate passes
  through, where the load-bearing guard belongs (see below)
- Modify: `packages/core/src/subtask-service.ts` — `createSubTask` bypasses the
  guard entirely (see below)
- Test: `packages/core/src/scheduler-proposed.test.ts`

**Interfaces:**
- Consumes: `buildExecutionPlan` from `./scheduler.js`, `"proposed"` status (Task 2).
- Produces: no new export. Guarantees that no `proposed` task appears in `plan.runnable`, by any code path.

Today `scheduler.ts:216` lets an explicitly targeted task through when its status
is `ready` **or** `backlog`. A `proposed` task falls outside that pair and is
already excluded — but only incidentally. The spec asks for an assertion, so a
later edit to that condition cannot silently make agent-invented work runnable.

**Two corrections, both found during execution, that this task's original text got
wrong.** They are the substance of the task, not footnotes:

1. **`createSubTask` bypasses any scheduler-side guard.** It ends with an
   unconditional `updateTaskStatus(backlogDir, input.workItemId, "ready")`, so
   attaching a subtask to a `proposed` task promotes it out of `proposed` before
   the scheduler ever sees it. Gate that call on `workItem.status !== "proposed"`,
   preserving the promotion for every other status. Without this, the invariant is
   false no matter what the scheduler does.
2. **The guard must sit in the funnel, not only in the direct-task loop.** The
   edit at lines 215-216 turns out to be functionally redundant, since line 221
   already excludes `proposed`. The guard that actually holds belongs where every
   candidate is evaluated, returning a blocked decision before any dependency,
   claim or agent-compatibility reasoning runs. Keep the loop guard as
   future-proofing, but the funnel guard is the one that makes the invariant true.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/scheduler-proposed.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { buildExecutionPlan } from "./scheduler.js";
import { createSubTask } from "./subtask-service.js";
import { createTask, updateTaskStatus } from "./task-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-sched-prop-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "sched-prop-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("scheduler and the proposed status", () => {
  let root: string;
  let backlogDir: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
  });

  it("never returns a proposed task as runnable", () => {
    const task = createTask(backlogDir, { title: "Proposed work", status: "proposed" });
    createSubTask(backlogDir, { workItemId: task.id, title: "Do it", repo: "backlog" });
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir));
    expect(plan.runnable.map((d) => d.workItemId)).not.toContain(task.id);
  });

  it("never returns a proposed task even when explicitly targeted", () => {
    const task = createTask(backlogDir, { title: "Proposed work", status: "proposed" });
    const subtask = createSubTask(backlogDir, {
      workItemId: task.id,
      title: "Do it",
      repo: "backlog",
    });
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir), {
      workItemId: task.id,
      taskId: subtask.id,
    });
    expect(plan.runnable).toEqual([]);
  });

  it("still returns a task that was accepted into backlog when targeted", () => {
    const task = createTask(backlogDir, { title: "Accepted work", status: "proposed" });
    createSubTask(backlogDir, { workItemId: task.id, title: "Do it", repo: "backlog" });
    updateTaskStatus(backlogDir, task.id, "backlog");
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir), { workItemId: task.id });
    expect(plan.runnable.map((d) => d.workItemId)).toContain(task.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/scheduler-proposed.test.ts`
Expected, as actually observed during execution: **1 pass / 2 fail.** The two
"never returns a proposed task" tests FAIL, because `createSubTask` has already
promoted the task to `ready` by the time the plan is built — see correction 1
above. The third test passes, since promoting to `backlog` is what it asserts
anyway. Record the actual result before changing code; if your run disagrees with
this, stop and report it rather than adapting the tests.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/scheduler.ts`, replace lines 215-216:

```ts
    if (!options?.workItemId && workItem.status !== "ready") continue;
    if (options?.workItemId && workItem.status !== "ready" && workItem.status !== "backlog") continue;
```

with:

```ts
    // `proposed` is agent-invented work that no one has audited. It is never
    // runnable by any path, including an explicit target — this is what stops a
    // create → run → create cycle. Checked first and unconditionally so a later
    // edit to the conditions below cannot reopen it.
    if (workItem.status === "proposed") continue;
    if (!options?.workItemId && workItem.status !== "ready") continue;
    if (options?.workItemId && workItem.status !== "ready" && workItem.status !== "backlog") continue;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/scheduler-proposed.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Run the scheduler suite for regressions**

Run: `bun test packages/core/src/scheduler.test.ts`
Expected: PASS, unchanged

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add packages/core/src/scheduler.ts packages/core/src/scheduler-proposed.test.ts
git commit -m "feat(core): never schedule a proposed task, by any path"
```

---

### Task 7: CLI — `backlog trace write` and `backlog trace show`

**Files:**
- Create: `packages/cli/src/commands/trace.ts`
- Modify: `packages/cli/src/bin.ts` (register the command next to the existing `registerTaskCommand` calls)
- Test: `packages/cli/src/commands/trace.test.ts`

**Interfaces:**
- Consumes: `recordTrace` (Task 4), `listTraces` (Task 3), `findProject` from `@backlog/config`.
- Produces: `registerTraceCommand(program: Command): void`. Two subcommands: `backlog trace write` (JSON on **stdin**) and `backlog trace show <taskId>`.

JSON arrives on stdin, never in argv: a nested payload in a command line is
error-prone, and argv is visible in `ps`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/commands/trace.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { createSubTask, createTask, getSubTask, listTraces } from "@backlog/core";
import { readTraceFromStdin, runTraceShow, runTraceWrite } from "./trace.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-cli-trace-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "cli-trace-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("backlog trace", () => {
  let root: string;
  let backlogDir: string;
  let taskId: string;
  let subtaskId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
    taskId = createTask(backlogDir, { title: "Harden the store" }).id;
    subtaskId = createSubTask(backlogDir, {
      workItemId: taskId,
      title: "Guard the writer",
      repo: "backlog",
    }).id;
  });

  it("writes a trace from a JSON payload and reports the transitions", () => {
    const result = runTraceWrite(backlogDir, {
      version: 1,
      run_id: "run_001",
      task_id: taskId,
      subtask_id: subtaskId,
      created_at: "2026-08-17T10:00:00.000Z",
      outcome: "blocked",
      summary: "Stuck on credentials.",
      open_question: "Which credential should it use?",
    });
    expect(listTraces(backlogDir, taskId)).toHaveLength(1);
    expect(getSubTask(backlogDir, subtaskId)!.status).toBe("blocked");
    expect(result.transitions).toHaveLength(1);
  });

  it("fills run ids from the environment when the payload omits them", () => {
    const previous = { run: process.env.BACKLOG_RUN_ID, task: process.env.BACKLOG_TASK_ID };
    process.env.BACKLOG_RUN_ID = "run_042";
    process.env.BACKLOG_TASK_ID = taskId;
    try {
      runTraceWrite(backlogDir, {
        outcome: "implemented",
        summary: "Done.",
      });
      expect(listTraces(backlogDir, taskId)[0]!.run_id).toBe("run_042");
    } finally {
      process.env.BACKLOG_RUN_ID = previous.run;
      process.env.BACKLOG_TASK_ID = previous.task;
    }
  });

  it("reports a validation error instead of writing a partial trace", () => {
    expect(() =>
      runTraceWrite(backlogDir, {
        version: 1,
        run_id: "run_001",
        task_id: taskId,
        created_at: "2026-08-17T10:00:00.000Z",
        outcome: "rejected",
        summary: "Not worth it.",
      }),
    ).toThrow(/rejection_reason/);
    expect(listTraces(backlogDir, taskId)).toHaveLength(0);
  });

  it("shows the traces of a task in chronological order", () => {
    runTraceWrite(backlogDir, {
      version: 1, run_id: "run_001", task_id: taskId,
      created_at: "2026-08-17T10:00:00.000Z", outcome: "implemented", summary: "first",
    });
    runTraceWrite(backlogDir, {
      version: 1, run_id: "run_002", task_id: taskId,
      created_at: "2026-08-17T11:00:00.000Z", outcome: "implemented", summary: "second",
    });
    const lines = runTraceShow(backlogDir, taskId);
    expect(lines.join("\n")).toContain("first");
    expect(lines.join("\n")).toContain("second");
    expect(lines.join("\n").indexOf("first")).toBeLessThan(lines.join("\n").indexOf("second"));
  });

  it("says so plainly when a task has no trace", () => {
    expect(runTraceShow(backlogDir, taskId).join("\n")).toContain("No trace");
  });

  it("parses a JSON payload from a stdin stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"outcome":'));
        controller.enqueue(new TextEncoder().encode('"implemented","summary":"ok"}'));
        controller.close();
      },
    });
    expect(await readTraceFromStdin(stream)).toEqual({ outcome: "implemented", summary: "ok" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/commands/trace.test.ts`
Expected: FAIL — `Cannot find module './trace.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/commands/trace.ts
import { Command } from "commander";
import { findProject } from "@backlog/config";
import { listTraces, recordTrace, type RecordTraceResult } from "@backlog/core";

// The agent-facing write surface. JSON arrives on stdin rather than in argv: a
// nested payload in a command line is error-prone, and argv shows up in `ps`.

export async function readTraceFromStdin(
  stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    throw new Error("No trace payload on stdin. Pipe a JSON object into `backlog trace write`.");
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The trace payload must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

// An agent already has BACKLOG_RUN_ID / BACKLOG_TASK_ID / BACKLOG_SUBTASK_ID in
// its environment, so the payload may omit them. Anything the payload states
// wins, so a caller can still write a trace for another context deliberately.
function withContextDefaults(payload: Record<string, unknown>): Record<string, unknown> {
  const filled: Record<string, unknown> = { version: 1, ...payload };
  if (filled.run_id === undefined && process.env.BACKLOG_RUN_ID) {
    filled.run_id = process.env.BACKLOG_RUN_ID;
  }
  if (filled.task_id === undefined && process.env.BACKLOG_TASK_ID) {
    filled.task_id = process.env.BACKLOG_TASK_ID;
  }
  if (filled.subtask_id === undefined && process.env.BACKLOG_SUBTASK_ID) {
    filled.subtask_id = process.env.BACKLOG_SUBTASK_ID;
  }
  if (filled.created_at === undefined) {
    filled.created_at = new Date().toISOString();
  }
  return filled;
}

export function runTraceWrite(
  backlogDir: string,
  payload: Record<string, unknown>,
): RecordTraceResult {
  const filled = withContextDefaults(payload);
  // recordTrace re-parses through traceSchema, so an invalid payload throws
  // before anything is persisted.
  return recordTrace({ backlogDir, trace: filled as never });
}

export function runTraceShow(backlogDir: string, taskId: string): string[] {
  const traces = listTraces(backlogDir, taskId);
  if (traces.length === 0) {
    return [`No trace recorded for ${taskId}.`];
  }
  const lines: string[] = [];
  for (const trace of traces) {
    lines.push(`${trace.created_at}  ${trace.run_id}  ${trace.outcome}`);
    lines.push(`  ${trace.summary}`);
    if (trace.rejection_reason) lines.push(`  rejected because: ${trace.rejection_reason}`);
    if (trace.open_question) lines.push(`  open question: ${trace.open_question}`);
    for (const constraint of trace.constraints) {
      lines.push(`  constraint (${constraint.confidence}): ${constraint.statement}`);
      lines.push(`    evidence: ${constraint.evidence}`);
    }
    for (const decision of trace.decisions) {
      lines.push(`  chose ${decision.chose} over ${decision.rejected}: ${decision.because}`);
    }
    lines.push("");
  }
  return lines;
}

function resolveBacklogDir(projectOption?: string): string {
  const project = findProject(projectOption ?? process.cwd());
  if (!project) {
    throw new Error("No .backlog project found. Pass --project or run from inside one.");
  }
  return project.backlogDir;
}

export function registerTraceCommand(program: Command): void {
  const trace = program.command("trace").description("Record and read agent traces on a ticket");

  trace
    .command("write")
    .description("Write a trace from a JSON object on stdin")
    .option("--project <path>", "Project to operate on. Defaults to the resolved one.")
    .action(async (options: { project?: string }) => {
      const backlogDir = resolveBacklogDir(options.project);
      const payload = await readTraceFromStdin(Bun.stdin.stream());
      const result = runTraceWrite(backlogDir, payload);
      console.log(`Trace recorded for ${result.trace.task_id} (${result.trace.outcome}).`);
      for (const transition of result.transitions) console.log(`  ${transition}`);
      for (const id of result.linkedDeps) console.log(`  linked dependency ${id}`);
      for (const id of result.createdProposals) console.log(`  proposed ${id}`);
    });

  trace
    .command("show <taskId>")
    .description("Show every trace recorded on a task, oldest first")
    .option("--project <path>", "Project to operate on. Defaults to the resolved one.")
    .action((taskId: string, options: { project?: string }) => {
      for (const line of runTraceShow(resolveBacklogDir(options.project), taskId)) {
        console.log(line);
      }
    });
}
```

Then register it in `packages/cli/src/bin.ts`, alongside the other
`register*Command(program)` calls:

```ts
import { registerTraceCommand } from "./commands/trace.js";
// ...
registerTraceCommand(program);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/commands/trace.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the command end to end**

```bash
bun run dev trace show task_001 --project /tmp/does-not-exist
```
Expected: fails with `No .backlog project found.` — proving the command is
registered and its error path is wired.

- [ ] **Step 6: Full verification and commit**

```bash
bun run typecheck
bun run test
bun run build
git add packages/cli/src/commands/trace.ts packages/cli/src/commands/trace.test.ts packages/cli/src/bin.ts
git commit -m "feat(cli): add backlog trace write and trace show"
```

---

## Verification

After Task 7, all three must pass before the plan is considered done:

```bash
bun run typecheck    # tsc --noEmit + svelte-check
bun run test         # bun test ./packages
bun run build        # the real single binary
```

Then record the new namespace in the CLI command list. Note, corrected during
execution: the README has **no** top-level command enumeration — its `## Use`
section is a short curated example block. The list that genuinely enumerates the
namespaces is `CLAUDE.md` §6, so `trace` is added there.

## What this plan does not build

Deliberately deferred to a second plan, so this one produces working, testable
software on its own:

- The `trace_write` MCP tool and the separate agent tool set (spec T1, §2) —
  including the assertion that it contains no orchestration tool.
- The prompt disclosure section in `run-prompt.ts` (spec §9), which belongs with
  the prompt registry work.
- `backlog ticket trace` displaying the **consolidation verdict** per claim
  (spec §6): the verdict does not exist until the consolidator does, so
  `trace show` here prints the raw trace.
- The `proposed` column in the board, and the accept / reject routes (spec §7).
- The audit pass (spec §8).
