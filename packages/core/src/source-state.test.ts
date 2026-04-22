import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import type { WorkItem } from "@cockpit-ai/schemas";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";
import { addSource, getSource, removeSource, setSourceEnabled, updateSource, upsertImportedWorkItems } from "./source-state.js";
import {
  hasPendingSyncConflictsForWorkItem,
  listPendingSyncConflicts,
  listPendingSyncConflictsForWorkItem,
  resolveSyncConflict,
  resolveSyncConflictsForWorkItem,
} from "./sync-conflicts.js";

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
  it("can enable, disable, and update configured sources", () => {
    const cockpitDir = createWorkspace();

    addSource(cockpitDir, {
      id: "notes",
      kind: "markdown",
      enabled: true,
      config: {
        path: "backlog.md",
      },
      auth: {
        strategy: "none",
        refs: {},
      },
      mapping: {},
      sync: {
        pull: true,
        push_status: false,
        push_comments: false,
        source_of_truth: "external",
      },
    });

    expect(getSource(cockpitDir, "notes")?.enabled).toBe(true);
    setSourceEnabled(cockpitDir, "notes", false);
    expect(getSource(cockpitDir, "notes")?.enabled).toBe(false);

    const updated = updateSource(cockpitDir, "notes", {
      enabled: true,
      config: {
        path: "docs/backlog.md",
      },
      authStrategy: "env",
      authRefs: {
        token: "NOTES_TOKEN",
      },
      mapping: {
        title: "title",
      },
      pull: true,
      pushStatus: true,
      pushComments: true,
      sourceOfTruth: "cockpit",
    });

    expect(updated.enabled).toBe(true);
    expect(updated.config).toEqual({ path: "docs/backlog.md" });
    expect(updated.auth.strategy).toBe("env");
    expect(updated.auth.refs).toEqual({ token: "NOTES_TOKEN" });
    expect(updated.mapping).toEqual({ title: "title" });
    expect(updated.sync).toEqual({
      pull: true,
      push_status: true,
      push_comments: true,
      source_of_truth: "cockpit",
    });
  });

  it("removes a source and unlinks work items when forced", () => {
    const cockpitDir = createWorkspace();
    addSource(cockpitDir, {
      id: "sheet",
      kind: "csv",
      enabled: true,
      config: { path: "sheet.csv" },
      auth: { strategy: "none", refs: {} },
      mapping: {},
      sync: {
        pull: true,
        push_status: false,
        push_comments: false,
        source_of_truth: "external",
      },
    });
    upsertImportedWorkItems(cockpitDir, [importedItem("row-remove")]);

    expect(() => removeSource(cockpitDir, "sheet")).toThrow(/still linked/);
    const removed = removeSource(cockpitDir, "sheet", { force: true });

    expect(removed.id).toBe("sheet");
    expect(getSource(cockpitDir, "sheet")).toBeNull();
    expect(readWorkItemsFile(cockpitDir).items[0]?.source_links).toEqual([]);
  });

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

  it("can list and resolve all pending conflicts for one work item", () => {
    const cockpitDir = createWorkspace();
    const base = importedItem("row-3");
    upsertImportedWorkItems(cockpitDir, [base]);

    const file = readWorkItemsFile(cockpitDir);
    file.items[0]!.status = "review";
    writeWorkItemsFile(cockpitDir, file);

    upsertImportedWorkItems(cockpitDir, [{ ...base, status: "backlog" }]);

    expect(hasPendingSyncConflictsForWorkItem(cockpitDir, base.id)).toBe(true);
    expect(listPendingSyncConflictsForWorkItem(cockpitDir, base.id)).toHaveLength(1);

    const resolved = resolveSyncConflictsForWorkItem(cockpitDir, base.id, "local");
    expect(resolved).toHaveLength(1);
    expect(hasPendingSyncConflictsForWorkItem(cockpitDir, base.id)).toBe(false);
  });
});
