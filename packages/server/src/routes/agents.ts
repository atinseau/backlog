import { listActiveRuns, listAgents } from "@backlog/core";
import { Hono } from "hono";
import type { ServerWorkspace } from "../workspace-context.js";

export function agentsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();
  app.get("/agents", (c) => {
    const agents = listAgents(workspace.backlogDir);
    const runs = listActiveRuns(workspace.backlogDir);
    const summary = agents.map((agent) => {
      const activeRuns = runs.filter((run) => run.agent_id === agent.id);
      return {
        id: agent.id,
        provider: agent.provider,
        enabled: agent.enabled,
        max_concurrent_runs: agent.max_concurrent_runs,
        active_runs: activeRuns.length,
        capabilities: agent.capabilities,
        allowed_repos: agent.allowed_repos,
        allowed_risk: agent.allowed_risk,
      };
    });
    return c.json({ agents: summary });
  });
  return app;
}
