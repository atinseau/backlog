import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import type { Run, Task } from "@backlog/schemas";
import { estimateTask, FALLBACK_TASK_DURATION_SECONDS } from "./estimator.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-est-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, projectName: "est-test", mode: "embedded" });
  return path.join(root, ".backlog");
}

function writeArchivedRun(backlogDir: string, run: Run): void {
  const dir = path.join(backlogDir, "runs", "archive", run.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2), "utf8");
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-1",
    work_item_id: "WI-1",
    title: "Test",
    repo: "myrepo",
    status: "queued",
    priority_score: 50,
    risk: "medium",
    scopes: [],
    claim_mode: "exclusive",
    depends_on: [],
    blockers: [],
    execution: {
      lane: "frontend",
      preferred_agents: [],
      required_capabilities: [],
      manual_approval_required: false,
    },
    completion: { done_when: [] },
    planner: { origin: "manual", locked: false },
    created_at: "2026-04-26T10:00:00.000Z",
    updated_at: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    version: 1,
    id: `RUN-${Math.random().toString(36).slice(2, 8)}`,
    task_id: "TASK-archived",
    work_item_id: "WI-1",
    repo: "myrepo",
    branch: "feat/x",
    agent_id: "agent-1",
    provider: "claude",
    status: "succeeded",
    claim_ids: [],
    worktree_path: "/tmp/wt",
    artifacts: [],
    result: null,
    started_at: "2026-04-26T10:00:00.000Z",
    finished_at: "2026-04-26T10:30:00.000Z",
    ...overrides,
  };
}

describe("estimateTask", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  it("returns manual estimate when set", () => {
    const task = makeTask({ estimated_duration_seconds: 1234, estimate_source: "manual" });
    const result = estimateTask(backlogDir, task);
    expect(result.seconds).toBe(1234);
    expect(result.source).toBe("manual");
  });

  it("falls back to default when no archived runs and no manual estimate", () => {
    const task = makeTask();
    const result = estimateTask(backlogDir, task);
    expect(result.seconds).toBe(FALLBACK_TASK_DURATION_SECONDS);
    expect(result.source).toBe("auto");
    expect(result.sample_size).toBe(0);
  });

  it("uses median of same-lane runs when >= 3 samples", () => {
    const archivedTasks: Task[] = [];
    for (let i = 0; i < 4; i++) {
      const taskId = `TASK-arch-${i}`;
      archivedTasks.push(
        makeTask({
          id: taskId,
          execution: {
            lane: "frontend",
            preferred_agents: [],
            required_capabilities: [],
            manual_approval_required: false,
          },
        }),
      );
      writeArchivedRun(
        backlogDir,
        makeRun({
          id: `RUN-${i}`,
          task_id: taskId,
          started_at: "2026-04-26T10:00:00.000Z",
          finished_at: new Date(Date.parse("2026-04-26T10:00:00.000Z") + (i + 1) * 60_000).toISOString(),
        }),
      );
    }
    // tasks file
    fs.writeFileSync(
      path.join(backlogDir, "tasks.yaml"),
      `version: 1\ntasks:\n${archivedTasks
        .map((t) =>
          `  - id: ${t.id}\n    work_item_id: WI-1\n    title: ${t.title}\n    repo: ${t.repo}\n    status: completed\n    priority_score: 50\n    risk: medium\n    scopes: []\n    claim_mode: exclusive\n    depends_on: []\n    blockers: []\n    execution:\n      lane: frontend\n      preferred_agents: []\n      required_capabilities: []\n      manual_approval_required: false\n    completion:\n      done_when: []\n    planner:\n      origin: manual\n      locked: false\n    created_at: ${t.created_at}\n    updated_at: ${t.updated_at}`,
        )
        .join("\n")}\n`,
      "utf8",
    );

    const target = makeTask({
      execution: {
        lane: "frontend",
        preferred_agents: [],
        required_capabilities: [],
        manual_approval_required: false,
      },
    });
    const result = estimateTask(backlogDir, target);
    expect(result.source).toBe("auto");
    // medians of [60, 120, 180, 240] = 150
    expect(result.seconds).toBe(150);
    expect(result.sample_size).toBe(4);
  });

  it("ignores runs with mismatched repo", () => {
    for (let i = 0; i < 3; i++) {
      writeArchivedRun(backlogDir, makeRun({ id: `RUN-other-${i}`, repo: "other-repo" }));
    }
    const task = makeTask();
    const result = estimateTask(backlogDir, task);
    expect(result.seconds).toBe(FALLBACK_TASK_DURATION_SECONDS);
  });

  it("ignores non-succeeded runs", () => {
    for (let i = 0; i < 3; i++) {
      writeArchivedRun(backlogDir, makeRun({ id: `RUN-fail-${i}`, status: "failed" }));
    }
    const task = makeTask();
    const result = estimateTask(backlogDir, task);
    expect(result.seconds).toBe(FALLBACK_TASK_DURATION_SECONDS);
  });
});
