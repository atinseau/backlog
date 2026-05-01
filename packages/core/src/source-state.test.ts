import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import type { Task } from "@backlog/schemas";
import { readTasksFile, writeTasksFile } from "./state-files.js";
import { addSource, getSource, removeSource, setSourceEnabled, updateSource, upsertImportedTasks } from "./source-state.js";
import {
  hasPendingSyncConflictsForTask,
  listPendingSyncConflicts,
  listPendingSyncConflictsForTask,
  resolveSyncConflict,
  resolveSyncConflictsForTask,
} from "./sync-conflicts.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-source-"));
  initLayout({
    root,
    projectName: "source-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return path.join(root, ".backlog");
}

function importedItem(title: string): Task {
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
    execution_defaults: { manual_approval_required: false, auto_commit: true, push_when_done: true, create_pr: false, merge_pr: false, worktree_mode: "isolated_worktree", preferred_agents: [] },
    sync: { source_of_truth: "external", push_status: false, push_comments: false },
    created_at: now,
    updated_at: now,
  };
}

describe("upsertImportedTasks", () => {
  it("can enable, disable, and update configured sources", () => {
    const backlogDir = createWorkspace();

    addSource(backlogDir, {
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

    expect(getSource(backlogDir, "notes")?.enabled).toBe(true);
    setSourceEnabled(backlogDir, "notes", false);
    expect(getSource(backlogDir, "notes")?.enabled).toBe(false);

    const updated = updateSource(backlogDir, "notes", {
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
      sourceOfTruth: "backlog",
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
      source_of_truth: "backlog",
    });
  });

  it("removes a source and unlinks tasks when forced", () => {
    const backlogDir = createWorkspace();
    addSource(backlogDir, {
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
    upsertImportedTasks(backlogDir, [importedItem("row-remove")]);

    expect(() => removeSource(backlogDir, "sheet")).toThrow(/still linked/);
    const removed = removeSource(backlogDir, "sheet", { force: true });

    expect(removed.id).toBe("sheet");
    expect(getSource(backlogDir, "sheet")).toBeNull();
    expect(readTasksFile(backlogDir).tasks[0]?.source_links).toEqual([]);
  });

  it("creates and updates imported tasks by source identity", () => {
    const backlogDir = createWorkspace();
    upsertImportedTasks(backlogDir, [importedItem("row-1")]);
    upsertImportedTasks(backlogDir, [{ ...importedItem("row-1"), title: "updated-title" }]);

    const file = readTasksFile(backlogDir);
    expect(file.tasks).toHaveLength(1);
    expect(file.tasks[0]?.title).toBe("updated-title");
  });

  it("records a sync conflict when external status differs from local status", () => {
    const backlogDir = createWorkspace();
    const base = importedItem("row-2");
    upsertImportedTasks(backlogDir, [base]);
    const file = readTasksFile(backlogDir);
    file.tasks[0]!.status = "in_progress";
    writeTasksFile(backlogDir, file);

    upsertImportedTasks(backlogDir, [{ ...base, status: "backlog" }]);
    const conflicts = listPendingSyncConflicts(backlogDir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.local_value).toBe("in_progress");
    expect(conflicts[0]?.external_value).toBe("backlog");

    resolveSyncConflict(backlogDir, conflicts[0]!.id, "external");
    const updated = readTasksFile(backlogDir);
    expect(updated.tasks[0]?.status).toBe("backlog");
  });

  it("can list and resolve all pending conflicts for one task", () => {
    const backlogDir = createWorkspace();
    const base = importedItem("row-3");
    upsertImportedTasks(backlogDir, [base]);

    const file = readTasksFile(backlogDir);
    file.tasks[0]!.status = "review";
    writeTasksFile(backlogDir, file);

    upsertImportedTasks(backlogDir, [{ ...base, status: "backlog" }]);

    expect(hasPendingSyncConflictsForTask(backlogDir, base.id)).toBe(true);
    expect(listPendingSyncConflictsForTask(backlogDir, base.id)).toHaveLength(1);

    const resolved = resolveSyncConflictsForTask(backlogDir, base.id, "local");
    expect(resolved).toHaveLength(1);
    expect(hasPendingSyncConflictsForTask(backlogDir, base.id)).toBe(false);
  });
});
