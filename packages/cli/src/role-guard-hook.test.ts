import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { createClaim } from "@backlog/claims";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { installPreCommitHook } from "@backlog/hooks";

// The whole point of this file: the CLI's execution-role refusal must not reach
// the pre-commit hook. The hook's failure path *allows* the commit when Backlog
// looks unavailable, so a badly shaped exemption would not merely block
// commits — it would silently turn claim enforcement off. Nothing short of a
// real `git commit` proves which of the two happened, so this test spawns one.
//
// It lives in packages/cli rather than packages/hooks because it needs the real
// CLI behind the hook, and cli → hooks is the legal direction.

// Resolved from this test file, which is never inside the compiled binary —
// the ban on import.meta paths is about runtime code, and there is no other way
// for a spawned shell script to find the CLI entrypoint.
const CLI_ENTRY = path.join(import.meta.dir, "bin.ts");

interface Fixture {
  root: string;
  backlogDir: string;
  /** Sandboxed environment for every child process the test spawns. */
  env: NodeJS.ProcessEnv;
}

function git(root: string, args: string[], env?: NodeJS.ProcessEnv): { status: number; output: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: env ?? process.env });
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * A git repository with a Backlog project, the managed pre-commit hook, and a
 * BACKLOG_BIN that runs this CLI from source — the compiled binary does not
 * exist in a test run, and the hook needs something executable.
 */
function makeRepoWithHook(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-role-hook-")));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-role-home-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Backlog Test"]);
  git(root, ["config", "user.email", "test@backlog.local"]);

  const { backlogDir } = initLayout({
    root,
    projectName: "role-guard-hook-test",
    repos: [{ id: "repo", path: root, default_branch: "main", enabled: true }],
  });
  const config = loadConfig(backlogDir);
  config.claims.auto_claim_on_commit = false;
  saveConfig(backlogDir, config);

  const backlogBin = path.join(root, "backlog-bin.sh");
  fs.writeFileSync(
    backlogBin,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_ENTRY)} "$@"\n`,
    "utf8",
  );
  fs.chmodSync(backlogBin, 0o755);
  installPreCommitHook({ gitDir: path.join(root, ".git"), backlogBin, projectRoot: root });

  return {
    root,
    backlogDir,
    env: { ...process.env, HOME: home, BACKLOG_AGENT_ROLE: "execution" },
  };
}

function stage(root: string, file: string): void {
  fs.writeFileSync(path.join(root, file), "hello\n", "utf8");
  git(root, ["add", file]);
}

describe("the pre-commit hook under BACKLOG_AGENT_ROLE=execution", () => {
  it("still blocks a commit that touches a claimed path", () => {
    const { root, backlogDir, env } = makeRepoWithHook();
    createClaim({
      backlogDir,
      repo: "repo",
      repoPath: root,
      topic: "another agent's run",
      paths: ["protected.txt"],
      mode: "exclusive",
      ttlMinutes: 30,
    });
    stage(root, "protected.txt");

    const commit = git(root, ["commit", "-m", "touch a claimed path"], env);

    expect(commit.status).not.toBe(0);
    expect(commit.output).toContain("Backlog pre-commit hook blocked this commit.");
    expect(commit.output).toContain("protected by active claim");
    // The two failure shapes this test exists to tell apart: a refusal instead
    // of a claim check, and the hook waving the commit through.
    expect(commit.output).not.toContain("unavailable to an execution agent");
    expect(commit.output).not.toContain("Backlog did not block this commit");
  }, 30_000);

  it("lets an unclaimed path through", () => {
    const { root, env } = makeRepoWithHook();
    stage(root, "free.txt");

    const commit = git(root, ["commit", "-m", "touch a free path"], env);

    expect(commit.output).not.toContain("unavailable to an execution agent");
    expect(commit.status).toBe(0);
  }, 30_000);

  it("refuses the same binary, in the same environment, without the hook's marker", () => {
    const { root, env } = makeRepoWithHook();

    const direct = spawnSync(
      path.join(root, "backlog-bin.sh"),
      ["claim", "check", "--repo-root", root, "--staged", "--auto"],
      { cwd: root, encoding: "utf8", env },
    );

    expect(direct.status).toBe(1);
    expect(`${direct.stderr}`).toContain("unavailable to an execution agent");
    // stdout is the MCP protocol channel — the refusal never goes there.
    expect(direct.stdout).toBe("");
  }, 30_000);
});
