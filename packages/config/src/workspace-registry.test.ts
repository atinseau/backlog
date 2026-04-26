import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "./init-layout.js";
import {
  getRegistryPath,
  listRegisteredWorkspaces,
  loadRegistry,
  registerWorkspace,
  saveRegistry,
  touchWorkspace,
  unregisterWorkspace,
} from "./workspace-registry.js";

function tmpRegistryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-registry-"));
}

function makeWorkspace(name = "demo"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-ws-${name}-`));
  initLayout({ root, workspaceName: name });
  return root;
}

describe("loadRegistry / saveRegistry", () => {
  it("returns an empty registry when the file is missing", () => {
    const dir = tmpRegistryDir();
    const registry = loadRegistry({ dir });
    expect(registry).toEqual({ version: 1, workspaces: [] });
  });

  it("round-trips a registry through save+load", () => {
    const dir = tmpRegistryDir();
    saveRegistry(
      {
        version: 1,
        workspaces: [
          {
            id: "WS-aaaaaaaa",
            path: "/tmp/x",
            name: "x",
            added_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { dir },
    );
    const reloaded = loadRegistry({ dir });
    expect(reloaded.workspaces).toHaveLength(1);
    expect(reloaded.workspaces[0]!.id).toBe("WS-aaaaaaaa");
  });

  it("creates the registry directory if missing on save", () => {
    const dir = path.join(tmpRegistryDir(), "nested", "dir");
    saveRegistry({ version: 1, workspaces: [] }, { dir });
    expect(fs.existsSync(getRegistryPath({ dir }))).toBe(true);
  });
});

describe("registerWorkspace", () => {
  it("registers a workspace with its id, name, and path", () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace("alpha");
    const entry = registerWorkspace({ workspaceRoot: ws }, { dir });
    expect(entry.id).toMatch(/^WS-[0-9a-f]{8}$/);
    expect(entry.name).toBe("alpha");
    expect(entry.path).toBe(ws);
    expect(entry.added_at).toEqual(entry.last_opened_at);
  });

  it("dedupes by workspace id (re-register updates the entry)", () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace("alpha");
    const first = registerWorkspace({ workspaceRoot: ws }, { dir });
    const second = registerWorkspace({ workspaceRoot: ws }, { dir });
    expect(second.id).toBe(first.id);
    const entries = listRegisteredWorkspaces({ dir });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.added_at).toBe(first.added_at);
  });

  it("dedupes by path (re-init at the same path replaces the old entry)", () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace("alpha");
    registerWorkspace({ workspaceRoot: ws }, { dir });
    fs.rmSync(path.join(ws, ".backlog"), { recursive: true, force: true });
    initLayout({ root: ws, workspaceName: "beta" });
    const second = registerWorkspace({ workspaceRoot: ws }, { dir });
    const entries = listRegisteredWorkspaces({ dir });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(second.id);
    expect(entries[0]!.name).toBe("beta");
  });

  it("rejects a path without a .backlog directory", () => {
    const dir = tmpRegistryDir();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-empty-"));
    expect(() => registerWorkspace({ workspaceRoot: empty }, { dir })).toThrow(/No \.backlog/);
  });
});

describe("unregisterWorkspace", () => {
  it("removes by id", () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace();
    const entry = registerWorkspace({ workspaceRoot: ws }, { dir });
    expect(unregisterWorkspace(entry.id, { dir })?.id).toBe(entry.id);
    expect(listRegisteredWorkspaces({ dir })).toHaveLength(0);
  });

  it("removes by path", () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace();
    const entry = registerWorkspace({ workspaceRoot: ws }, { dir });
    expect(unregisterWorkspace(ws, { dir })?.id).toBe(entry.id);
    expect(listRegisteredWorkspaces({ dir })).toHaveLength(0);
  });

  it("returns null when nothing matches", () => {
    const dir = tmpRegistryDir();
    expect(unregisterWorkspace("WS-deadbeef", { dir })).toBeNull();
  });
});

describe("touchWorkspace", () => {
  it("updates last_opened_at", async () => {
    const dir = tmpRegistryDir();
    const ws = makeWorkspace();
    const entry = registerWorkspace({ workspaceRoot: ws }, { dir });
    const original = entry.last_opened_at!;
    await new Promise((r) => setTimeout(r, 5));
    touchWorkspace(entry.id, { dir });
    const after = listRegisteredWorkspaces({ dir })[0]!;
    expect(after.last_opened_at).not.toBe(original);
    expect(new Date(after.last_opened_at!).getTime()).toBeGreaterThan(new Date(original).getTime());
  });

  it("is a no-op for an unknown id", () => {
    const dir = tmpRegistryDir();
    expect(() => touchWorkspace("WS-unknownx", { dir })).not.toThrow();
    expect(listRegisteredWorkspaces({ dir })).toHaveLength(0);
  });
});
