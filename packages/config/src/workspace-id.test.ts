import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { describe, expect, it } from "vitest";
import { initLayout } from "./init-layout.js";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";
import { ensureWorkspaceId, generateWorkspaceId } from "./workspace-id.js";

function createWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-wsid-"));
}

describe("generateWorkspaceId", () => {
  it("returns a WS-prefixed 8-hex id", () => {
    expect(generateWorkspaceId()).toMatch(/^WS-[0-9a-f]{8}$/);
  });

  it("returns distinct ids on subsequent calls", () => {
    const a = generateWorkspaceId();
    const b = generateWorkspaceId();
    expect(a).not.toBe(b);
  });
});

describe("initLayout", () => {
  it("writes a workspace_id into the new config.toml", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, workspaceName: "demo" });
    const config = loadConfig(path.join(root, ".backlog"));
    expect(config.workspace_id).toMatch(/^WS-[0-9a-f]{8}$/);
  });
});

describe("ensureWorkspaceId", () => {
  it("returns the existing id without rewriting the file", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, workspaceName: "demo" });
    const backlogDir = path.join(root, ".backlog");
    const configPath = path.join(backlogDir, "config.toml");

    const before = loadConfig(backlogDir).workspace_id!;
    const mtimeBefore = fs.statSync(configPath).mtimeMs;

    expect(ensureWorkspaceId(backlogDir)).toBe(before);
    expect(fs.statSync(configPath).mtimeMs).toBe(mtimeBefore);
  });

  it("backfills and persists when workspace_id is missing", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, workspaceName: "legacy" });
    const backlogDir = path.join(root, ".backlog");

    // Simulate a pre-workspace_id config by stripping the field.
    const config = loadConfig(backlogDir);
    delete config.workspace_id;
    saveConfig(backlogDir, config);
    expect(loadConfig(backlogDir).workspace_id).toBeUndefined();

    const id = ensureWorkspaceId(backlogDir);
    expect(id).toMatch(/^WS-[0-9a-f]{8}$/);
    expect(loadConfig(backlogDir).workspace_id).toBe(id);
  });

  it("is idempotent across repeated calls", () => {
    const root = createWorkspaceRoot();
    initLayout({ root, workspaceName: "legacy" });
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    delete config.workspace_id;
    saveConfig(backlogDir, config);

    const first = ensureWorkspaceId(backlogDir);
    const second = ensureWorkspaceId(backlogDir);
    const third = ensureWorkspaceId(backlogDir);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("preserves all other config fields when backfilling", () => {
    const root = createWorkspaceRoot();
    initLayout({
      root,
      workspaceName: "demo",
      mode: "control_plane",
      maxAgents: 5,
      defaultBranch: "trunk",
    });
    const backlogDir = path.join(root, ".backlog");
    const configPath = path.join(backlogDir, "config.toml");

    // Strip workspace_id by hand-editing the TOML.
    const raw = TOML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    delete raw.workspace_id;
    fs.writeFileSync(configPath, TOML.stringify(raw as TOML.JsonMap), "utf8");

    ensureWorkspaceId(backlogDir);
    const after = loadConfig(backlogDir);
    expect(after.workspace_name).toBe("demo");
    expect(after.workspace_mode).toBe("control_plane");
    expect(after.max_agents).toBe(5);
    expect(after.default_branch).toBe("trunk");
  });
});
