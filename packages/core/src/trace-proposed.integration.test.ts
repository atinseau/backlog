import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { buildExecutionPlan } from "./scheduler.js";
import { splitTask } from "./split-service.js";
import { createSubTask, removeSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { createTask, getTask, updateTaskStatus } from "./task-service.js";
import { recordTrace } from "./trace-service.js";

// The composed path, end to end: a trace invents work, the proposal is born in
// `proposed`, and nothing an agent can do afterwards gets it out of `proposed`
// or onto the scheduler. Every unit on this path was tested in isolation and
// each one passed; the promotion bug only appears when they run in sequence
// (trace transition launders the status, then createSubTask no longer
// recognises a proposal and promotes it to `ready`). Hence one composed test.

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-trace-proposed-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "trace-proposed-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("a proposal born from a trace stays proposed and unschedulable", () => {
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

  function recordProposal(): string {
    const result = recordTrace({
      backlogDir,
      trace: {
        version: 1,
        run_id: "run_001",
        task_id: taskId,
        subtask_id: subtaskId,
        created_at: "2026-08-17T10:00:00.000Z",
        outcome: "implemented",
        summary: "Did the thing, found another.",
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
      },
    });
    expect(result.createdProposals).toHaveLength(1);
    return result.createdProposals[0]!;
  }

  it("survives a second trace naming it, then a subtask, and never becomes runnable", () => {
    const proposalId = recordProposal();
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");

    // A second trace names the proposal. Journalled, but it may not transition
    // the ticket — that is what used to launder `proposed` into `blocked`.
    const second = recordTrace({
      backlogDir,
      trace: {
        version: 1,
        run_id: "run_002",
        task_id: proposalId,
        created_at: "2026-08-17T11:00:00.000Z",
        outcome: "blocked",
        summary: "Cannot start this.",
        open_question: "Which credential should it use?",
      },
    });
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
    expect(second.transitions.join(" ")).toContain("no transition");

    // Attaching a subtask must not be a backdoor promotion either.
    const proposalSubtask = createSubTask(backlogDir, {
      workItemId: proposalId,
      title: "Do the invented work",
      repo: "backlog",
    });
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");

    const config = loadConfig(backlogDir);
    expect(
      buildExecutionPlan(backlogDir, config).runnable.map((d) => d.workItemId),
    ).not.toContain(proposalId);
    expect(
      buildExecutionPlan(backlogDir, config, {
        workItemId: proposalId,
        taskId: proposalSubtask.id,
      }).runnable,
    ).toEqual([]);
  });

  it("still refuses to move when the trace outcome is rejected", () => {
    const proposalId = recordProposal();
    const result = recordTrace({
      backlogDir,
      trace: {
        version: 1,
        run_id: "run_003",
        task_id: proposalId,
        created_at: "2026-08-17T12:00:00.000Z",
        outcome: "rejected",
        summary: "Not worth it.",
        rejection_reason: "Out of scope.",
      },
    });
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
    expect(result.transitions.join(" ")).toContain("no transition");
  });

  it("lets a human accept the proposal into backlog, and only then schedules it", () => {
    const proposalId = recordProposal();
    createSubTask(backlogDir, {
      workItemId: proposalId,
      title: "Do the invented work",
      repo: "backlog",
    });
    // The one way out, spec §7: a human accepts the proposal into `backlog`.
    updateTaskStatus(backlogDir, proposalId, "backlog");
    expect(getTask(backlogDir, proposalId)!.status).toBe("backlog");
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir), {
      workItemId: proposalId,
    });
    expect(plan.runnable.map((d) => d.workItemId)).toContain(proposalId);
  });
});

// The guard lives in updateTaskStatus, the single writer of task status, so it has
// to hold for every caller — not just the trace path. These are the writers that
// promoted to `ready` unconditionally before it existed.
describe("the proposed invariant holds for every writer of task status", () => {
  let root: string;
  let backlogDir: string;
  let proposalId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
    proposalId = createTask(backlogDir, {
      title: "Invented work",
      status: "proposed",
      repoTargets: ["backlog"],
    }).id;
  });

  it("createSubTask does not promote it", () => {
    createSubTask(backlogDir, { workItemId: proposalId, title: "Do it", repo: "backlog" });
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
  });

  it("a subtask status change does not promote it through the derived cascade", () => {
    const subtask = createSubTask(backlogDir, {
      workItemId: proposalId,
      title: "Do it",
      repo: "backlog",
    });
    // Legitimate subtask edit, illegitimate side effect: the derived parent status
    // is `ready`, which must not be written.
    updateSubTaskStatus(backlogDir, subtask.id, "queued");
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
  });

  it("removing the last subtask does not promote it", () => {
    const subtask = createSubTask(backlogDir, {
      workItemId: proposalId,
      title: "Do it",
      repo: "backlog",
    });
    removeSubTask(backlogDir, subtask.id);
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
  });

  it("splitting it does not promote it", () => {
    splitTask(backlogDir, { workItemId: proposalId, repos: ["backlog"], mode: "parallel" });
    expect(getTask(backlogDir, proposalId)!.status).toBe("proposed");
  });

  it("accepts the one legal exit, to backlog", () => {
    updateTaskStatus(backlogDir, proposalId, "backlog");
    expect(getTask(backlogDir, proposalId)!.status).toBe("backlog");
  });
});
