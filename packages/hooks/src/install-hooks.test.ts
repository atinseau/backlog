import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPreCommitHook, installPreCommitHook, uninstallPreCommitHook } from "./install-hooks.js";

function createGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-hooks-"));
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(path.join(gitDir, "hooks"), { recursive: true });
  return gitDir;
}

describe("inspectPreCommitHook", () => {
  it("reports a missing hook cleanly", () => {
    const gitDir = createGitDir();
    expect(inspectPreCommitHook(gitDir)).toEqual({
      hookPath: path.join(gitDir, "hooks", "pre-commit"),
      exists: false,
      managed: false,
      pointsToBacklogBin: false,
    });
  });

  it("detects a managed hook and its configured backlog bin", () => {
    const gitDir = createGitDir();
    const backlogBin = "/tmp/backlog/bin/backlog";
    installPreCommitHook({
      gitDir,
      backlogBin,
    });

    expect(inspectPreCommitHook(gitDir, backlogBin)).toMatchObject({
      exists: true,
      managed: true,
      backlogBin,
      pointsToBacklogBin: true,
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
    });
  });

  it("lets uninstall remove a managed hook", () => {
    const gitDir = createGitDir();
    installPreCommitHook({
      gitDir,
      backlogBin: "/tmp/backlog/bin/backlog",
    });

    expect(uninstallPreCommitHook(gitDir)).toBe(true);
    expect(inspectPreCommitHook(gitDir).exists).toBe(false);
  });
});
