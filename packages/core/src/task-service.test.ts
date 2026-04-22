import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
import { blockTask, createTask, getTask, unblockTask, updateTask } from "./task-service.js";
import { createWorkItem, getWorkItem } from "./work-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-task-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    workspaceName: "task-test",
    mode: "embedded",
    repos: [
      {
        id: "cockpit",
        path: root,
        default_branch: "main",
        enabled: true,
      },
    ],
  });
  return root;
}

describe("task-service", () => {
  let root: string;
  let cockpitDir: string;
  let repoId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    cockpitDir = path.join(root, ".cockpit");
    repoId = loadConfig(cockpitDir).repos[0]!.id;
  });

  it("updates task metadata without changing its identity", () => {
    const workItem = createWorkItem(cockpitDir, { title: "Task editing", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "Initial task",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });

    const updated = updateTask(cockpitDir, task.id, {
      title: "Updated task",
      scopes: ["packages/core/src/**"],
      preferredAgents: ["codex-default"],
      requiredCapabilities: ["edit_code", "run_tests"],
      manualApprovalRequired: true,
      plannerLocked: true,
      blockers: ["needs fixture"],
    });

    expect(updated.id).toBe(task.id);
    expect(updated.title).toBe("Updated task");
    expect(updated.scopes).toEqual(["packages/core/src/**"]);
    expect(updated.execution.preferred_agents).toEqual(["codex-default"]);
    expect(updated.execution.required_capabilities).toEqual(["edit_code", "run_tests"]);
    expect(updated.execution.manual_approval_required).toBe(true);
    expect(updated.planner.locked).toBe(true);
    expect(updated.blockers).toEqual(["needs fixture"]);
  });

  it("blocks and unblocks tasks while keeping work status in sync", () => {
    const workItem = createWorkItem(cockpitDir, { title: "Task blocking", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "Task to block",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });

    const blocked = blockTask(cockpitDir, task.id, ["waiting on API", "needs review"]);
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockers).toEqual(["waiting on API", "needs review"]);
    expect(getWorkItem(cockpitDir, workItem.id)?.status).toBe("blocked");

    const stillBlocked = unblockTask(cockpitDir, task.id, ["waiting on API"]);
    expect(stillBlocked.status).toBe("blocked");
    expect(stillBlocked.blockers).toEqual(["needs review"]);

    const reopened = unblockTask(cockpitDir, task.id);
    expect(reopened.status).toBe("planned");
    expect(reopened.blockers).toEqual([]);
    expect(getTask(cockpitDir, task.id)?.status).toBe("planned");
    expect(getWorkItem(cockpitDir, workItem.id)?.status).toBe("in_progress");
  });
});
