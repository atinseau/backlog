import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "./init-layout.js";
import { loadConfig } from "./load-config.js";
import {
  migrateProjectToInRepo,
  migrateProjectToUserLevel,
  rollbackProjectMigration,
} from "./migrate-project.js";
import { listRegisteredProjects, registerProject } from "./project-registry.js";

function realTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// userLevelProjectDir() consults os.homedir() to locate ~/.backlog/<slug>/.
// We point HOME at a sandbox so the migration can't touch the real
// ~/.backlog/. Save/restore so tests don't leak.
let savedHome: string | undefined;
let fakeHome: string;
let registryDir: string;

beforeEach(() => {
  savedHome = process.env.HOME;
  fakeHome = realTmp("backlog-migrate-home-");
  process.env.HOME = fakeHome;
  registryDir = realTmp("backlog-migrate-reg-");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

function makeInRepoWorkspace(name: string, opts: { repos?: number } = {}): { root: string } {
  const root = realTmp(`backlog-mi-inrepo-${name}-`);
  const repos = Array.from({ length: opts.repos ?? 1 }, (_, i) => {
    const repoPath = realTmp(`backlog-mi-repo-${name}-${i}-`);
    return { id: `repo-${name}-${i}`, path: repoPath, default_branch: "main", enabled: true };
  });
  initLayout({ root, projectName: name, repos });
  registerProject({ projectRoot: root }, { dir: registryDir });
  return { root };
}

describe("migrateProjectToUserLevel", () => {
  it("copies the workspace to ~/.backlog/<slug>/, updates config + registry, and archives the old dir", () => {
    const { root } = makeInRepoWorkspace("alpha", { repos: 2 });

    const result = migrateProjectToUserLevel({
      identifier: "alpha",
      registryOptions: { dir: registryDir },
    });

    expect(result.newRoot).toBe(path.join(fakeHome, ".backlog", "alpha"));
    expect(result.newBacklogDir).toBe(result.newRoot);
    expect(fs.existsSync(path.join(result.newRoot, "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(result.newRoot, "tasks.yaml"))).toBe(true);

    const newConfig = loadConfig(result.newRoot);
    expect(newConfig.project_location).toBe("user_level");
    expect(newConfig.project_name).toBe("alpha");

    const updatedEntry = listRegisteredProjects({ dir: registryDir }).find((p) => p.id === result.entry.id);
    expect(updatedEntry?.location).toBe("user_level");
    expect(updatedEntry?.path).toBe(result.newRoot);

    expect(result.archivedAt).toBe(`${path.join(root, ".backlog")}.migrated-${new Date().toISOString().slice(0, 10)}`);
    expect(fs.existsSync(result.archivedAt!)).toBe(true);
    expect(fs.existsSync(path.join(root, ".backlog"))).toBe(false);

    expect(result.reposToReinstallHooksOn).toHaveLength(2);
  });

  it("renames the project when --name is passed (slug + project_name follow)", () => {
    makeInRepoWorkspace("oldname");

    const result = migrateProjectToUserLevel({
      identifier: "oldname",
      newName: "Brand New",
      registryOptions: { dir: registryDir },
    });

    expect(result.newRoot).toBe(path.join(fakeHome, ".backlog", "brand-new"));
    expect(loadConfig(result.newRoot).project_name).toBe("Brand New");
    expect(result.entry.name).toBe("Brand New");
  });

  it("blocks the migration when another user_level project already has the target name", () => {
    // Existing user_level project with name "shared".
    const existingUserLevelRoot = path.join(fakeHome, ".backlog", "shared");
    initLayout({ root: existingUserLevelRoot, projectName: "shared", location: "user_level" });
    registerProject({ projectRoot: existingUserLevelRoot, location: "user_level" }, { dir: registryDir });

    // New in_repo project also called "shared" trying to migrate.
    makeInRepoWorkspace("shared-2");

    expect(() =>
      migrateProjectToUserLevel({
        identifier: "shared-2",
        newName: "shared",
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/already exists/);
  });

  it("rejects a project that's already user_level", () => {
    const existing = path.join(fakeHome, ".backlog", "already");
    initLayout({ root: existing, projectName: "already", location: "user_level" });
    registerProject({ projectRoot: existing, location: "user_level" }, { dir: registryDir });

    expect(() =>
      migrateProjectToUserLevel({ identifier: "already", registryOptions: { dir: registryDir } }),
    ).toThrowError(/already at location=user_level/);
  });

  it("rejects an unknown identifier", () => {
    expect(() =>
      migrateProjectToUserLevel({ identifier: "no-such-thing", registryOptions: { dir: registryDir } }),
    ).toThrowError(/No registered project matching/);
  });

  it("--keep-old leaves the source .backlog/ intact and skips the rename", () => {
    const { root } = makeInRepoWorkspace("staystay");
    const oldBacklogDir = path.join(root, ".backlog");
    expect(fs.existsSync(oldBacklogDir)).toBe(true);

    const result = migrateProjectToUserLevel({
      identifier: "staystay",
      keepOld: true,
      registryOptions: { dir: registryDir },
    });

    expect(result.archivedAt).toBeUndefined();
    expect(fs.existsSync(oldBacklogDir)).toBe(true); // still there
    expect(fs.existsSync(path.join(result.newRoot, "config.toml"))).toBe(true);
  });

  it("refuses if the target ~/.backlog/<slug>/ already has a project", () => {
    // Pre-create an unrelated project at ~/.backlog/clash/.
    const collidingDir = path.join(fakeHome, ".backlog", "clash");
    initLayout({ root: collidingDir, projectName: "unrelated", location: "user_level" });

    makeInRepoWorkspace("clash");

    expect(() =>
      migrateProjectToUserLevel({ identifier: "clash", registryOptions: { dir: registryDir } }),
    ).toThrowError(/already has a Backlog project/);
  });
});

describe("migrateProjectToInRepo", () => {
  function makeUserLevelWorkspaceWithRepos(name: string, repoCount = 2): { workspaceDir: string; repos: { id: string; path: string }[] } {
    const workspaceDir = path.join(fakeHome, ".backlog", name);
    const repos = Array.from({ length: repoCount }, (_, i) => {
      const repoPath = realTmp(`backlog-mi-targetrepo-${name}-${i}-`);
      return { id: `target-${name}-${i}`, path: repoPath, default_branch: "main", enabled: true };
    });
    initLayout({ root: workspaceDir, projectName: name, location: "user_level", repos });
    registerProject({ projectRoot: workspaceDir, location: "user_level" }, { dir: registryDir });
    return { workspaceDir, repos };
  }

  it("copies the workspace into <repo>/.backlog/, updates config + registry, archives the old user_level dir", () => {
    const { workspaceDir, repos } = makeUserLevelWorkspaceWithRepos("ulvl");

    const result = migrateProjectToInRepo({
      identifier: "ulvl",
      intoRepoId: repos[0]!.id,
      registryOptions: { dir: registryDir },
    });

    expect(result.newRoot).toBe(repos[0]!.path);
    expect(result.newBacklogDir).toBe(path.join(repos[0]!.path, ".backlog"));
    expect(fs.existsSync(path.join(result.newBacklogDir, "config.toml"))).toBe(true);
    expect(loadConfig(result.newBacklogDir).project_location).toBe("in_repo");

    const updatedEntry = listRegisteredProjects({ dir: registryDir }).find((p) => p.id === result.entry.id);
    expect(updatedEntry?.location).toBe("in_repo");
    expect(updatedEntry?.path).toBe(repos[0]!.path);

    expect(result.archivedAt).toContain(`${workspaceDir}.migrated-`);
    expect(fs.existsSync(result.archivedAt!)).toBe(true);
    expect(fs.existsSync(workspaceDir)).toBe(false);
  });

  it("rejects an in_repo project (already there)", () => {
    const { root } = makeInRepoWorkspace("plain");
    expect(() =>
      migrateProjectToInRepo({
        identifier: "plain",
        intoRepoId: "anything",
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/already at location=in_repo/);
    void root;
  });

  it("rejects an unknown --into <repo-id>", () => {
    makeUserLevelWorkspaceWithRepos("badtarget");

    expect(() =>
      migrateProjectToInRepo({
        identifier: "badtarget",
        intoRepoId: "does-not-exist",
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/Unknown repo: does-not-exist/);
  });

  it("refuses if the target repo already has a .backlog/ dir", () => {
    const { repos } = makeUserLevelWorkspaceWithRepos("clash-inrepo");
    fs.mkdirSync(path.join(repos[0]!.path, ".backlog"));

    expect(() =>
      migrateProjectToInRepo({
        identifier: "clash-inrepo",
        intoRepoId: repos[0]!.id,
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/already exists/);
  });
});

describe("rollbackProjectMigration", () => {
  it("restores an in_repo→user_level migration: workspace returns to <root>/.backlog/, registry follows", () => {
    const { root } = makeInRepoWorkspace("undo-inrepo", { repos: 2 });

    const migrate = migrateProjectToUserLevel({
      identifier: "undo-inrepo",
      registryOptions: { dir: registryDir },
    });
    // Sanity: archived dir exists.
    expect(fs.existsSync(migrate.archivedAt!)).toBe(true);

    const result = rollbackProjectMigration({
      identifier: "undo-inrepo",
      registryOptions: { dir: registryDir },
    });

    expect(result.restoredBacklogDir).toBe(path.join(root, ".backlog"));
    expect(result.restoredRoot).toBe(root);
    expect(result.entry.location).toBe("in_repo");
    expect(fs.existsSync(path.join(root, ".backlog", "config.toml"))).toBe(true);

    // The user_level dir that was the migration target should be gone.
    expect(fs.existsSync(migrate.newRoot)).toBe(false);

    const updated = listRegisteredProjects({ dir: registryDir }).find((p) => p.id === result.entry.id);
    expect(updated?.location).toBe("in_repo");
    expect(updated?.path).toBe(root);
  });

  it("restores a user_level→in_repo migration: workspace returns to ~/.backlog/<slug>/", () => {
    // Build a user-level workspace, migrate it to in_repo, then roll back.
    const userRoot = path.join(fakeHome, ".backlog", "undo-userlevel");
    const repoPath = realTmp("backlog-mi-roundtrip-repo-");
    initLayout({
      root: userRoot,
      projectName: "undo-userlevel",
      location: "user_level",
      repos: [{ id: "the-repo", path: repoPath, default_branch: "main", enabled: true }],
    });
    registerProject({ projectRoot: userRoot, location: "user_level" }, { dir: registryDir });

    migrateProjectToInRepo({
      identifier: "undo-userlevel",
      intoRepoId: "the-repo",
      registryOptions: { dir: registryDir },
    });

    const result = rollbackProjectMigration({
      identifier: "undo-userlevel",
      registryOptions: { dir: registryDir },
    });

    expect(result.restoredBacklogDir).toBe(userRoot);
    expect(result.entry.location).toBe("user_level");
    expect(fs.existsSync(path.join(userRoot, "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(repoPath, ".backlog"))).toBe(false);
  });

  it("--keep-current renames the current workspace instead of deleting it", () => {
    const { root } = makeInRepoWorkspace("undo-keep");
    migrateProjectToUserLevel({ identifier: "undo-keep", registryOptions: { dir: registryDir } });

    const result = rollbackProjectMigration({
      identifier: "undo-keep",
      keepCurrent: true,
      registryOptions: { dir: registryDir },
    });

    expect(result.rolledBackTo).toMatch(/\.rolled-back-\d{4}-\d{2}-\d{2}$/);
    expect(fs.existsSync(result.rolledBackTo!)).toBe(true);
    expect(fs.existsSync(path.join(root, ".backlog"))).toBe(true);
  });

  it("rejects when no .migrated archive exists (nothing to roll back to)", () => {
    const { root } = makeInRepoWorkspace("nothing-to-undo");
    void root;
    expect(() =>
      rollbackProjectMigration({
        identifier: "nothing-to-undo",
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/no migration history to roll back/);
  });

  it("rejects when destination already exists", () => {
    const { root } = makeInRepoWorkspace("clash-restore");
    migrateProjectToUserLevel({ identifier: "clash-restore", registryOptions: { dir: registryDir } });
    // Pollute the original spot so rollback can't restore.
    fs.mkdirSync(path.join(root, ".backlog"));

    expect(() =>
      rollbackProjectMigration({
        identifier: "clash-restore",
        registryOptions: { dir: registryDir },
      }),
    ).toThrowError(/already exists/);
  });

  it("uses --archive-path when explicitly given", () => {
    const { root } = makeInRepoWorkspace("explicit-archive");
    const migrate = migrateProjectToUserLevel({
      identifier: "explicit-archive",
      registryOptions: { dir: registryDir },
    });

    const result = rollbackProjectMigration({
      identifier: "explicit-archive",
      archivePath: migrate.archivedAt!,
      registryOptions: { dir: registryDir },
    });

    expect(result.restoredFrom).toBe(migrate.archivedAt);
    expect(fs.existsSync(path.join(root, ".backlog", "config.toml"))).toBe(true);
  });
});
