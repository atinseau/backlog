import type { WorkspaceConfig } from "@cockpit-ai/schemas";
import { repoCurrentBranch, repoCurrentTag, repoHeadSha, repoIsDirty } from "@cockpit-ai/git";
import { listActiveRuns, listArchivedRuns } from "./run-store.js";

export interface RepoSnapshot {
  repo: string;
  path: string;
  branch: string;
  head: string;
  tag: string | null;
  dirty: boolean;
  activeRuns: number;
  archivedRuns: number;
}

export async function buildReleaseSnapshot(cockpitDir: string, config: WorkspaceConfig): Promise<RepoSnapshot[]> {
  const snapshots: RepoSnapshot[] = [];
  const activeRuns = listActiveRuns(cockpitDir);
  const archivedRuns = listArchivedRuns(cockpitDir);
  for (const repo of config.repos.filter((candidate) => candidate.enabled)) {
    const repoActiveRuns = activeRuns.filter((run) => run.repo === repo.id);
    const repoArchivedRuns = archivedRuns.filter((run) => run.repo === repo.id);
    snapshots.push({
      repo: repo.id,
      path: repo.path,
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
