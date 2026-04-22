import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
import { createWorkItem, removeWorkItem, updateWorkItem } from "./work-service.js";
import { createTask, getTask } from "./task-service.js";
import { listPendingSyncConflicts, recordStatusConflict } from "./sync-conflicts.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-work-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  initLayout({ root, workspaceName: "work-test", mode: "embedded" });
  return root;
}

describe("work-service", () => {
  let cockpitDir: string;

  beforeEach(async () => {
    cockpitDir = path.join(await createWorkspace(), ".cockpit");
  });

  it("updates editable work item fields and planning metadata", () => {
    const item = createWorkItem(cockpitDir, {
      title: "Initial work item",
      description: "old description",
      repoTargets: ["cockpit"],
      labels: ["old"],
      acceptanceCriteria: ["one"],
    });

    const updated = updateWorkItem(cockpitDir, item.id, {
      title: "Updated work item",
      clearDescription: true,
      priority: "P0",
      repoTargets: ["cockpit", "docs"],
      labels: ["scheduler", "cli"],
      acceptanceCriteria: ["new acceptance"],
      dependencies: ["WI-upstream"],
      planningRisk: "high",
      preferredLane: "cockpit",
      splitStatus: "done",
    });

    expect(updated.title).toBe("Updated work item");
    expect(updated.description).toBeUndefined();
    expect(updated.priority).toBe("P0");
    expect(updated.repo_targets).toEqual(["cockpit", "docs"]);
    expect(updated.labels).toEqual(["scheduler", "cli"]);
    expect(updated.acceptance_criteria).toEqual(["new acceptance"]);
    expect(updated.dependencies).toEqual(["WI-upstream"]);
    expect(updated.planning.risk).toBe("high");
    expect(updated.planning.preferred_lane).toBe("cockpit");
    expect(updated.planning.split_status).toBe("done");
  });

  it("removes a work item and cascades linked tasks when requested", () => {
    const item = createWorkItem(cockpitDir, {
      title: "Removable work item",
      repoTargets: ["cockpit"],
    });
    const task = createTask(cockpitDir, {
      workItemId: item.id,
      title: "Linked task",
      repo: "cockpit",
    });
    recordStatusConflict({
      cockpitDir,
      workItemId: item.id,
      sourceRef: "jira-main",
      localValue: "in_progress",
      externalValue: "backlog",
    });

    const removed = removeWorkItem(cockpitDir, item.id, { cascadeTasks: true });

    expect(removed.id).toBe(item.id);
    expect(removeWorkItem.bind(null, cockpitDir, item.id)).toThrowError;
    expect(getTask(cockpitDir, task.id)).toBeNull();
    expect(listPendingSyncConflicts(cockpitDir)).toHaveLength(0);
  });
});
