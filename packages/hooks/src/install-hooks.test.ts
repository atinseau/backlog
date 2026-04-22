import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPreCommitHook, installPreCommitHook, uninstallPreCommitHook } from "./install-hooks.js";

function createGitDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-hooks-"));
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
      pointsToCockpitBin: false,
    });
  });

  it("detects a managed hook and its configured cockpit bin", () => {
    const gitDir = createGitDir();
    const cockpitBin = "/tmp/cockpit/bin/cockpit";
    installPreCommitHook({
      gitDir,
      cockpitBin,
    });

    expect(inspectPreCommitHook(gitDir, cockpitBin)).toMatchObject({
      exists: true,
      managed: true,
      cockpitBin,
      pointsToCockpitBin: true,
    });
  });

  it("distinguishes unmanaged hooks", () => {
    const gitDir = createGitDir();
    const hookPath = path.join(gitDir, "hooks", "pre-commit");
    fs.writeFileSync(hookPath, "#!/usr/bin/env bash\necho custom\n", "utf8");

    expect(inspectPreCommitHook(gitDir)).toMatchObject({
      exists: true,
      managed: false,
      pointsToCockpitBin: false,
    });
  });

  it("lets uninstall remove a managed hook", () => {
    const gitDir = createGitDir();
    installPreCommitHook({
      gitDir,
      cockpitBin: "/tmp/cockpit/bin/cockpit",
    });

    expect(uninstallPreCommitHook(gitDir)).toBe(true);
    expect(inspectPreCommitHook(gitDir).exists).toBe(false);
  });
});
