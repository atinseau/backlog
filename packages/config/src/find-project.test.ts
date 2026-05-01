import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearFindProjectCache, findProject } from "./find-project.js";
import { initLayout } from "./init-layout.js";
import { registerProject } from "./project-registry.js";

beforeEach(() => {
  clearFindProjectCache();
});

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

describe("findProject", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.BACKLOG_PROJECT_DIR;
    delete process.env.BACKLOG_PROJECT_DIR;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BACKLOG_PROJECT_DIR;
    else process.env.BACKLOG_PROJECT_DIR = savedEnv;
  });

  it("walks up to find an in_repo .backlog/", () => {
    const root = tmp("backlog-fp-inrepo-");
    initLayout({ root, projectName: "demo" });
    const inner = path.join(root, "src", "deep");
    fs.mkdirSync(inner, { recursive: true });
    const found = findProject(inner, { skipRegistry: true });
    expect(found).not.toBeNull();
    expect(found!.root).toBe(root);
    expect(found!.backlogDir).toBe(path.join(root, ".backlog"));
  });

  it("returns null when no .backlog/ is found and no registry match", () => {
    const lonely = tmp("backlog-fp-lonely-");
    const registryDir = tmp("backlog-fp-empty-reg-");
    const found = findProject(lonely, { registryOptions: { dir: registryDir } });
    expect(found).toBeNull();
  });

  it("falls back to a user_level workspace via registry when cwd is inside one of its repos", () => {
    const registryDir = tmp("backlog-fp-reg-");
    const userWorkspace = tmp("backlog-fp-userlevel-ws-");
    const repoA = tmp("backlog-fp-repoA-");
    fs.mkdirSync(path.join(repoA, "subdir"), { recursive: true });

    initLayout({
      root: userWorkspace,
      projectName: "multi",
      location: "user_level",
      repos: [{ id: "a", path: repoA, default_branch: "main", enabled: true }],
    });
    registerProject(
      { projectRoot: userWorkspace, location: "user_level" },
      { dir: registryDir },
    );

    const found = findProject(path.join(repoA, "subdir"), { registryOptions: { dir: registryDir } });
    expect(found).not.toBeNull();
    expect(found!.root).toBe(userWorkspace);
    expect(found!.backlogDir).toBe(userWorkspace);
  });

  it("honours BACKLOG_PROJECT_DIR for an in_repo workspace", () => {
    const root = tmp("backlog-fp-env-inrepo-");
    initLayout({ root, projectName: "env-demo" });
    process.env.BACKLOG_PROJECT_DIR = root;

    // Call from an unrelated cwd to force the env var path.
    const elsewhere = tmp("backlog-fp-elsewhere-");
    const found = findProject(elsewhere);
    expect(found!.root).toBe(root);
    expect(found!.backlogDir).toBe(path.join(root, ".backlog"));
  });

  it("honours BACKLOG_PROJECT_DIR for a user_level workspace", () => {
    const userWorkspace = tmp("backlog-fp-env-userlevel-");
    initLayout({ root: userWorkspace, projectName: "env-multi", location: "user_level" });
    process.env.BACKLOG_PROJECT_DIR = userWorkspace;

    const elsewhere = tmp("backlog-fp-elsewhere2-");
    const found = findProject(elsewhere);
    expect(found!.root).toBe(userWorkspace);
    expect(found!.backlogDir).toBe(userWorkspace);
  });

  it("can ignore BACKLOG_PROJECT_DIR when the caller supplies an explicit project", () => {
    const envRoot = tmp("backlog-fp-env-explicit-");
    initLayout({ root: envRoot, projectName: "env-demo" });
    const explicitRoot = tmp("backlog-fp-explicit-");
    initLayout({ root: explicitRoot, projectName: "explicit-demo" });
    process.env.BACKLOG_PROJECT_DIR = envRoot;

    const found = findProject(explicitRoot, { honorEnv: false });
    expect(found!.root).toBe(explicitRoot);
    expect(found!.backlogDir).toBe(path.join(explicitRoot, ".backlog"));
  });

  it("returns null from the registry fallback when cwd doesn't match any repo", () => {
    const registryDir = tmp("backlog-fp-reg-nomatch-");
    const userWorkspace = tmp("backlog-fp-userlevel-nomatch-");
    const repoA = tmp("backlog-fp-other-repo-");
    initLayout({
      root: userWorkspace,
      projectName: "other-multi",
      location: "user_level",
      repos: [{ id: "a", path: repoA, default_branch: "main", enabled: true }],
    });
    registerProject({ projectRoot: userWorkspace, location: "user_level" }, { dir: registryDir });

    const unrelated = tmp("backlog-fp-stranger-");
    const found = findProject(unrelated, { registryOptions: { dir: registryDir } });
    expect(found).toBeNull();
  });

  it("matches when cwd is the COMMON PARENT of multiple configured repos (multi-repo project layout)", () => {
    const registryDir = tmp("backlog-fp-parent-");
    const userWorkspace = tmp("backlog-fp-parent-ws-");
    // Two sibling repos under a shared parent dir — typical for a
    // multi-repo project (e.g. ~/Dev/backlog/{backlog-cli,backlog-cloud}).
    const projectParent = tmp("backlog-fp-parent-projects-");
    const repoA = path.join(projectParent, "a");
    const repoB = path.join(projectParent, "b");
    fs.mkdirSync(repoA);
    fs.mkdirSync(repoB);

    initLayout({
      root: userWorkspace,
      projectName: "parent-multi",
      location: "user_level",
      repos: [
        { id: "a", path: repoA, default_branch: "main", enabled: true },
        { id: "b", path: repoB, default_branch: "main", enabled: true },
      ],
    });
    registerProject({ projectRoot: userWorkspace, location: "user_level" }, { dir: registryDir });

    // cwd is the parent — not inside any repo, but it's the common
    // parent of both. Should resolve.
    const found = findProject(projectParent, { registryOptions: { dir: registryDir } });
    expect(found).not.toBeNull();
    expect(found!.backlogDir).toBe(userWorkspace);
  });

  it("doesn't false-match when cwd is the parent of only ONE configured repo (could be coincidence)", () => {
    const registryDir = tmp("backlog-fp-parent-single-");
    const userWorkspace = tmp("backlog-fp-parent-single-ws-");
    const projectParent = tmp("backlog-fp-parent-single-parent-");
    const onlyRepo = path.join(projectParent, "only");
    fs.mkdirSync(onlyRepo);

    initLayout({
      root: userWorkspace,
      projectName: "single",
      location: "user_level",
      repos: [{ id: "only", path: onlyRepo, default_branch: "main", enabled: true }],
    });
    registerProject({ projectRoot: userWorkspace, location: "user_level" }, { dir: registryDir });

    // Single repo as a child isn't strong enough signal — cwd could
    // just happen to live next to one project's repo. Don't resolve.
    const found = findProject(projectParent, { registryOptions: { dir: registryDir } });
    expect(found).toBeNull();
  });

  it("caches the registry→repos mapping by file mtime: a registry edit invalidates the cache", () => {
    const registryDir = tmp("backlog-fp-cache-reg-");
    const userWorkspace = tmp("backlog-fp-cache-ws-");
    const repoA = tmp("backlog-fp-cache-repoA-");
    const repoB = tmp("backlog-fp-cache-repoB-");

    // Start with one repo configured.
    initLayout({
      root: userWorkspace,
      projectName: "cache-test",
      location: "user_level",
      repos: [{ id: "a", path: repoA, default_branch: "main", enabled: true }],
    });
    registerProject({ projectRoot: userWorkspace, location: "user_level" }, { dir: registryDir });

    // First call: cwd inside repoA matches.
    expect(
      findProject(repoA, { registryOptions: { dir: registryDir } })?.backlogDir,
    ).toBe(userWorkspace);

    // cwd inside repoB doesn't match yet — repoB isn't configured.
    expect(findProject(repoB, { registryOptions: { dir: registryDir } })).toBeNull();

    // Add repoB to the workspace's config and bump the registry mtime
    // (registerProject writes the registry; even re-registering the same
    // project mutates last_opened_at + bumps mtime).
    const config = JSON.parse(JSON.stringify({})) as Record<string, never>;
    void config;
    // Append repoB via a config rewrite — easier than driving repos add.
    const configPath = path.join(userWorkspace, "config.toml");
    const configToml = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      configToml + `\n[[repos]]\nid = "b"\npath = "${repoB}"\ndefault_branch = "main"\nenabled = true\n`,
      "utf8",
    );
    // Bump registry mtime so the cache is invalidated.
    const registryPath = path.join(registryDir, "projects.json");
    const now = Date.now() / 1000;
    fs.utimesSync(registryPath, now + 5, now + 5);

    // Now repoB resolves.
    expect(
      findProject(repoB, { registryOptions: { dir: registryDir } })?.backlogDir,
    ).toBe(userWorkspace);
  });
});
