import { describe, expect, it } from "bun:test";
import { agentToolNames, orchestratorToolNames } from "@backlog/core";
import { mcpHostFor, parseAudience } from "./mcp.js";

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
