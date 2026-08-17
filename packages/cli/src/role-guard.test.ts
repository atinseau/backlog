import { describe, expect, test } from "bun:test";
import { EXEMPT_COMMAND, refuseWhenExecutionRole } from "./role-guard.js";

describe("refuseWhenExecutionRole", () => {
  test("no role set: everything proceeds", () => {
    expect(refuseWhenExecutionRole({}, ["node", "backlog", "task", "move", "t_1", "done"])).toBe(null);
  });

  test("another role proceeds — only the execution role is refused", () => {
    expect(
      refuseWhenExecutionRole({ BACKLOG_AGENT_ROLE: "orchestrator" }, ["node", "backlog", "task", "list"]),
    ).toBe(null);
  });

  test("execution role: a write is refused", () => {
    const message = refuseWhenExecutionRole(
      { BACKLOG_AGENT_ROLE: "execution" },
      ["node", "backlog", "task", "move", "t_1", "done"],
    );
    expect(message).toContain("execution agent");
    expect(message).toContain("MCP");
  });

  test("execution role: a read is refused too — there is no allowlist", () => {
    expect(
      refuseWhenExecutionRole({ BACKLOG_AGENT_ROLE: "execution" }, ["node", "backlog", "task", "show", "t_1"]),
    ).not.toBe(null);
  });

  test("execution role: even a bare invocation is refused", () => {
    expect(refuseWhenExecutionRole({ BACKLOG_AGENT_ROLE: "execution" }, ["node", "backlog"])).not.toBe(null);
  });

  test("the pre-commit hook is exempt", () => {
    expect(
      refuseWhenExecutionRole(
        { BACKLOG_AGENT_ROLE: "execution", BACKLOG_HOOK_INVOCATION: "1" },
        ["node", "backlog", "claim", "check", "--paths", "src/a.ts"],
      ),
    ).toBe(null);
  });
});

// Removing this exemption costs the agent every one of its tools: `claude`
// passes the run's environment down to the stdio MCP server it spawns, so the
// server starts under BACKLOG_AGENT_ROLE=execution and would refuse itself.
describe("the run's own MCP server", () => {
  test("mcp-server is exempt under the execution role", () => {
    expect(
      refuseWhenExecutionRole(
        { BACKLOG_AGENT_ROLE: "execution" },
        ["bun", "/path/to/bin.ts", "mcp-server", "--audience", "execution", "--project", "/p/.backlog"],
      ),
    ).toBe(null);
  });

  test("the exemption is the sub-command, not the word appearing anywhere", () => {
    expect(
      refuseWhenExecutionRole(
        { BACKLOG_AGENT_ROLE: "execution" },
        ["node", "backlog", "task", "create", "--title", EXEMPT_COMMAND],
      ),
    ).not.toBe(null);
  });
});
