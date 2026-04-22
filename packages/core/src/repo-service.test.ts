import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
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
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], repoRoot);
  return repoRoot;
}

async function createWorkspace(): Promise<{ root: string; cockpitDir: string; docsRoot: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-repos-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    workspaceName: "repo-test",
    mode: "embedded",
    repos: [{ id: "cockpit", path: root, default_branch: "main", enabled: true }],
  });
  const docsRoot = await createGitRepo(root, "docs");
  return { root, cockpitDir: path.join(root, ".cockpit"), docsRoot };
}

describe("repo-service", () => {
  let root: string;
  let cockpitDir: string;
  let docsRoot: string;

  beforeEach(async () => {
    ({ root, cockpitDir, docsRoot } = await createWorkspace());
  });

  it("adds and updates repos with normalized paths", () => {
    const added = addRepo(cockpitDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
      role: "docs",
    });
    const item = createWorkItem(cockpitDir, {
      title: "Docs pipeline",
      repoTargets: ["docs"],
    });
    const task = createTask(cockpitDir, {
      workItemId: item.id,
      title: "Publish docs",
      repo: "docs",
    });
    const agentsFile = readAgentsFile(cockpitDir);
    agentsFile.agents[0]!.allowed_repos = ["docs"];
    writeAgentsFile(cockpitDir, agentsFile);

    expect(added.path).toBe(docsRoot);
    expect(listRepos(cockpitDir)).toHaveLength(2);

    const updated = updateRepo(cockpitDir, "docs", {
      id: "docs-site",
      role: "website",
      defaultBranch: "release",
      enabled: false,
    });

    expect(updated.id).toBe("docs-site");
    expect(updated.role).toBe("website");
    expect(updated.default_branch).toBe("release");
    expect(updated.enabled).toBe(false);
    expect(getRepo(cockpitDir, "docs")).toBeNull();
    expect(getRepo(cockpitDir, "docs-site")?.path).toBe(docsRoot);
    expect(getTask(cockpitDir, task.id)?.repo).toBe("docs-site");
    expect(getWorkItem(cockpitDir, item.id)?.repo_targets).toEqual(["docs-site"]);
    expect(readAgentsFile(cockpitDir).agents[0]?.allowed_repos).toEqual(["docs-site"]);
  });

  it("refuses removal while the repo is still referenced unless forced", () => {
    addRepo(cockpitDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
    });
    const item = createWorkItem(cockpitDir, {
      title: "Docs refresh",
      repoTargets: ["docs"],
    });
    createTask(cockpitDir, {
      workItemId: item.id,
      title: "Update docs task",
      repo: "docs",
    });

    expect(() => removeRepo(cockpitDir, "docs")).toThrowError(/Re-run with --force/);
  });

  it("force-removes repos and cleans linked tasks, work items, and agent scopes", () => {
    addRepo(cockpitDir, {
      id: "docs",
      path: "./docs",
      defaultBranch: "main",
    });

    const item = createWorkItem(cockpitDir, {
      title: "Docs refresh",
      repoTargets: ["docs", "cockpit"],
    });
    const removedTask = createTask(cockpitDir, {
      workItemId: item.id,
      title: "Write docs",
      repo: "docs",
    });
    const dependentTask = createTask(cockpitDir, {
      workItemId: item.id,
      title: "Wire docs links",
      repo: "cockpit",
      dependsOn: [removedTask.id],
    });

    const agentsFile = readAgentsFile(cockpitDir);
    agentsFile.agents[0]!.allowed_repos = ["cockpit", "docs"];
    writeAgentsFile(cockpitDir, agentsFile);

    const removed = removeRepo(cockpitDir, "docs", { force: true });

    expect(removed.id).toBe("docs");
    expect(getRepo(cockpitDir, "docs")).toBeNull();
    expect(getTask(cockpitDir, removedTask.id)).toBeNull();
    expect(getTask(cockpitDir, dependentTask.id)?.depends_on).toEqual([]);
    expect(getWorkItem(cockpitDir, item.id)?.repo_targets).toEqual(["cockpit"]);
    expect(readAgentsFile(cockpitDir).agents[0]?.allowed_repos).toEqual(["cockpit"]);
  });
});
