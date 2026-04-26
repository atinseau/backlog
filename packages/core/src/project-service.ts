import { type Project } from "@backlog/schemas";
import { loadConfig } from "@backlog/config";
import { makeId } from "./id.js";
import {
  listProjects,
  readProjectsFile,
  readWorkItemsFile,
  writeProjectsFile,
  writeWorkItemsFile,
} from "./state-files.js";

export interface CreateProjectInput {
  slug: string;
  name: string;
  description?: string;
  color?: string;
  repoIds?: string[];
  maxAgents?: number;
}

export interface UpdateProjectInput {
  slug?: string;
  name?: string;
  description?: string;
  clearDescription?: boolean;
  color?: string;
  clearColor?: boolean;
  repoIds?: string[];
  maxAgents?: number;
  clearMaxAgents?: boolean;
  archived?: boolean;
}

function validateRepoIds(backlogDir: string, repoIds: string[], excludeProjectId?: string): void {
  if (repoIds.length === 0) return;
  const config = loadConfig(backlogDir);
  const known = new Set(config.repos.map((repo) => repo.id));
  const unknown = repoIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown repo id(s): ${unknown.join(", ")}`);
  }
  // Enforce 1:N — a repo can belong to at most one non-archived project.
  const conflicts: string[] = [];
  for (const project of listProjects(backlogDir)) {
    if (project.archived) continue;
    if (excludeProjectId && project.id === excludeProjectId) continue;
    for (const repoId of project.repo_ids) {
      if (repoIds.includes(repoId)) {
        conflicts.push(`${repoId} is already attached to project ${project.slug}`);
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Repo conflict: ${conflicts.join("; ")}. Detach it first or move it via update.`);
  }
}

export function createProject(backlogDir: string, input: CreateProjectInput): Project {
  const file = readProjectsFile(backlogDir);
  if (file.projects.some((p) => p.slug === input.slug)) {
    throw new Error(`Project slug already exists: ${input.slug}`);
  }
  validateRepoIds(backlogDir, input.repoIds ?? []);
  const now = new Date().toISOString();
  const project: Project = {
    id: makeId("PROJ"),
    slug: input.slug,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.color ? { color: input.color } : {}),
    repo_ids: input.repoIds ?? [],
    ...(input.maxAgents ? { max_agents: input.maxAgents } : {}),
    archived: false,
    created_at: now,
    updated_at: now,
  };
  file.projects.push(project);
  writeProjectsFile(backlogDir, file);
  return project;
}

export function getProject(backlogDir: string, idOrSlug: string): Project | null {
  const projects = listProjects(backlogDir);
  return projects.find((p) => p.id === idOrSlug || p.slug === idOrSlug) ?? null;
}

export function updateProject(backlogDir: string, idOrSlug: string, input: UpdateProjectInput): Project {
  const file = readProjectsFile(backlogDir);
  const project = file.projects.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
  if (!project) {
    throw new Error(`Unknown project: ${idOrSlug}`);
  }
  if (input.slug !== undefined && input.slug !== project.slug) {
    if (file.projects.some((p) => p.slug === input.slug)) {
      throw new Error(`Project slug already exists: ${input.slug}`);
    }
    project.slug = input.slug;
  }
  if (input.name !== undefined) project.name = input.name;
  if (input.description !== undefined) project.description = input.description;
  if (input.clearDescription) delete project.description;
  if (input.color !== undefined) project.color = input.color;
  if (input.clearColor) delete project.color;
  if (input.repoIds !== undefined) {
    validateRepoIds(backlogDir, input.repoIds, project.id);
    project.repo_ids = input.repoIds;
  }
  if (input.maxAgents !== undefined) project.max_agents = input.maxAgents;
  if (input.clearMaxAgents) delete project.max_agents;
  if (input.archived !== undefined) project.archived = input.archived;

  project.updated_at = new Date().toISOString();
  writeProjectsFile(backlogDir, file);
  return project;
}

export function archiveProject(backlogDir: string, idOrSlug: string): Project {
  return updateProject(backlogDir, idOrSlug, { archived: true });
}

export function removeProject(backlogDir: string, idOrSlug: string): Project {
  const file = readProjectsFile(backlogDir);
  const idx = file.projects.findIndex((p) => p.id === idOrSlug || p.slug === idOrSlug);
  if (idx < 0) {
    throw new Error(`Unknown project: ${idOrSlug}`);
  }
  const removed = file.projects.splice(idx, 1)[0]!;

  const items = readWorkItemsFile(backlogDir);
  let touched = false;
  for (const item of items.items) {
    if (item.project_id === removed.id) {
      delete item.project_id;
      item.updated_at = new Date().toISOString();
      touched = true;
    }
  }
  writeProjectsFile(backlogDir, file);
  if (touched) {
    writeWorkItemsFile(backlogDir, items);
  }
  return removed;
}
