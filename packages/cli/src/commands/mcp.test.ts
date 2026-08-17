import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { initLayout } from "@backlog/config";
import { contextFor, createTask, orchestratorToolNames } from "@backlog/core";
import { EXECUTION_ROLE, EXEMPT_COMMAND } from "../role-guard.js";
import { mcpHostFor, parseAudience, registerMcpCommand, resolveMcpHost } from "./mcp.js";

const executionToolNames = [...contextFor("execution").mcpTools];

function projectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-mcp-cmd-"));
  initLayout({
    root,
    projectName: "mcp-command-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

/** A project with one ticket in it, for the tests that call a tool for real. */
function projectWithTask(): { backlogDir: string; taskId: string } {
  const root = projectRoot();
  const backlogDir = path.join(root, ".backlog");
  const task = createTask(backlogDir, { title: "Ship it", repoTargets: [path.basename(root)] });
  return { backlogDir, taskId: task.id };
}

describe("mcpHostFor", () => {
  it("serves only the execution tool set to an execution agent", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "execution");

    expect(host.tools.map((tool) => tool.name)).toEqual(executionToolNames);
  });

  it("serves the orchestrator tool set to the chat", () => {
    const host = mcpHostFor("/tmp/project/.backlog", "orchestrator");

    expect(host.tools.map((tool) => tool.name)).toEqual(orchestratorToolNames());
  });

  it("never advertises an orchestration tool to an execution agent", () => {
    const advertised = new Set(mcpHostFor("/tmp/project/.backlog", "execution").tools.map((tool) => tool.name));

    for (const name of orchestratorToolNames()) {
      expect(advertised.has(name)).toBe(false);
    }
  });

  // Omitting a tool from `tools` is a claim about what the host advertises; it
  // says nothing about what it will run. The whole security property of this
  // layer is the second one, so assert the call itself — with `confirmed: true`,
  // which is the one input that would let `start_subtask` act if it ever ran.
  it("refuses an orchestration call from an execution agent, not merely omits it", async () => {
    const host = mcpHostFor("/tmp/project/.backlog", "execution");

    const outcome = await host.callTool("start_subtask", { subtask_id: "sub_001", confirmed: true });

    expect(outcome.ok).toBe(false);
    expect(String((outcome.result as { error?: unknown }).error)).toContain("start_subtask");
  });

  // The refusal test above short-circuits at the name guard and never reaches
  // the dispatcher. `callCatalogTool` is now the only dispatch path in the
  // product — both audiences route through it — and it matches first-wins
  // across three tool lists, so a reordering or name-matching bug there would
  // break the chat and every coding run at once. These two exercise the
  // branches that matter: a read tool, and an orchestrator tool.
  it("routes an execution agent's read to the tool that owns it", async () => {
    const { backlogDir, taskId } = projectWithTask();
    const host = mcpHostFor(backlogDir, "execution");

    const outcome = await host.callTool("task_show", { task_id: taskId });

    expect(outcome.ok).toBe(true);
    expect((outcome.result as { task: { id: string } }).task.id).toBe(taskId);
  });

  it("routes the chat's read to the orchestrator dispatcher", async () => {
    const { backlogDir, taskId } = projectWithTask();
    const host = mcpHostFor(backlogDir, "orchestrator");

    const outcome = await host.callTool("list_tasks", { status: "all" });

    expect(outcome.ok).toBe(true);
    const result = outcome.result as { count: number; tasks: Array<{ id: string }> };
    expect(result.count).toBe(1);
    expect(result.tasks[0]?.id).toBe(taskId);
  });
});

describe("parseAudience", () => {
  it("defaults to the least privileged set", () => {
    expect(parseAudience(undefined)).toBe("execution");
  });

  it("accepts both audiences", () => {
    expect(parseAudience("execution")).toBe("execution");
    expect(parseAudience("orchestrator")).toBe("orchestrator");
  });

  it("rejects anything else rather than falling back to a privileged default", () => {
    expect(() => parseAudience("admin")).toThrow(/execution|orchestrator/);
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

  it("serves the execution set when no audience is asked for", () => {
    const root = projectRoot();

    const host = resolveMcpHost({ project: root });

    expect(host.tools.map((tool) => tool.name)).toEqual(executionToolNames);
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

    expect(() => resolveMcpHost({ project: root, audience: "admin" })).toThrow(/execution|orchestrator/);
  });

  it("says so when the path is not a project, instead of serving an empty one", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-mcp-empty-"));

    expect(() => resolveMcpHost({ project: empty })).toThrow(/No \.backlog project/);
  });

  // `mcp-server` is the one command the role guard lets through. These assert
  // the exemption stays the size it was opened at: without them an execution
  // agent reaches the orchestrator set — start_subtask included — by asking.
  it("refuses to serve the orchestrator set to an execution agent", () => {
    const root = projectRoot();

    expect(() => resolveMcpHost({ project: root, audience: "orchestrator" }, EXECUTION_ROLE)).toThrow(
      /execution agent/,
    );
  });

  it("still serves an execution agent the set its run already has", () => {
    const root = projectRoot();

    const asked = resolveMcpHost({ project: root, audience: "execution" }, EXECUTION_ROLE);
    const bare = resolveMcpHost({ project: root }, EXECUTION_ROLE);

    expect(asked.tools.map((tool) => tool.name)).toEqual(executionToolNames);
    expect(bare.tools.map((tool) => tool.name)).toEqual(executionToolNames);
  });

  it("leaves the chat alone — no role, every audience", () => {
    const root = projectRoot();

    const host = resolveMcpHost({ project: root, audience: "orchestrator" }, undefined);

    expect(host.tools.map((tool) => tool.name)).toEqual(orchestratorToolNames());
  });
});

describe("registerMcpCommand", () => {
  // The execution-role guard exempts one sub-command by name. Renaming the
  // command without renaming the exemption would leave an execution agent's
  // MCP server refusing itself on startup — the run would lose every tool it
  // has, and no other test would notice.
  it("registers under the name the role guard exempts", () => {
    const program = new Command();
    registerMcpCommand(program);

    expect(program.commands.map((command) => command.name())).toContain(EXEMPT_COMMAND);
  });
});
