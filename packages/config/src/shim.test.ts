import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { pickLocalShimProjectRoot, writeLocalShim } from "./shim.js";

function createWorkspace(): { backlogDir: string; projectRoot: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-shim-"));
  const backlogDir = path.join(projectRoot, ".backlog");
  fs.mkdirSync(backlogDir);
  return { backlogDir, projectRoot };
}

describe("writeLocalShim", () => {
  it("creates an executable shim at <backlogDir>/bin/backlog", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const shimPath = writeLocalShim(backlogDir, projectRoot);

    expect(shimPath).toBe(path.join(backlogDir, "bin", "backlog"));
    expect(fs.existsSync(shimPath)).toBe(true);
    const mode = fs.statSync(shimPath).mode & 0o777;
    expect(mode & 0o111).not.toBe(0);
  });

  it("prefers the local dev-tree build before installed binaries", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const shimPath = writeLocalShim(backlogDir, projectRoot);
    const contents = fs.readFileSync(shimPath, "utf8");

    const workspaceBinIdx = contents.indexOf("WORKSPACE_BIN=");
    const pathIdx = contents.indexOf("command -v backlog");
    const localBinIdx = contents.indexOf('"$HOME/.local/bin/backlog"');
    expect(workspaceBinIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeGreaterThan(-1);
    expect(localBinIdx).toBeGreaterThan(-1);
    expect(workspaceBinIdx).toBeLessThan(pathIdx);
    expect(pathIdx).toBeLessThan(localBinIdx);
  });

  it("supports a BACKLOG_DEV_BIN override", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain("BACKLOG_DEV_BIN");
    expect(contents).toContain('exec "$BACKLOG_DEV_BIN"');
  });

  it("falls back to <workspace>/dist/backlog for the dev-tree case", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain(`WORKSPACE_BIN="${projectRoot}/dist/backlog"`);
  });

  it("execs the binary directly — no package manager or runtime at hook time", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).not.toMatch(/\bexec\s+(pnpm|npm|npx|tsx|node|bun)\b/);
  });

  it("emits a clear install hint on failure", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain("install.sh");
    expect(contents).toContain("BACKLOG_DEV_BIN");
    expect(contents).toContain("exit 1");
  });
});

describe("pickLocalShimProjectRoot", () => {
  it("uses a configured repo root when it is a built backlog source tree", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-project-"));
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-source-"));
    fs.mkdirSync(path.join(repoRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "package.json"), JSON.stringify({ name: "backlog" }), "utf8");
    fs.writeFileSync(path.join(repoRoot, "dist", "backlog"), "", "utf8");

    expect(pickLocalShimProjectRoot(projectRoot, [repoRoot])).toBe(repoRoot);
  });

  it("falls back to the project root when no repo is a backlog source tree", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-project-"));
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "other-source-"));

    expect(pickLocalShimProjectRoot(projectRoot, [repoRoot])).toBe(projectRoot);
  });
});
