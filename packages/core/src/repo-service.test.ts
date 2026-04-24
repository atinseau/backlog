import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { readAgentsFile, writeAgentsFile } from "./agents.js";
import { addRepo, getRepo, listRepos, removeRepo, updateRepo } from "./repo-service.js";
import { createTask, getTask } from "./task-service.js";
import { createWorkItem, getWorkItem } from "./work-service.js";

async function createGitRepo(root: string, name: string): Promise<string> {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(repoRoot, { recursive: true });
  await git(["init", "-b", "main"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${name}\n`, "utf8");
  await git(["add", "README.md"], repoRoot);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], repoRoot);
  return repoRoot;
}

async function createWorkspace(): Promise<{ root: string; backlogDir: string; docsRoot: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-repos-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    workspaceName: "repo-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  const docsRoot = await createGitRepo(root, "docs");
  return { root, backlogDir: path.join(root, ".backlog"), docsRoot };
}

describe("repo-service", () => {
  let root: string;
  let backlogDir: string;
  let docsRoot: string;

  beforeEach(async () => {
    ({ root, backlogDir, docsRoot } = await createWorkspace());
  });

  it("adds and updates repos with normalized paths", () => {
    const added = addRepo(backlogDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
      role: "docs",
    });
    const item = createWorkItem(backlogDir, {
      title: "Docs pipeline",
      repoTargets: ["docs"],
    });
    const task = createTask(backlogDir, {
      workItemId: item.id,
      title: "Publish docs",
      repo: "docs",
    });
    const agentsFile = readAgentsFile(backlogDir);
    agentsFile.agents[0]!.allowed_repos = ["docs"];
    writeAgentsFile(backlogDir, agentsFile);

    expect(added.path).toBe(docsRoot);
    expect(listRepos(backlogDir)).toHaveLength(2);

    const updated = updateRepo(backlogDir, "docs", {
      id: "docs-site",
      role: "website",
      defaultBranch: "release",
      enabled: false,
    });

    expect(updated.id).toBe("docs-site");
    expect(updated.role).toBe("website");
    expect(updated.default_branch).toBe("release");
    expect(updated.enabled).toBe(false);
    expect(getRepo(backlogDir, "docs")).toBeNull();
    expect(getRepo(backlogDir, "docs-site")?.path).toBe(docsRoot);
    expect(getTask(backlogDir, task.id)?.repo).toBe("docs-site");
    expect(getWorkItem(backlogDir, item.id)?.repo_targets).toEqual(["docs-site"]);
    expect(readAgentsFile(backlogDir).agents[0]?.allowed_repos).toEqual(["docs-site"]);
  });

  it("refuses removal while the repo is still referenced unless forced", () => {
    addRepo(backlogDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
    });
    const item = createWorkItem(backlogDir, {
      title: "Docs refresh",
      repoTargets: ["docs"],
    });
    createTask(backlogDir, {
      workItemId: item.id,
      title: "Update docs task",
      repo: "docs",
    });

    expect(() => removeRepo(backlogDir, "docs")).toThrowError(/Re-run with --force/);
  });

  it("force-removes repos and cleans linked tasks, work items, and agent scopes", () => {
    addRepo(backlogDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
    });

    const item = createWorkItem(backlogDir, {
      title: "Docs refresh",
      repoTargets: ["docs", "backlog"],
    });
    const removedTask = createTask(backlogDir, {
      workItemId: item.id,
      title: "Write docs",
      repo: "docs",
    });
    const dependentTask = createTask(backlogDir, {
      workItemId: item.id,
      title: "Wire docs links",
      repo: "backlog",
      dependsOn: [removedTask.id],
    });

    const agentsFile = readAgentsFile(backlogDir);
    agentsFile.agents[0]!.allowed_repos = ["backlog", "docs"];
    writeAgentsFile(backlogDir, agentsFile);

    const removed = removeRepo(backlogDir, "docs", { force: true });

    expect(removed.id).toBe("docs");
    expect(getRepo(backlogDir, "docs")).toBeNull();
    expect(getTask(backlogDir, removedTask.id)).toBeNull();
    expect(getTask(backlogDir, dependentTask.id)?.depends_on).toEqual([]);
    expect(getWorkItem(backlogDir, item.id)?.repo_targets).toEqual(["backlog"]);
    expect(readAgentsFile(backlogDir).agents[0]?.allowed_repos).toEqual(["backlog"]);
  });
});
