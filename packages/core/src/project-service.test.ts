import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { git } from "@backlog/git";
import {
  archiveProject,
  createProject,
  getProject,
  removeProject,
  updateProject,
} from "./project-service.js";
import { createWorkItem, getWorkItem } from "./work-service.js";
import { listProjects, readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-project-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, workspaceName: "project-test", mode: "embedded" });
  const backlogDir = path.join(root, ".backlog");
  const config = loadConfig(backlogDir);
  config.repos.push(
    { id: "frontend", path: "frontend", default_branch: "main", enabled: true },
    { id: "api", path: "api", default_branch: "main", enabled: true },
  );
  saveConfig(backlogDir, config);
  return backlogDir;
}

describe("project-service", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  it("creates and lists a project", () => {
    const project = createProject(backlogDir, {
      slug: "twoody",
      name: "Twoody",
      description: "Multimodal product",
      color: "#7c3aed",
      repoIds: ["frontend", "api"],
      maxAgents: 5,
    });

    expect(project.id).toMatch(/^PROJ-/);
    expect(project.slug).toBe("twoody");
    expect(project.repo_ids).toEqual(["frontend", "api"]);
    expect(project.max_agents).toBe(5);
    expect(project.archived).toBe(false);

    const all = listProjects(backlogDir);
    expect(all).toHaveLength(1);
    expect(all[0]?.slug).toBe("twoody");
  });

  it("rejects duplicate slugs", () => {
    createProject(backlogDir, { slug: "demo", name: "Demo" });
    expect(() => createProject(backlogDir, { slug: "demo", name: "Demo 2" })).toThrowError(/already exists/);
  });

  it("rejects unknown repo ids", () => {
    expect(() =>
      createProject(backlogDir, { slug: "ghost", name: "Ghost", repoIds: ["unknown-repo"] }),
    ).toThrowError(/Unknown repo id/);
  });

  it("updates and archives a project", () => {
    const project = createProject(backlogDir, { slug: "demo", name: "Demo" });

    const updated = updateProject(backlogDir, project.slug, {
      name: "Demo Renamed",
      color: "#22c55e",
      repoIds: ["frontend"],
      maxAgents: 2,
    });
    expect(updated.name).toBe("Demo Renamed");
    expect(updated.color).toBe("#22c55e");
    expect(updated.repo_ids).toEqual(["frontend"]);
    expect(updated.max_agents).toBe(2);

    const archived = archiveProject(backlogDir, updated.id);
    expect(archived.archived).toBe(true);
  });

  it("clears project_id from work items on remove", () => {
    const project = createProject(backlogDir, { slug: "demo", name: "Demo" });
    const item = createWorkItem(backlogDir, { title: "Task A" });

    const file = readWorkItemsFile(backlogDir);
    const target = file.items.find((entry) => entry.id === item.id);
    if (!target) throw new Error("work item missing");
    target.project_id = project.id;
    writeWorkItemsFile(backlogDir, file);

    const reloaded = getWorkItem(backlogDir, item.id);
    expect(reloaded?.project_id).toBe(project.id);

    removeProject(backlogDir, project.id);

    const final = getWorkItem(backlogDir, item.id);
    expect(final?.project_id).toBeUndefined();
  });

  it("getProject works by id or slug", () => {
    const p = createProject(backlogDir, { slug: "demo", name: "Demo" });
    expect(getProject(backlogDir, "demo")?.id).toBe(p.id);
    expect(getProject(backlogDir, p.id)?.slug).toBe("demo");
    expect(getProject(backlogDir, "nope")).toBeNull();
  });

  it("rejects attaching a repo that already belongs to another project", () => {
    createProject(backlogDir, { slug: "alpha", name: "Alpha", repoIds: ["frontend"] });
    expect(() =>
      createProject(backlogDir, { slug: "beta", name: "Beta", repoIds: ["frontend", "api"] }),
    ).toThrowError(/already attached to project alpha/);
  });

  it("allows moving a repo via update on the original project", () => {
    const alpha = createProject(backlogDir, { slug: "alpha", name: "Alpha", repoIds: ["frontend", "api"] });
    updateProject(backlogDir, alpha.id, { repoIds: ["frontend"] });
    // api is now free, can attach to a new project
    const beta = createProject(backlogDir, { slug: "beta", name: "Beta", repoIds: ["api"] });
    expect(beta.repo_ids).toEqual(["api"]);
  });

  it("ignores archived projects when checking repo conflicts", () => {
    const alpha = createProject(backlogDir, { slug: "alpha", name: "Alpha", repoIds: ["frontend"] });
    archiveProject(backlogDir, alpha.id);
    // archived project no longer claims the repo
    const beta = createProject(backlogDir, { slug: "beta", name: "Beta", repoIds: ["frontend"] });
    expect(beta.repo_ids).toEqual(["frontend"]);
  });
});
