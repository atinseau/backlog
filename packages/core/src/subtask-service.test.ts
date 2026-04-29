import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { blockTask, createSubTask, getSubTask, removeSubTask, unblockTask, updateSubTask } from "./subtask-service.js";
import { createTask, getTask } from "./task-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-task-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "task-test",
    mode: "embedded",
    repos: [
      {
        id: "backlog",
        path: root,
        default_branch: "main",
        enabled: true,
        access_mode: "read-write",
      },
    ],
  });
  return root;
}

describe("task-service", () => {
  let root: string;
  let backlogDir: string;
  let repoId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
    repoId = loadConfig(backlogDir).repos[0]!.id;
  });

  it("updates task metadata without changing its identity", () => {
    const workItem = createTask(backlogDir, { title: "SubTask editing", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Initial task",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });

    const updated = updateSubTask(backlogDir, task.id, {
      title: "Updated task",
      scopes: ["packages/core/src/**"],
      preferredAgents: ["codex"],
      requiredCapabilities: ["edit_code", "run_tests"],
      manualApprovalRequired: true,
      plannerLocked: true,
      blockers: ["needs fixture"],
    });

    expect(updated.id).toBe(task.id);
    expect(updated.title).toBe("Updated task");
    expect(updated.scopes).toEqual(["packages/core/src/**"]);
    expect(updated.execution.preferred_agents).toEqual(["codex"]);
    expect(updated.execution.required_capabilities).toEqual(["edit_code", "run_tests"]);
    expect(updated.execution.manual_approval_required).toBe(true);
    expect(updated.planner.locked).toBe(true);
    expect(updated.blockers).toEqual(["needs fixture"]);
  });

  it("blocks and unblocks tasks while keeping work status in sync", () => {
    const workItem = createTask(backlogDir, { title: "SubTask blocking", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "SubTask to block",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });

    const blocked = blockTask(backlogDir, task.id, ["waiting on API", "needs review"]);
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers).toEqual(["waiting on API", "needs review"]);
    expect(getTask(backlogDir, workItem.id)?.status).toBe("blocked");

    const stillBlocked = unblockTask(backlogDir, task.id, ["waiting on API"]);
    expect(stillBlocked.status).toBe("blocked");
    expect(stillBlocked.blockers).toEqual(["needs review"]);

    const reopened = unblockTask(backlogDir, task.id);
    expect(reopened.status).toBe("planned");
    expect(reopened.blockers).toEqual([]);
    expect(getSubTask(backlogDir, task.id)?.status).toBe("planned");
    expect(getTask(backlogDir, workItem.id)?.status).toBe("in_progress");
  });

  it("removes one task and cleans up dependencies that point to it", () => {
    const workItem = createTask(backlogDir, { title: "SubTask removal", repoTargets: [repoId] });
    const first = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "First",
      repo: repoId,
    });
    const second = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Second",
      repo: repoId,
      dependsOn: [first.id],
    });

    const removed = removeSubTask(backlogDir, first.id);

    expect(removed.id).toBe(first.id);
    expect(getSubTask(backlogDir, first.id)).toBeNull();
    expect(getSubTask(backlogDir, second.id)?.depends_on).toEqual([]);
    expect(getTask(backlogDir, workItem.id)?.status).toBe("ready");
  });
});
