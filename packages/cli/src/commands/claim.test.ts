import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { createClaim } from "@backlog/claims";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { afterEach, describe, expect, it } from "bun:test";
import { registerClaimCommand } from "./claim.js";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function makeGitProject(fileName = "file.txt"): { root: string; backlogDir: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claim-cli-")));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, fileName), "hello\n", "utf8");
  execFileSync("git", ["add", fileName], { cwd: root, stdio: "ignore" });
  const { backlogDir } = initLayout({
    root,
    projectName: "claim-cli-test",
    repos: [{ id: "repo", path: root, default_branch: "main", enabled: true }],
  });
  const config = loadConfig(backlogDir);
  config.claims.auto_claim_on_commit = false;
  saveConfig(backlogDir, config);
  process.chdir(root);
  return { root, backlogDir };
}

async function runClaimCheck(): Promise<void> {
  const program = new Command();
  program.name("test").exitOverride();
  registerClaimCommand(program);
  await program.parseAsync(["node", "test", "claim", "check", "--staged", "--auto"], { from: "node" });
}

describe("claim check", () => {
  it("allows staged commits when no active Backlog claim overlaps them", async () => {
    makeGitProject();

    await expect(runClaimCheck()).resolves.toBeUndefined();
  });

  it("blocks staged commits only when an active Backlog claim protects the file", async () => {
    const { root, backlogDir } = makeGitProject("protected.txt");
    createClaim({
      backlogDir,
      repo: "repo",
      repoPath: root,
      topic: "agent run",
      paths: ["protected.txt"],
      mode: "exclusive",
      ttlMinutes: 30,
    });

    await expect(runClaimCheck()).rejects.toThrow(/Backlog active claim protects staged paths/);
  });
});
