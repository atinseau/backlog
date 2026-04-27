import type { ProjectPaths } from "@backlog/config";
import { ensureProjectId, findProject } from "@backlog/config";

export interface ServerProject extends ProjectPaths {
  project_id: string;
  resolvedFrom: string;
}

export function resolveProject(explicit?: string): ServerProject {
  const startDir = explicit ?? process.cwd();
  const workspace = findProject(startDir);
  if (!workspace) {
    throw new Error(
      `No .backlog project found from ${startDir}. Run 'backlog init' or pass --workspace.`,
    );
  }
  return {
    ...workspace,
    project_id: ensureProjectId(workspace.backlogDir),
    resolvedFrom: startDir,
  };
}
