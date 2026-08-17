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

  // `discovered_deps` proposals accept a partial shape here (e.g. omitting
  // `scopes`) because the schema defaults it at parse time — the same
  // leniency `traceSchema.parse` below applies at runtime.
  type TraceOverrides = Partial<Omit<Trace, "discovered_deps">> & {
    discovered_deps?: Array<
      | { kind: "existing"; task_id: string }
      | { kind: "proposal"; proposal: { title: string; motive: string; scopes?: string[] } }
    >;
  };

  function trace(overrides: TraceOverrides = {}): Trace {
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

  it("sends a task-level rejected outcome (no subtask_id) to review on the parent task", () => {
    const result = recordTrace({
      backlogDir,
      trace: trace({
        subtask_id: undefined,
        outcome: "rejected",
        rejection_reason: "Overkill for now.",
      }),
    });
    expect(getTask(backlogDir, taskId)!.status).toBe("review");
    expect(result.transitions).toEqual([`${taskId} → review`]);
  });

  it("blocks the parent task on a task-level blocked outcome (no subtask_id)", () => {
    const result = recordTrace({
      backlogDir,
      trace: trace({
        subtask_id: undefined,
        outcome: "blocked",
        open_question: "Which credential should it use?",
      }),
    });
    expect(getTask(backlogDir, taskId)!.status).toBe("blocked");
    expect(result.transitions).toEqual([`${taskId} → blocked`]);
  });

  it("leaves the parent task alone for a task-level implemented outcome (no subtask_id)", () => {
    const before = getTask(backlogDir, taskId)!.status;
    const result = recordTrace({ backlogDir, trace: trace({ subtask_id: undefined }) });
    expect(result.transitions).toEqual([]);
    expect(getTask(backlogDir, taskId)!.status).toBe(before);
  });

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
});
