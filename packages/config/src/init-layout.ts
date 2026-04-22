import fs from "node:fs";
import path from "node:path";
import type { RepoConfig, WorkspaceConfig } from "@cockpit-ai/schemas";
import { saveConfig } from "./save-config.js";
import { writeLocalShim } from "./shim.js";

export interface InitLayoutOptions {
  root: string;
  workspaceName: string;
  defaultBranch?: string;
  mode?: "embedded" | "control_plane";
  maxAgents?: number;
  force?: boolean;
  repos?: RepoConfig[];
}

export interface InitLayoutResult {
  cockpitDir: string;
  configPath: string;
  shimPath: string;
}

export function initLayout(options: InitLayoutOptions): InitLayoutResult {
  const cockpitDir = path.join(options.root, ".cockpit");
  if (fs.existsSync(cockpitDir) && !options.force) {
    throw new Error(`.cockpit already exists at ${cockpitDir}`);
  }

  fs.mkdirSync(path.join(cockpitDir, "claims", "active"), { recursive: true });
  fs.mkdirSync(path.join(cockpitDir, "claims", "archive"), { recursive: true });
  fs.mkdirSync(path.join(cockpitDir, "runs", "active"), { recursive: true });
  fs.mkdirSync(path.join(cockpitDir, "runs", "archive"), { recursive: true });
  fs.mkdirSync(path.join(cockpitDir, "cache"), { recursive: true });

  const config: WorkspaceConfig = {
    version: 1,
    workspace_name: options.workspaceName,
    workspace_mode: options.mode ?? "embedded",
    default_branch: options.defaultBranch ?? "main",
    autonomy_mode: "assist",
    max_agents: options.maxAgents ?? 2,
    claims: {
      ttl_minutes: 30,
      enforce_on_commit: true,
    },
    repos: options.repos ?? [],
  };

  const configPath = saveConfig(cockpitDir, config);
  fs.writeFileSync(path.join(cockpitDir, "work-items.yaml"), "version: 1\nitems: []\n", "utf8");
  fs.writeFileSync(path.join(cockpitDir, "tasks.yaml"), "version: 1\ntasks: []\n", "utf8");
  fs.writeFileSync(path.join(cockpitDir, "sources.yaml"), "version: 1\nsources: []\n", "utf8");

  const shimPath = writeLocalShim(cockpitDir, options.root);
  return { cockpitDir, configPath, shimPath };
}
