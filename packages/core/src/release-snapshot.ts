import type { WorkspaceConfig } from "@backlog/schemas";
import { repoCurrentBranch, repoCurrentTag, repoHeadSha, repoIsDirty } from "@backlog/git";
import { listActiveRuns, listArchivedRuns } from "./run-store.js";

export interface RepoSnapshot {
  repo: string;
  path: string;
  enabled: boolean;
  branch: string;
  head: string;
  tag: string | null;
  dirty: boolean;
  activeRuns: number;
  archivedRuns: number;
}

export interface BuildReleaseSnapshotOptions {
  repoId?: string;
  includeDisabled?: boolean;
}

export async function buildReleaseSnapshot(
  backlogDir: string,
  config: WorkspaceConfig,
  options?: BuildReleaseSnapshotOptions,
): Promise<RepoSnapshot[]> {
  const snapshots: RepoSnapshot[] = [];
  const activeRuns = listActiveRuns(backlogDir);
  const archivedRuns = listArchivedRuns(backlogDir);
  const repos = config.repos.filter((candidate) => {
    if (options?.repoId && candidate.id !== options.repoId) {
      return false;
    }
    if (!options?.includeDisabled && !candidate.enabled) {
      return false;
    }
    return true;
  });

  for (const repo of repos) {
    const repoActiveRuns = activeRuns.filter((run) => run.repo === repo.id);
    const repoArchivedRuns = archivedRuns.filter((run) => run.repo === repo.id);
    snapshots.push({
      repo: repo.id,
      path: repo.path,
      enabled: repo.enabled,
      branch: await repoCurrentBranch(repo.path),
      head: await repoHeadSha(repo.path),
      tag: await repoCurrentTag(repo.path),
      dirty: await repoIsDirty(repo.path),
      activeRuns: repoActiveRuns.length,
      archivedRuns: repoArchivedRuns.length,
    });
  }
  return snapshots;
}
