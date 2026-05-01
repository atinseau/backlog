import type { ProjectPaths } from "@backlog/config";
import { ensureProjectId, findProject } from "@backlog/config";

export interface ServerProject extends ProjectPaths {
  project_id: string;
  resolvedFrom: string;
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
