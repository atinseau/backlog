import type { WorkspacePaths } from "@backlog/config";
import { ensureWorkspaceId, findWorkspace } from "@backlog/config";

export interface ServerWorkspace extends WorkspacePaths {
  workspace_id: string;
  resolvedFrom: string;
}

export function resolveWorkspace(explicit?: string): ServerWorkspace {
  const startDir = explicit ?? process.cwd();
  const workspace = findWorkspace(startDir);
  if (!workspace) {
    throw new Error(
      `No .backlog workspace found from ${startDir}. Run 'backlog init' or pass --workspace.`,
    );
  }
  return {
    ...workspace,
    workspace_id: ensureWorkspaceId(workspace.backlogDir),
    resolvedFrom: startDir,
  };
}
