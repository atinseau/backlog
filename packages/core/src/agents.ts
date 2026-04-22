import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { agentsFileSchema, type Agent, type AgentsFile } from "@cockpit-ai/schemas";

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
