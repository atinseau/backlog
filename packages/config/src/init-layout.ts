import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RepoConfig, ProjectConfig, ProjectLocation } from "@backlog/schemas";
import { saveConfig } from "./save-config.js";
import { writeLocalShim } from "./shim.js";
import { generateProjectId } from "./project-id.js";

export interface InitLayoutOptions {
  // For in_repo: the project root that will contain .backlog/.
  // For user_level: the project data dir itself (typically ~/.backlog/<name>/).
  root: string;
  projectName: string;
  defaultBranch?: string;
  mode?: "embedded" | "control_plane";
  // Where the project data lives: in_repo (default) or user_level.
  location?: ProjectLocation;
  maxAgents?: number;
  force?: boolean;
  repos?: RepoConfig[];
}

export interface InitLayoutResult {
  backlogDir: string;
  configPath: string;
  shimPath: string;
  location: ProjectLocation;
}

// Returns the conventional path for a user-level project given its name:
// ~/.backlog/<slug>/. Slugified to lowercase-hyphen so the dir is portable
// across platforms; the canonical, human-friendly name is still kept in
// config.toml's project_name. Independent of the user-level CONFIG dir
// (~/Library/Application Support/Backlog/ on macOS) where the registry
// lives — those are separate concerns.
export function userLevelProjectDir(projectName: string): string {
  const slug = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Cannot derive user-level project dir from project name: "${projectName}"`);
  return path.join(os.homedir(), ".backlog", slug);
}

/** @deprecated Use userLevelProjectDir. */
export const userLevelWorkspaceDir = userLevelProjectDir;

export function initLayout(options: InitLayoutOptions): InitLayoutResult {
  const location: ProjectLocation = options.location ?? "in_repo";
  const backlogDir = location === "in_repo" ? path.join(options.root, ".backlog") : options.root;

  // For in_repo we still treat the .backlog/ subdir as the marker. For
  // user_level the project data dir IS the marker dir, so we use config.toml
  // as the existence test (the dir itself may have been pre-created).
  const marker = location === "in_repo" ? backlogDir : path.join(backlogDir, "config.toml");
  if (fs.existsSync(marker) && !options.force) {
    throw new Error(
      location === "in_repo"
        ? `.backlog already exists at ${backlogDir}`
        : `Backlog project already initialized at ${backlogDir}`,
    );
  }

  fs.mkdirSync(backlogDir, { recursive: true });
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
      "remote-checkouts/",
      "orchestrator.json",
      "durations-cache.json",
      "cache/",
      "secrets.json",
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
    project_location: location,
    default_branch: options.defaultBranch ?? "main",
    autonomy_mode: "assist",
    max_agents: options.maxAgents ?? 2,
    ai_provider: "anthropic",
    claims: {
      ttl_minutes: 30,
      enforce_on_commit: true,
      auto_claim_on_commit: true,
    },
    git: {
      branch_strategy: "isolated_worktree",
      merge_strategy: "fast_forward",
      cleanup_worktree_on_approve: true,
      delete_branch_after_merge: true,
    },
    board: {
      show_backlog_column: true,
    },
    review: {
      show_review_column: false,
    },
    repos: options.repos ?? [],
  };

  const configPath = saveConfig(backlogDir, config);
  fs.writeFileSync(path.join(backlogDir, "tasks.yaml"), "version: 1\nitems: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "subtasks.yaml"), "version: 1\ntasks: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "sources.yaml"), "version: 1\nsources: []\n", "utf8");
  fs.writeFileSync(path.join(backlogDir, "sync-conflicts.json"), JSON.stringify({ version: 1, conflicts: [] }, null, 2) + "\n", "utf8");
  // Default agents: Claude Sonnet, Opus, Haiku and Codex. Model strings
  // here are the family aliases — `sonnet`, `opus`, `haiku` for Claude
  // Code and `gpt-5.5` for Codex — which both CLIs accept and
  // resolve to the latest version automatically. The Agents view exposes
  // a model dropdown with curated alternatives + a free-text override.
  fs.writeFileSync(
    path.join(backlogDir, "agents.yaml"),
    [
      "version: 1",
      "agents:",
      "  - id: claude-code",
      "    provider: claude",
      "    model: sonnet",
      "    success_mode: complete",
      "    enabled: true",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium]",
      "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
      "    sandbox_mode: workspace-write",
      "    environment: {}",
      "  - id: claude-opus",
      "    provider: claude",
      "    model: opus",
      "    success_mode: complete",
      "    enabled: true",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium, high]",
      "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
      "    sandbox_mode: workspace-write",
      "    environment: {}",
      "  - id: claude-haiku",
      "    provider: claude",
      "    model: haiku",
      "    success_mode: complete",
      "    enabled: true",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium]",
      "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
      "    sandbox_mode: workspace-write",
      "    environment: {}",
      "  - id: codex",
      "    provider: codex",
      "    model: gpt-5.5",
      "    success_mode: complete",
      "    enabled: false",
      "    max_concurrent_runs: 1",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium]",
      "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
      "    sandbox_mode: workspace-write",
      "    environment: {}",
      "",
    ].join("\n"),
    "utf8",
  );

  // Empty users.yaml so the Users view has a place to write to.
  // Schema is minimal v1: list of human collaborators (real people who
  // can be assigned tasks). Invitations live alongside the user entry
  // (status: pending / active / removed) — there's no separate file.
  fs.writeFileSync(
    path.join(backlogDir, "users.yaml"),
    "version: 1\nusers: []\n",
    "utf8",
  );

  const shimPath = writeLocalShim(backlogDir, options.root);
  return { backlogDir, configPath, shimPath, location };
}
