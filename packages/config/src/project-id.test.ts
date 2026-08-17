import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { describe, expect, it } from "bun:test";
import { initLayout } from "./init-layout.js";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";
import { ensureProjectId, generateProjectId } from "./project-id.js";

function createWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-wsid-"));
}

describe("generateProjectId", () => {
  it("returns a WS-prefixed 8-hex id", () => {
    expect(generateProjectId()).toMatch(/^WS-[0-9a-f]{8}$/);
  });

  it("returns distinct ids on subsequent calls", () => {
    const a = generateProjectId();
    const b = generateProjectId();
    expect(a).not.toBe(b);
  });
});

describe("initLayout", () => {
  it("writes a project_id into the new config.toml", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, projectName: "demo" });
    const config = loadConfig(path.join(root, ".backlog"));
    expect(config.project_id).toMatch(/^WS-[0-9a-f]{8}$/);
  });
});

describe("ensureProjectId", () => {
  it("returns the existing id without rewriting the file", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, projectName: "demo" });
    const backlogDir = path.join(root, ".backlog");
    const configPath = path.join(backlogDir, "config.toml");

    const before = loadConfig(backlogDir).project_id!;
    const mtimeBefore = fs.statSync(configPath).mtimeMs;

    expect(ensureProjectId(backlogDir)).toBe(before);
    expect(fs.statSync(configPath).mtimeMs).toBe(mtimeBefore);
  });

  it("backfills and persists when project_id is missing", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, projectName: "legacy" });
    const backlogDir = path.join(root, ".backlog");

    // Simulate a pre-project_id config by stripping the field.
    const config = loadConfig(backlogDir);
    delete config.project_id;
    saveConfig(backlogDir, config);
    expect(loadConfig(backlogDir).project_id).toBeUndefined();

    const id = ensureProjectId(backlogDir);
    expect(id).toMatch(/^WS-[0-9a-f]{8}$/);
    expect(loadConfig(backlogDir).project_id).toBe(id);
  });

  it("is idempotent across repeated calls", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, projectName: "legacy" });
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    delete config.project_id;
    saveConfig(backlogDir, config);

    const first = ensureProjectId(backlogDir);
    const second = ensureProjectId(backlogDir);
    const third = ensureProjectId(backlogDir);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("preserves all other config fields when backfilling", () => {
    const root = createWorkspaceRoot();
    initLayout({
      root,
      projectName: "demo",
      mode: "control_plane",
      maxAgents: 5,
      defaultBranch: "trunk",
    });
    const backlogDir = path.join(root, ".backlog");
    const configPath = path.join(backlogDir, "config.toml");

    // Strip project_id by hand-editing the TOML.
    const raw = TOML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    delete raw.project_id;
    fs.writeFileSync(configPath, TOML.stringify(raw as TOML.JsonMap), "utf8");

    ensureProjectId(backlogDir);
    const after = loadConfig(backlogDir);
    expect(after.project_name).toBe("demo");
    expect(after.project_mode).toBe("control_plane");
    expect(after.max_agents).toBe(5);
    expect(after.default_branch).toBe("trunk");
  });
});
