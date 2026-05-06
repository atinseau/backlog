import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProjectPaths } from "@backlog/config";
import { ensureProjectId, findProject, getBacklogUserDir, initLayout, loadConfig, saveConfig } from "@backlog/config";
import { repoCurrentBranch } from "@backlog/git";

export interface ServerProject extends ProjectPaths {
  project_id: string;
  resolvedFrom: string;
  transient?: boolean;
  repoOnly?: {
    root: string;
    repo_id: string;
    name: string;
    default_branch: string;
  };
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleFromBasename(basename: string): string {
  const parts = basename
    .replace(/^\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[-_.\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ") || basename;
}

export function resolveProject(explicit?: string): ServerProject {
  const startDir = explicit ?? process.cwd();
  const project = findProject(startDir, { honorEnv: explicit === undefined });
  if (!project) {
    throw new Error(
      `No .backlog project found from ${startDir}. Run 'backlog init' or pass --project.`,
    );
  }
  return {
    ...project,
    project_id: ensureProjectId(project.backlogDir),
    resolvedFrom: startDir,
  };
}

export async function createRepoOnlyProject(repoRootInput: string): Promise<ServerProject> {
  const repoRoot = path.resolve(repoRootInput);
  const basename = path.basename(repoRoot);
  const repoId = slugify(basename) || "workspace";
  const projectName = titleFromBasename(basename);
  let defaultBranch = "main";
  try {
    const branch = await repoCurrentBranch(repoRoot);
    if (branch && branch !== "HEAD") defaultBranch = branch;
  } catch {
    // Keep the conventional fallback when git metadata cannot be read.
  }

  const digest = crypto.createHash("sha1").update(repoRoot).digest("hex").slice(0, 10);
  const projectDataRoot = path.join(getBacklogUserDir(), ".repo-boards", `${repoId}-${digest}`);
  const repoConfig = {
    id: repoId,
    path: repoRoot,
    default_branch: defaultBranch,
    enabled: true,
  };
  if (!fs.existsSync(path.join(projectDataRoot, "config.toml"))) {
    initLayout({
      root: projectDataRoot,
      projectName,
      location: "user_level",
      defaultBranch,
      repos: [repoConfig],
    });
  } else {
    const config = loadConfig(projectDataRoot);
    config.project_name = projectName;
    config.default_branch = defaultBranch;
    config.repos = [repoConfig];
    saveConfig(projectDataRoot, config);
  }

  return {
    root: projectDataRoot,
    backlogDir: projectDataRoot,
    project_id: ensureProjectId(projectDataRoot),
    resolvedFrom: repoRoot,
    transient: true,
    repoOnly: {
      root: repoRoot,
      repo_id: repoId,
      name: projectName,
      default_branch: defaultBranch,
    },
  };
}
