import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { initLayout } from "@backlog/config";
import { installPreCommitHook } from "@backlog/hooks";
import { afterEach, describe, expect, it } from "bun:test";
import { registerDoctorCommand } from "./doctor.js";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function makeGitProject(): { root: string; backlogDir: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-doctor-cli-")));
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  const { backlogDir } = initLayout({
    root,
    projectName: "doctor-cli-test",
    repos: [{ id: "repo", path: root, default_branch: "main", enabled: true }],
  });
  process.chdir(root);
  return { root, backlogDir };
}

function installHook(root: string, backlogDir: string): string {
  return installPreCommitHook({
    gitDir: path.join(root, ".git"),
    backlogBin: path.join(backlogDir, "bin", "backlog"),
    projectRoot: root,
    backlogDir,
    force: true,
  });
}

interface DoctorPayload {
  warnings: string[];
  repos: Array<{ id: string; hook?: { managed: boolean; upToDate: boolean } }>;
}

/** Runs `doctor --json` and returns the payload it printed. */
async function runDoctor(): Promise<DoctorPayload> {
  const program = new Command();
  program.name("test").exitOverride();
  registerDoctorCommand(program);
  const printed: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
  try {
    await program.parseAsync(["node", "test", "doctor", "--json"], { from: "node" });
  } finally {
    console.log = original;
  }
  return JSON.parse(printed.join("\n")) as DoctorPayload;
}

describe("backlog doctor", () => {
  it("reports a freshly installed hook as up to date", async () => {
    const { root, backlogDir } = makeGitProject();
    installHook(root, backlogDir);

    const payload = await runDoctor();

    expect(payload.repos[0]?.hook).toMatchObject({ managed: true, upToDate: true });
    expect(payload.warnings).not.toContain("hook_outdated:repo");
  });

  // The hook carries a version and nothing refreshes it on upgrade. A
  // version-2 hook execs the new binary, gets the execution-role refusal,
  // matches none of its "Backlog is unavailable" patterns and blocks every
  // agent commit — and doctor is what a user runs after upgrading. Without the
  // `expected` argument, `inspectPreCommitHook` cannot compute `upToDate` at
  // all and this reads as a healthy managed hook.
  it("warns about a hook left behind by an earlier version", async () => {
    const { root, backlogDir } = makeGitProject();
    const hookPath = installHook(root, backlogDir);
    const stale = fs
      .readFileSync(hookPath, "utf8")
      .replace("Backlog hook version: 3", "Backlog hook version: 2")
      .replace("export BACKLOG_HOOK_INVOCATION=1\n", "");
    fs.writeFileSync(hookPath, stale, "utf8");

    const payload = await runDoctor();

    expect(payload.repos[0]?.hook).toMatchObject({ managed: true, upToDate: false });
    expect(payload.warnings).toContain("hook_outdated:repo");
  });
});
