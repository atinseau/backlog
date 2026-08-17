import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "bun:test";
import { createClaim } from "@backlog/claims";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { installPreCommitHook } from "@backlog/hooks";
import { AGENT_ROLE_ENV, EXECUTION_ROLE } from "./role-guard.js";

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

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(root: string, args: string[], env: NodeJS.ProcessEnv): { status: number; output: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env });
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * The environment every child of this fixture gets. Sandboxed against the
 * developer's own git setup, which otherwise leaks in three ways: a global
 * `init.templateDir` installs its own pre-commit hook and makes the install
 * throw, `GIT_DIR` / `GIT_INDEX_FILE` point every `git` call at another
 * repository when the suite is itself run from inside one (`git rebase -x`, a
 * hook), and the system config can set either.
 */
function sandboxedEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    [AGENT_ROLE_ENV]: EXECUTION_ROLE,
  };
  delete env.GIT_DIR;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_WORK_TREE;
  delete env.XDG_CONFIG_HOME;
  return env;
}

/**
 * A git repository with a Backlog project, the managed pre-commit hook, and a
 * BACKLOG_BIN that runs this CLI from source — the compiled binary does not
 * exist in a test run, and the hook needs something executable.
 */
function makeRepoWithHook(): Fixture {
  const root = tempDir("backlog-role-hook-");
  const env = sandboxedEnv(tempDir("backlog-role-home-"));
  git(root, ["init", "-b", "main"], env);
  git(root, ["config", "user.name", "Backlog Test"], env);
  git(root, ["config", "user.email", "test@backlog.local"], env);

  const { backlogDir } = initLayout({
    root,
    projectName: "role-guard-hook-test",
    repos: [{ id: "repo", path: root, default_branch: "main", enabled: true }],
  });
  // Without this the hook mints an ad-hoc claim from the staged paths instead
  // of blocking, and the test that matters would assert nothing.
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
  // force: replace whatever a global init.templateDir may have dropped in.
  installPreCommitHook({ gitDir: path.join(root, ".git"), backlogBin, projectRoot: root, force: true });

  return { root, backlogDir, env };
}

function stage(fixture: Fixture, file: string): void {
  fs.writeFileSync(path.join(fixture.root, file), "hello\n", "utf8");
  git(fixture.root, ["add", file], fixture.env);
}

describe("the pre-commit hook under BACKLOG_AGENT_ROLE=execution", () => {
  it("still blocks a commit that touches a claimed path", () => {
    const fixture = makeRepoWithHook();
    const { root, backlogDir, env } = fixture;
    createClaim({
      backlogDir,
      repo: "repo",
      repoPath: root,
      topic: "another agent's run",
      paths: ["protected.txt"],
      mode: "exclusive",
      ttlMinutes: 30,
    });
    stage(fixture, "protected.txt");

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
    const fixture = makeRepoWithHook();
    stage(fixture, "free.txt");

    const commit = git(fixture.root, ["commit", "-m", "touch a free path"], fixture.env);

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
