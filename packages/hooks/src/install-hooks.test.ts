import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
  clearPause,
  inspectPreCommitHook,
  installPreCommitHook,
  pauseFilePath,
  readPauseUntil,
  uninstallPreCommitHook,
  writePauseUntil,
} from "./install-hooks.js";

function createGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-hooks-"));
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(path.join(gitDir, "hooks"), { recursive: true });
  return gitDir;
}

function makeBacklogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-hooks-pause-"));
}

describe("inspectPreCommitHook", () => {
  it("reports a missing hook cleanly", () => {
    const gitDir = createGitDir();
    expect(inspectPreCommitHook(gitDir)).toEqual({
      hookPath: path.join(gitDir, "hooks", "pre-commit"),
      exists: false,
      managed: false,
      pointsToBacklogBin: false,
      upToDate: false,
    });
  });

  it("detects a managed hook and its configured backlog bin", () => {
    const gitDir = createGitDir();
    const backlogBin = "/tmp/backlog/bin/backlog";
    installPreCommitHook({
      gitDir,
      backlogBin,
      projectRoot: "/tmp/backlog",
    });

    expect(inspectPreCommitHook(gitDir, backlogBin)).toMatchObject({
      exists: true,
      managed: true,
      backlogBin,
      pointsToBacklogBin: true,
      upToDate: false,
    });
  });

  it("reports when a managed hook matches the current template", () => {
    const gitDir = createGitDir();
    const backlogBin = "/tmp/backlog/bin/backlog";
    const projectRoot = "/tmp/backlog";
    installPreCommitHook({
      gitDir,
      backlogBin,
      projectRoot,
    });

    expect(inspectPreCommitHook(gitDir, backlogBin, { projectRoot })).toMatchObject({
      exists: true,
      managed: true,
      pointsToBacklogBin: true,
      upToDate: true,
    });
  });

  it("reports an older managed hook as outdated", () => {
    const gitDir = createGitDir();
    const hookPath = path.join(gitDir, "hooks", "pre-commit");
    const backlogBin = "/tmp/backlog/bin/backlog";
    fs.writeFileSync(
      hookPath,
      `#!/usr/bin/env bash\n# Managed by Backlog\nBACKLOG_BIN="${backlogBin}"\n`,
      "utf8",
    );

    expect(inspectPreCommitHook(gitDir, backlogBin, { projectRoot: "/tmp/backlog" })).toMatchObject({
      exists: true,
      managed: true,
      pointsToBacklogBin: true,
      upToDate: false,
    });
  });

  it("distinguishes unmanaged hooks", () => {
    const gitDir = createGitDir();
    const hookPath = path.join(gitDir, "hooks", "pre-commit");
    fs.writeFileSync(hookPath, "#!/usr/bin/env bash\necho custom\n", "utf8");

    expect(inspectPreCommitHook(gitDir)).toMatchObject({
      exists: true,
      managed: false,
      pointsToBacklogBin: false,
      upToDate: false,
    });
  });

  it("lets uninstall remove a managed hook", () => {
    const gitDir = createGitDir();
    installPreCommitHook({
      gitDir,
      backlogBin: "/tmp/backlog/bin/backlog",
      projectRoot: "/tmp/backlog",
    });
    const hookContents = fs.readFileSync(path.join(gitDir, "hooks", "pre-commit"), "utf8");
    expect(hookContents).toContain('BACKLOG_WORKSPACE="/tmp/backlog"');
    expect(hookContents).toContain('export BACKLOG_PROJECT_DIR="$BACKLOG_WORKSPACE"');

    expect(uninstallPreCommitHook(gitDir)).toBe(true);
    expect(inspectPreCommitHook(gitDir).exists).toBe(false);
  });
});

describe("rendered hook template — escape hatches", () => {
  function rendered(): string {
    const gitDir = createGitDir();
    installPreCommitHook({
      gitDir,
      backlogBin: "/tmp/backlog/bin/backlog",
      projectRoot: "/tmp/backlog",
    });
    return fs.readFileSync(path.join(gitDir, "hooks", "pre-commit"), "utf8");
  }

  it("honors BACKLOG_SKIP_HOOK=1 with an early exit 0", () => {
    const hook = rendered();
    expect(hook).toContain('"${BACKLOG_SKIP_HOOK:-}" == "1"');
    expect(hook).toContain("BACKLOG_SKIP_HOOK=1");
    // The skip clause must precede the claim check so the bin doesn't even need to exist.
    expect(hook.indexOf("BACKLOG_SKIP_HOOK")).toBeLessThan(hook.indexOf("claim check"));
  });

  it("checks for a workspace-level pause file before failing", () => {
    const hook = rendered();
    expect(hook).toContain("PAUSE_FILE=");
    expect(hook).toContain("hook-paused-until");
    expect(hook).toContain("backlog hooks resume");
    expect(hook.indexOf("PAUSE_FILE")).toBeLessThan(hook.indexOf("claim check"));
  });

  it("cleans up an expired pause file in-place", () => {
    expect(rendered()).toContain('rm -f "$PAUSE_FILE"');
  });

  it("prints the three escape hatches when the claim check fails", () => {
    const hook = rendered();
    expect(hook).toContain("Backlog pre-commit hook blocked this commit.");
    expect(hook).toContain("BACKLOG_SKIP_HOOK=1 git commit");
    expect(hook).toContain("backlog hooks pause --minutes 30");
    expect(hook).toContain("backlog hooks disable");
    expect(hook).toContain("backlog hooks uninstall");
  });

  it("allows commits when the local Backlog runtime is unavailable", () => {
    const hook = rendered();
    expect(hook).toContain("Backlog is unavailable, so this commit is allowed.");
    expect(hook).toContain("env: node: No such file or directory");
    expect(hook.indexOf("Backlog is unavailable")).toBeLessThan(hook.indexOf("Backlog pre-commit hook blocked"));
  });
});

describe("pause file helpers", () => {
  it("pauseFilePath lives under the backlog directory", () => {
    expect(pauseFilePath("/tmp/some/.backlog")).toBe("/tmp/some/.backlog/hook-paused-until");
  });

  it("write + read round-trips the timestamp", () => {
    const dir = makeBacklogDir();
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    writePauseUntil(dir, until);
    expect(readPauseUntil(dir)).toBe(until);
  });

  it("readPauseUntil returns null when no file exists", () => {
    const dir = makeBacklogDir();
    expect(readPauseUntil(dir)).toBeNull();
  });

  it("clearPause removes the file and reports whether it existed", () => {
    const dir = makeBacklogDir();
    expect(clearPause(dir)).toBe(false);
    writePauseUntil(dir, new Date().toISOString());
    expect(clearPause(dir)).toBe(true);
    expect(clearPause(dir)).toBe(false);
  });
});
