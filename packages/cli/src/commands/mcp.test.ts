import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { agentToolNames, orchestratorToolNames } from "@backlog/core";
import { mcpHostFor, parseAudience, resolveMcpHost } from "./mcp.js";

function projectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-mcp-cmd-"));
  initLayout({
    root,
    projectName: "mcp-command-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

describe("mcpHostFor", () => {
  it("serves only the agent tool set to an execution agent", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "agent");

    expect(host.tools.map((tool) => tool.name)).toEqual(agentToolNames());
  });

  it("serves the orchestrator tool set to the chat", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "orchestrator");

    expect(host.tools.map((tool) => tool.name)).toEqual(orchestratorToolNames());
  });

  it("never advertises an orchestration tool to an execution agent", () => {
    const advertised = new Set(mcpHostFor("/tmp/project/.backlog", "agent").tools.map((tool) => tool.name));

    for (const name of orchestratorToolNames()) {
      expect(advertised.has(name)).toBe(false);
    }
  });
});

describe("parseAudience", () => {
  it("defaults to the least privileged set", () => {
    expect(parseAudience(undefined)).toBe("agent");
  });

  it("accepts both audiences", () => {
    expect(parseAudience("agent")).toBe("agent");
    expect(parseAudience("orchestrator")).toBe("orchestrator");
  });

  it("rejects anything else rather than falling back to a privileged default", () => {
    expect(() => parseAudience("admin")).toThrow(/agent|orchestrator/);
  });
});

// parseAudience and mcpHostFor only ever meet inside the command's action. A
// regression that hardcoded the orchestrator host there passes every test
// above, so assert the wiring itself.
describe("resolveMcpHost", () => {
  // findProject honours BACKLOG_PROJECT_DIR, and the suite shares one process.
  let savedProjectDir: string | undefined;
  beforeEach(() => {
    savedProjectDir = process.env.BACKLOG_PROJECT_DIR;
    delete process.env.BACKLOG_PROJECT_DIR;
  });
  afterEach(() => {
    if (savedProjectDir === undefined) delete process.env.BACKLOG_PROJECT_DIR;
    else process.env.BACKLOG_PROJECT_DIR = savedProjectDir;
  });

  it("serves the agent set when no audience is asked for", () => {
    const root = projectRoot();

    const host = resolveMcpHost({ project: root });

    expect(host.tools.map((tool) => tool.name)).toEqual(agentToolNames());
  });

  it("serves the orchestrator set when the chat asks for it", () => {
    const root = projectRoot();

    const host = resolveMcpHost({ project: root, audience: "orchestrator" });

    expect(host.tools.map((tool) => tool.name)).toEqual(orchestratorToolNames());
  });

  it("prints nothing: stdout is the MCP protocol channel", () => {
    const root = projectRoot();
    const written: unknown[][] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void written.push(args);

    try {
      resolveMcpHost({ project: root });
    } finally {
      console.log = log;
    }

    expect(written).toEqual([]);
  });

  it("refuses an unknown audience rather than defaulting to a privileged one", () => {
    const root = projectRoot();

    expect(() => resolveMcpHost({ project: root, audience: "admin" })).toThrow(/agent|orchestrator/);
  });

  it("says so when the path is not a project, instead of serving an empty one", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-mcp-empty-"));

    expect(() => resolveMcpHost({ project: empty })).toThrow(/No \.backlog project/);
  });
});
