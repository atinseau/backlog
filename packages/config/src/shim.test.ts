import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeLocalShim } from "./shim.js";

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

  it("resolves backlog from PATH first, then ~/.npm-global/bin", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const shimPath = writeLocalShim(backlogDir, projectRoot);
    const contents = fs.readFileSync(shimPath, "utf8");

    const pathIdx = contents.indexOf("command -v backlog");
    const npmGlobalIdx = contents.indexOf('"$HOME/.npm-global/bin/backlog"');
    expect(pathIdx).toBeGreaterThan(-1);
    expect(npmGlobalIdx).toBeGreaterThan(-1);
    expect(pathIdx).toBeLessThan(npmGlobalIdx);
  });

  it("supports a BACKLOG_DEV_DIST override", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain("BACKLOG_DEV_DIST");
    expect(contents).toContain('exec node "$BACKLOG_DEV_DIST"');
  });

  it("falls back to <workspace>/packages/cli/dist/bin.js for the dev-tree case", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain(`WORKSPACE_DIST="${projectRoot}/packages/cli/dist/bin.js"`);
  });

  it("no longer invokes pnpm or tsx at runtime", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).not.toMatch(/\bexec\s+pnpm\b/);
    expect(contents).not.toMatch(/\bpnpm\s+(exec|--dir|run)\b/);
    expect(contents).not.toMatch(/\bexec\s+tsx\b/);
  });

  it("emits a clear install hint instead of a pnpm error on failure", () => {
    const { backlogDir, projectRoot } = createWorkspace();
    const contents = fs.readFileSync(writeLocalShim(backlogDir, projectRoot), "utf8");

    expect(contents).toContain("npm install -g backlog");
    expect(contents).toContain("BACKLOG_DEV_DIST");
    expect(contents).toContain("exit 1");
  });
});
