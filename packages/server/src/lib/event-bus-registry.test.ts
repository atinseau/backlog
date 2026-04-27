import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureWorkspaceId, initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import type { ServerWorkspace } from "../workspace-context.js";
import { EventBusRegistry } from "./event-bus-registry.js";

function makeWorkspace(name = "demo"): ServerWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-bus-${name}-`));
  initLayout({ root, workspaceName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    workspace_id: ensureWorkspaceId(backlogDir),
    resolvedFrom: root,
  };
}

describe("EventBusRegistry", () => {
  it("returns the same EventBus for repeated lookups of the same workspace", () => {
    const registry = new EventBusRegistry();
    const ws = makeWorkspace();
    const a = registry.get(ws);
    const b = registry.get(ws);
    expect(a).toBe(b);
    expect(registry.has(ws.workspace_id)).toBe(true);
    registry.stopAll();
  });

  it("creates separate buses for different workspaces", () => {
    const registry = new EventBusRegistry();
    const ws1 = makeWorkspace("alpha");
    const ws2 = makeWorkspace("beta");
    expect(registry.get(ws1)).not.toBe(registry.get(ws2));
    expect(registry.has(ws1.workspace_id)).toBe(true);
    expect(registry.has(ws2.workspace_id)).toBe(true);
    registry.stopAll();
  });

  it("stopAll() drops all known buses", () => {
    const registry = new EventBusRegistry();
    const ws = makeWorkspace();
    registry.get(ws);
    expect(registry.has(ws.workspace_id)).toBe(true);
    registry.stopAll();
    expect(registry.has(ws.workspace_id)).toBe(false);
  });
});
