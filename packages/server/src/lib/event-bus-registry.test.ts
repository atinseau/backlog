import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { describe, expect, it } from "bun:test";
import type { ServerProject } from "../project-context.js";
import { EventBusRegistry } from "./event-bus-registry.js";

function makeWorkspace(name = "demo"): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-bus-${name}-`));
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
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
    expect(registry.has(ws.project_id)).toBe(true);
    registry.stopAll();
  });

  it("creates separate buses for different workspaces", () => {
    const registry = new EventBusRegistry();
    const ws1 = makeWorkspace("alpha");
    const ws2 = makeWorkspace("beta");
    expect(registry.get(ws1)).not.toBe(registry.get(ws2));
    expect(registry.has(ws1.project_id)).toBe(true);
    expect(registry.has(ws2.project_id)).toBe(true);
    registry.stopAll();
  });

  it("stopAll() drops all known buses", () => {
    const registry = new EventBusRegistry();
    const ws = makeWorkspace();
    registry.get(ws);
    expect(registry.has(ws.project_id)).toBe(true);
    registry.stopAll();
    expect(registry.has(ws.project_id)).toBe(false);
  });
});
