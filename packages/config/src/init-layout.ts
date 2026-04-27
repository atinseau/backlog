import fs from "node:fs";
import path from "node:path";
import type { RepoConfig, ProjectConfig } from "@backlog/schemas";
import { saveConfig } from "./save-config.js";
import { writeLocalShim } from "./shim.js";
import { generateProjectId } from "./project-id.js";

export interface InitLayoutOptions {
  root: string;
  projectName: string;
  defaultBranch?: string;
  mode?: "embedded" | "control_plane";
  maxAgents?: number;
  force?: boolean;
  repos?: RepoConfig[];
}

export interface InitLayoutResult {
  backlogDir: string;
  configPath: string;
  shimPath: string;
}

export function initLayout(options: InitLayoutOptions): InitLayoutResult {
  const backlogDir = path.join(options.root, ".backlog");
  if (fs.existsSync(backlogDir) && !options.force) {
    throw new Error(`.backlog already exists at ${backlogDir}`);
  }

  fs.mkdirSync(path.join(backlogDir, "claims", "active"), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, "claims", "archive"), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, "runs", "active"), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, "runs", "archive"), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, "worktrees"), { recursive: true });
  fs.mkdirSync(path.join(backlogDir, "cache"), { recursive: true });

  // .gitignore inside .backlog/ — keep source-of-truth YAMLs (config, work
  // items, tasks, projects, agents, sources) tracked, but ignore ephemeral
  // operational state (claims, runs, worktrees, orchestrator runtime).
  fs.writeFileSync(
    path.join(backlogDir, ".gitignore"),
    [
      "# Managed by `backlog init`. Edit if you want to track more or less.",
      "",
      "# Ephemeral operational state — never commit.",
      "claims/",
      "runs/",
      "worktrees/",
      "orchestrator.json",
      "durations-cache.json",
      "cache/",
      "*.tmp",
      "",
      "# Local shim used by the pre-commit hook.",
      "bin/",
      "",
    ].join("\n"),
    "utf8",
  );

  const config: ProjectConfig = {
    version: 1,
    project_id: generateProjectId(),
    project_name: options.projectName,
    project_mode: options.mode ?? "embedded",
    default_branch: options.defaultBranch ?? "main",
    autonomy_mode: "assist",
    max_agents: options.maxAgents ?? 2,
    claims: {
      ttl_minutes: 30,
      enforce_on_commit: true,
    },
    repos: options.repos ?? [],
  };

  const configPath = saveConfig(backlogDir, config);
  fs.writeFileSync(path.join(backlogDir, "work-items.yaml"), "version: 1\nitems: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "subtasks.yaml"), "version: 1\ntasks: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "sources.yaml"), "version: 1\nsources: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "sync-conflicts.json"), JSON.stringify({ version: 1, conflicts: [] }, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(backlogDir, "agents.yaml"),
    [
      "version: 1",
      "agents:",
      "  - id: manual-default",
      "    provider: manual",
      "    enabled: true",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium, high]",
      "    capabilities: [plan, edit_code, review]",
      "    environment: {}",
      "  - id: codex-default",
      "    provider: codex",
      "    model: gpt-5.4",
      "    success_mode: review",
      "    enabled: false",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium]",
      "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
      "    sandbox_mode: workspace-write",
      "    environment: {}",
      "  - id: claude-default",
      "    provider: claude",
      "    model: sonnet",
      "    success_mode: review",
      "    enabled: false",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium]",
      "    capabilities: [plan, edit_code, review]",
      "    environment: {}",
      "",
    ].join("\n"),
    "utf8",
  );

  const shimPath = writeLocalShim(backlogDir, options.root);
  return { backlogDir, configPath, shimPath };
}
