import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { agentsFileSchema, type Agent, type AgentsFile, type Task } from "@cockpit-ai/schemas";
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

export interface AgentSelection {
  agent: Agent;
  score: number;
  reasons: string[];
  activeRuns: number;
  available: boolean;
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

export function canAgentRunTask(agent: Agent, task: Pick<Task, "repo" | "risk" | "execution">): boolean {
  if (!agent.enabled) {
    return false;
  }
  if (agent.allowed_repos.length > 0 && !agent.allowed_repos.includes(task.repo)) {
    return false;
  }
  if (!agent.allowed_risk.includes(task.risk)) {
    return false;
  }
  return task.execution.required_capabilities.every((capability) => agent.capabilities.includes(capability));
}

export function rankAgentsForTask(cockpitDir: string, task: Pick<Task, "repo" | "risk" | "execution">): AgentSelection[] {
  const activeRuns = listActiveRuns(cockpitDir);
  const activeRunCounts = new Map<string, number>();
  for (const run of activeRuns) {
    activeRunCounts.set(run.agent_id, (activeRunCounts.get(run.agent_id) ?? 0) + 1);
  }

  return listAgents(cockpitDir)
    .map((agent) => {
      const reasons: string[] = [];
      if (!agent.enabled) {
        reasons.push("disabled");
      }
      if (agent.allowed_repos.length > 0 && !agent.allowed_repos.includes(task.repo)) {
        reasons.push("repo_not_allowed");
      }
      if (!agent.allowed_risk.includes(task.risk)) {
        reasons.push("risk_not_allowed");
      }

      const missingCapabilities = task.execution.required_capabilities.filter((capability) => !agent.capabilities.includes(capability));
      if (missingCapabilities.length > 0) {
        reasons.push(`missing_capabilities:${missingCapabilities.join(",")}`);
      }

      const activeRunsForAgent = activeRunCounts.get(agent.id) ?? 0;
      if (activeRunsForAgent >= agent.max_concurrent_runs) {
        reasons.push("at_capacity");
      }

      let score = 0;
      if (task.execution.preferred_agents.includes(agent.id)) {
        score += 50;
        reasons.push("preferred_agent");
      }
      score += agent.capabilities.filter((capability) => task.execution.required_capabilities.includes(capability)).length * 10;
      score += Math.max(0, agent.max_concurrent_runs - activeRunsForAgent) * 5;
      if (agent.provider === "custom") {
        score += 5;
      }
      if (reasons.length === 0) {
        reasons.push("compatible");
      }

      return {
        agent,
        score,
        reasons,
        activeRuns: activeRunsForAgent,
        available: canAgentRunTask(agent, task) && activeRunsForAgent < agent.max_concurrent_runs,
      };
    })
    .sort((left, right) => {
      if (left.available !== right.available) {
        return left.available ? -1 : 1;
      }
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.agent.id.localeCompare(right.agent.id);
    });
}

export function pickAgentForTask(cockpitDir: string, task: Pick<Task, "repo" | "risk" | "execution">): Agent {
  const agent = rankAgentsForTask(cockpitDir, task).find((candidate) => candidate.available)?.agent;
  if (!agent) {
    throw new Error(`No enabled agent can run repo ${task.repo} at risk ${task.risk}.`);
  }
  return agent;
}

export function compatibleAgentsForTask(cockpitDir: string, task: Pick<Task, "repo" | "risk" | "execution">): Agent[] {
  return rankAgentsForTask(cockpitDir, task)
    .filter((candidate) => candidate.available)
    .map((candidate) => candidate.agent);
}
