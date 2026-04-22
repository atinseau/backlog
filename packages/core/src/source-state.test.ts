import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import type { WorkItem } from "@cockpit-ai/schemas";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";
import { upsertImportedWorkItems } from "./source-state.js";
import { listPendingSyncConflicts, resolveSyncConflict } from "./sync-conflicts.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-source-"));
  initLayout({
    root,
    workspaceName: "source-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return path.join(root, ".cockpit");
}

function importedItem(title: string): WorkItem {
  const now = new Date().toISOString();
  return {
    id: `WI-${title}`,
    title,
    source_links: [{ kind: "csv", source_ref: "sheet", external_id: title }],
    status: "backlog",
    priority: "P2",
    labels: [],
    repo_targets: [],
    acceptance_criteria: [],
    dependencies: [],
    planning: { split_status: "pending", risk: "medium" },
    sync: { source_of_truth: "external", push_status: false, push_comments: false },
    created_at: now,
    updated_at: now,
  };
}

describe("upsertImportedWorkItems", () => {
  it("creates and updates imported work items by source identity", () => {
    const cockpitDir = createWorkspace();
    upsertImportedWorkItems(cockpitDir, [importedItem("row-1")]);
    upsertImportedWorkItems(cockpitDir, [{ ...importedItem("row-1"), title: "updated-title" }]);

    const file = readWorkItemsFile(cockpitDir);
    expect(file.items).toHaveLength(1);
    expect(file.items[0]?.title).toBe("updated-title");
  });

  it("records a sync conflict when external status differs from local status", () => {
    const cockpitDir = createWorkspace();
    const base = importedItem("row-2");
    upsertImportedWorkItems(cockpitDir, [base]);
    const file = readWorkItemsFile(cockpitDir);
    file.items[0]!.status = "in_progress";
    writeWorkItemsFile(cockpitDir, file);

    upsertImportedWorkItems(cockpitDir, [{ ...base, status: "backlog" }]);
    const conflicts = listPendingSyncConflicts(cockpitDir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.local_value).toBe("in_progress");
    expect(conflicts[0]?.external_value).toBe("backlog");

    resolveSyncConflict(cockpitDir, conflicts[0]!.id, "external");
    const updated = readWorkItemsFile(cockpitDir);
    expect(updated.items[0]?.status).toBe("backlog");
  });
});
