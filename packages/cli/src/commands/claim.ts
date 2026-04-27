import path from "node:path";
import { Command } from "commander";
import {
  archiveClaim,
  createClaim,
  findOverlappingClaims,
  garbageCollectExpiredClaims,
  isExpired,
  listActiveClaims,
  loadActiveClaim,
  pathsCoveredByScopes,
  readContextFile,
  removeContextFile,
  writeContextFile,
} from "@backlog/claims";
import { findProject, loadConfig } from "@backlog/config";
import { detectGitDir, detectRepoRoot, stagedPaths } from "@backlog/git";
import type { ClaimRecord, RepoConfig } from "@backlog/schemas";
import { detectClaimSourceMetadata } from "./claim-source.js";

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

function parseMetadataKv(entries: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf("=");
    if (sep <= 0 || sep === trimmed.length - 1) {
      throw new Error(`Invalid --metadata entry: ${entry}. Expected key=value.`);
    }
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim();
    if (!key) throw new Error(`Invalid --metadata entry: ${entry}. Empty key.`);
    result[key] = value;
  }
  return result;
}

export function parseClaimMetadata(
  flagValues: string[] | undefined,
  envValue: string | undefined,
  options: { detectSource?: boolean } = {},
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  // Lowest priority: auto-detected source (only if not opted out).
  if (options.detectSource !== false) {
    Object.assign(merged, detectClaimSourceMetadata());
  }
  // Mid priority: env var.
  if (envValue && envValue.trim()) {
    const envParts = envValue.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean);
    if (envParts.length > 0) {
      Object.assign(merged, parseMetadataKv(envParts));
    }
  }
  // Highest priority: explicit --metadata flags.
  if (flagValues && flagValues.length > 0) {
    Object.assign(merged, parseMetadataKv(flagValues));
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

async function resolveClaimFromContext(backlogDir: string, repoRoot: string): Promise<ClaimRecord> {
  const gitDir = await detectGitDir(repoRoot);
  const context = readContextFile(gitDir);
  if (!context) {
    throw new Error(`No local backlog context found in ${gitDir}. Start a claim first.`);
  }
  return loadActiveClaim(backlogDir, context.claim_id);
}

export function registerClaimCommand(program: Command): void {
  const claim = program.command("claim").description("Manage local Backlog claims");

  claim
    .command("start")
    .description("Start a new claim for the current repo")
    .requiredOption("--topic <topic>", "Short claim topic")
    .requiredOption("--path <path...>", "Claimed repo-relative paths or globs")
    .option("--repo <repo>", "Configured repo id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--mode <mode>", "Claim mode (exclusive or shared)", "exclusive")
    .option("--ttl-minutes <minutes>", "Claim TTL in minutes", "30")
    .option("--duration <seconds>", "Expected work duration in seconds (powers retry-after hints)")
    .option("--agent <id>", "Agent id holding this claim")
    .option(
      "--metadata <kv...>",
      "Free-form attribution, repeatable: key=value (also reads BACKLOG_CLAIM_METADATA env)",
    )
    .option("--no-detect-source", "Skip auto-detection of the calling tool (Claude Code, etc.)")
    .option("--allow-overlap", "Allow overlap with active claims")
    .action(async (options: {
      topic: string;
      path: string[];
      repo?: string;
      repoRoot?: string;
      mode: "exclusive" | "shared";
      ttlMinutes: string;
      duration?: string;
      agent?: string;
      metadata?: string[];
      detectSource?: boolean;
      allowOverlap?: boolean;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const config = loadConfig(workspace.backlogDir);
      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const repo = resolveRepo(config.repos, options.repo, repoRoot);
      const createInput: Parameters<typeof createClaim>[0] = {
        backlogDir: workspace.backlogDir,
        repo: repo.id,
        repoPath: repo.path,
        topic: options.topic,
        paths: options.path,
        mode: options.mode,
        ttlMinutes: Number.parseInt(options.ttlMinutes, 10),
      };
      if (options.duration) {
        const parsed = Number.parseInt(options.duration, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
          throw new Error(`Invalid --duration: ${options.duration}`);
        }
        createInput.expectedDurationSeconds = parsed;
      }
      if (options.agent) {
        createInput.agentId = options.agent;
      }
      const metadata = parseClaimMetadata(options.metadata, process.env.BACKLOG_CLAIM_METADATA, {
        detectSource: options.detectSource !== false,
      });
      if (metadata) {
        createInput.metadata = metadata;
      }
      const claimRecord = createClaim(createInput);

      const overlaps = findOverlappingClaims(workspace.backlogDir, claimRecord);
      if (overlaps.length > 0 && !options.allowOverlap) {
        archiveClaim(workspace.backlogDir, claimRecord.id);
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
    .command("gc")
    .description("Archive expired active claims")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const result = garbageCollectExpiredClaims(workspace.backlogDir);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Archived expired claims: ${result.archived.length}`);
      for (const claimId of result.archived) {
        console.log(`- ${claimId}`);
      }
    });

  claim
    .command("list")
    .description("List active non-expired claims")
    .action(() => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const claims = listActiveClaims(workspace.backlogDir);
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const claimRecord = await resolveClaimFromContext(workspace.backlogDir, repoRoot);
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

      const overlaps = findOverlappingClaims(workspace.backlogDir, claimRecord)
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const context = readContextFile(gitDir);
      if (!context) {
        throw new Error("No active local claim pointer found.");
      }

      const archived = archiveClaim(workspace.backlogDir, context.claim_id);
      removeContextFile(gitDir, archived.id);
      console.log(`Finished claim ${archived.id}`);
    });
}
