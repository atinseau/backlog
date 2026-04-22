import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { agentsFileSchema, type Agent, type AgentsFile } from "@cockpit-ai/schemas";
import { listActiveRuns } from "./run-store.js";

function agentsPath(cockpitDir: string): string {
  return path.join(cockpitDir, "agents.yaml");
}

export function readAgentsFile(cockpitDir: string): AgentsFile {
  const parsed = YAML.parse(fs.readFileSync(agentsPath(cockpitDir), "utf8")) as unknown;
  return agentsFileSchema.parse(parsed);
}

export function listAgents(cockpitDir: string): Agent[] {
  return readAgentsFile(cockpitDir).agents;
}

export function getAgent(cockpitDir: string, id: string): Agent | null {
  return listAgents(cockpitDir).find((candidate) => candidate.id === id) ?? null;
}

export interface AgentHealth {
  id: string;
  provider: string;
  enabled: boolean;
  activeRuns: number;
  maxConcurrentRuns: number;
  healthy: boolean;
  reasons: string[];
}

export function validateAgents(cockpitDir: string): Array<{ id: string; ok: boolean; reasons: string[] }> {
  return listAgents(cockpitDir).map((agent) => {
    const reasons: string[] = [];
    if (agent.max_concurrent_runs < 1) {
      reasons.push("max_concurrent_runs_must_be_positive");
    }
    if (agent.allowed_risk.length === 0) {
      reasons.push("allowed_risk_empty");
    }
    if (agent.capabilities.length === 0) {
      reasons.push("capabilities_empty");
    }
    if (agent.provider === "custom" && !agent.command) {
      reasons.push("custom_provider_missing_command");
    }
    return {
      id: agent.id,
      ok: reasons.length === 0,
      reasons,
    };
  });
}

export function healthForAgents(cockpitDir: string): AgentHealth[] {
  const activeRuns = listActiveRuns(cockpitDir);
  return listAgents(cockpitDir).map((agent) => {
    const count = activeRuns.filter((run) => run.agent_id === agent.id).length;
    const reasons: string[] = [];
    if (!agent.enabled) {
      reasons.push("disabled");
    }
    if (count > agent.max_concurrent_runs) {
      reasons.push("over_capacity");
    }
    if (agent.provider === "custom" && !agent.command) {
      reasons.push("missing_command");
    }
    return {
      id: agent.id,
      provider: agent.provider,
      enabled: agent.enabled,
      activeRuns: count,
      maxConcurrentRuns: agent.max_concurrent_runs,
      healthy: reasons.length === 0,
      reasons,
    };
  });
}

export function pickAgentForTask(cockpitDir: string, repo: string, risk: "low" | "medium" | "high"): Agent {
  const agent = listAgents(cockpitDir).find((candidate) => {
    if (!candidate.enabled) {
      return false;
    }
    if (candidate.allowed_repos.length > 0 && !candidate.allowed_repos.includes(repo)) {
      return false;
    }
    return candidate.allowed_risk.includes(risk);
  });
  if (!agent) {
    throw new Error(`No enabled agent can run repo ${repo} at risk ${risk}.`);
  }
  return agent;
}
