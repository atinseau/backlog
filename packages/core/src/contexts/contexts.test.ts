import { expect, test } from "bun:test";
import { catalogToolNames } from "../mcp/catalog.js";
import { orchestratorToolNames } from "../orchestrator-tools.js";
import { CONTEXTS, contextFor } from "./contexts.js";

test("every tool a context grants exists in the catalogue", () => {
  const known = new Set(catalogToolNames());
  for (const [id, context] of Object.entries(CONTEXTS)) {
    for (const name of context.mcpTools) {
      expect(known.has(name), `${id} grants unknown tool ${name}`).toBe(true);
    }
  }
});

// `callCatalogTool` matches first-wins, so a duplicate name is a silent
// hijack rather than an error: a read tool named `list_tasks` would steal the
// orchestrator's call and route it to `callReadTool`.
test("no two catalogue tools share a name", () => {
  const names = catalogToolNames();
  expect(new Set(names).size).toBe(names.length);
});

test("the execution context grants no orchestration tool", () => {
  const orchestration = new Set(orchestratorToolNames());
  for (const name of contextFor("execution").mcpTools) {
    expect(orchestration.has(name)).toBe(false);
  }
});

test("the execution context is the only one carrying a CLI role", () => {
  expect(contextFor("execution").cliRole).toBe("execution");
  expect(contextFor("orchestrator").cliRole).toBe(null);
  expect(contextFor("completion").cliRole).toBe(null);
});

test("only the execution context sees the user's own MCP servers", () => {
  expect(contextFor("execution").userMcpServers).toBe("visible");
  expect(contextFor("orchestrator").userMcpServers).toBe("hidden");
  expect(contextFor("completion").userMcpServers).toBe("hidden");
});

test("a completion gets no tools at all", () => {
  expect(contextFor("completion").mcpTools).toHaveLength(0);
  expect(contextFor("completion").mcpAudience).toBe(null);
});
