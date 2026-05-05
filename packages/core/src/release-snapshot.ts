import { repoCheckoutPath } from "@backlog/schemas";
import type { ProjectConfig } from "@backlog/schemas";
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
  config: ProjectConfig,
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
    const checkoutPath = repoCheckoutPath(repo);
    if (!checkoutPath) continue;
    const repoActiveRuns = activeRuns.filter((run) => run.repo === repo.id);
    const repoArchivedRuns = archivedRuns.filter((run) => run.repo === repo.id);
    snapshots.push({
      repo: repo.id,
      path: checkoutPath,
      enabled: repo.enabled,
      branch: await repoCurrentBranch(checkoutPath),
      head: await repoHeadSha(checkoutPath),
      tag: await repoCurrentTag(checkoutPath),
      dirty: await repoIsDirty(checkoutPath),
      activeRuns: repoActiveRuns.length,
      archivedRuns: repoArchivedRuns.length,
    });
  }
  return snapshots;
}
