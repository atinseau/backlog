import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import { foldersRoutes } from "./folders.js";

describe("GET /folders/list", () => {
  it("lists local folders with Git and Backlog markers", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-folders-parent-"));
    const repo = path.join(parent, "demo-repo");
    const project = path.join(parent, "demo-project");
    fs.mkdirSync(repo);
    fs.mkdirSync(project);
    execFileSync("git", ["init"], { cwd: repo });
    initLayout({ root: project, projectName: "Demo Project" });

    const app = foldersRoutes();
    const res = await app.request(`/folders/list?path=${encodeURIComponent(parent)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      entries: Array<{ name: string; is_git_repo: boolean; has_backlog_dir: boolean }>;
    };
    expect(body.path).toBe(parent);
    expect(body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "demo-repo", is_git_repo: true, has_backlog_dir: false }),
      expect.objectContaining({ name: "demo-project", is_git_repo: false, has_backlog_dir: true }),
    ]));
  });

  it("falls back to the nearest existing parent for a new path", async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-folders-parent-"));
    const app = foldersRoutes();
    const res = await app.request(`/folders/list?path=${encodeURIComponent(path.join(parent, "new-project"))}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(parent);
  });
});
