import path from "node:path";
import { Command } from "commander";
import {
  archiveClaim,
  createClaim,
  findOverlappingClaims,
  isExpired,
  listActiveClaims,
  loadActiveClaim,
  pathsCoveredByScopes,
  readContextFile,
  removeContextFile,
  writeContextFile,
} from "@cockpit-ai/claims";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { detectGitDir, detectRepoRoot, stagedPaths } from "@cockpit-ai/git";
import type { ClaimRecord, RepoConfig } from "@cockpit-ai/schemas";

function resolveRepo(configRepos: RepoConfig[], explicitRepo?: string, repoRoot?: string): RepoConfig {
  if (explicitRepo) {
    const matched = configRepos.find((repo) => repo.id === explicitRepo);
    if (!matched) {
      throw new Error(`Unknown repo id: ${explicitRepo}`);
    }
    return matched;
  }

  if (repoRoot) {
    const matched = configRepos.find((repo) => repo.path === repoRoot);
    if (matched) {
      return matched;
    }
  }

  if (configRepos.length === 1) {
    return configRepos[0]!;
  }

  throw new Error("Unable to determine repo. Pass --repo explicitly.");
}

async function resolveClaimFromContext(cockpitDir: string, repoRoot: string): Promise<ClaimRecord> {
  const gitDir = await detectGitDir(repoRoot);
  const context = readContextFile(gitDir);
  if (!context) {
    throw new Error(`No local cockpit context found in ${gitDir}. Start a claim first.`);
  }
  return loadActiveClaim(cockpitDir, context.claim_id);
}

export function registerClaimCommand(program: Command): void {
  const claim = program.command("claim").description("Manage local Cockpit claims");

  claim
    .command("start")
    .description("Start a new claim for the current repo")
    .requiredOption("--topic <topic>", "Short claim topic")
    .requiredOption("--path <path...>", "Claimed repo-relative paths or globs")
    .option("--repo <repo>", "Configured repo id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--mode <mode>", "Claim mode (exclusive or shared)", "exclusive")
    .option("--ttl-minutes <minutes>", "Claim TTL in minutes", "30")
    .option("--allow-overlap", "Allow overlap with active claims")
    .action(async (options: {
      topic: string;
      path: string[];
      repo?: string;
      repoRoot?: string;
      mode: "exclusive" | "shared";
      ttlMinutes: string;
      allowOverlap?: boolean;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const config = loadConfig(workspace.cockpitDir);
      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const repo = resolveRepo(config.repos, options.repo, repoRoot);
      const claimRecord = createClaim({
        cockpitDir: workspace.cockpitDir,
        repo: repo.id,
        repoPath: repo.path,
        topic: options.topic,
        paths: options.path,
        mode: options.mode,
        ttlMinutes: Number.parseInt(options.ttlMinutes, 10),
      });

      const overlaps = findOverlappingClaims(workspace.cockpitDir, claimRecord);
      if (overlaps.length > 0 && !options.allowOverlap) {
        archiveClaim(workspace.cockpitDir, claimRecord.id);
        throw new Error(
          `Overlapping claim detected: ${overlaps.map((item) => `${item.id} (${item.topic})`).join(", ")}`,
        );
      }

      const gitDir = await detectGitDir(repoRoot);
      writeContextFile(gitDir, {
        version: 1,
        claim_id: claimRecord.id,
        updated_at: new Date().toISOString(),
      });

      console.log(`Started claim ${claimRecord.id}`);
      console.log(`Repo:   ${claimRecord.repo}`);
      console.log(`Scope:  ${claimRecord.paths.join(", ")}`);
      console.log(`Until:  ${claimRecord.expires_at}`);
    });

  claim
    .command("list")
    .description("List active non-expired claims")
    .action(() => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const claims = listActiveClaims(workspace.cockpitDir);
      if (claims.length === 0) {
        console.log("No active claims.");
        return;
      }

      for (const item of claims) {
        console.log(
          `${item.id} | ${item.repo} | ${item.topic} | ${item.paths.join(", ")} | until ${item.expires_at}`,
        );
      }
    });

  claim
    .command("check")
    .description("Validate staged or explicit paths against the current claim")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--staged", "Check staged files in the repo")
    .option("--path <path...>", "Explicit repo-relative paths to validate")
    .action(async (options: { repoRoot?: string; staged?: boolean; path?: string[] }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const claimRecord = await resolveClaimFromContext(workspace.cockpitDir, repoRoot);
      if (isExpired(claimRecord)) {
        throw new Error(`Claim ${claimRecord.id} expired at ${claimRecord.expires_at}.`);
      }

      const paths = options.staged ? await stagedPaths(repoRoot) : options.path ?? [];
      if (paths.length === 0) {
        console.log(`Claim ${claimRecord.id} has nothing to validate.`);
        return;
      }

      const uncoveredPaths = pathsCoveredByScopes(claimRecord.paths, paths);
      if (uncoveredPaths.length > 0) {
        throw new Error(
          `Claim ${claimRecord.id} does not cover all checked paths:\n${uncoveredPaths.map((item) => `  - ${item}`).join("\n")}`,
        );
      }

      const overlaps = findOverlappingClaims(workspace.cockpitDir, claimRecord)
        .flatMap((otherClaim) =>
          paths
            .filter((candidate) => pathsCoveredByScopes(otherClaim.paths, [candidate]).length === 0)
            .map((candidate) => `${candidate} overlaps active claim ${otherClaim.id} (${otherClaim.topic})`),
        );

      if (overlaps.length > 0) {
        throw new Error(`Refusing to continue because checked paths overlap another active claim:\n${overlaps.map((line) => `  - ${line}`).join("\n")}`);
      }

      console.log(`Claim ${claimRecord.id} covers ${paths.length} path(s).`);
    });

  claim
    .command("finish")
    .description("Finish and archive the current repo-local claim")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .action(async (options: { repoRoot?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const context = readContextFile(gitDir);
      if (!context) {
        throw new Error("No active local claim pointer found.");
      }

      const archived = archiveClaim(workspace.cockpitDir, context.claim_id);
      removeContextFile(gitDir, archived.id);
      console.log(`Finished claim ${archived.id}`);
    });
}
