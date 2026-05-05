import path from "node:path";
import { Command, Option } from "commander";
import {
  archiveClaim,
  createClaim,
  findOverlappingClaims,
  garbageCollectExpiredClaims,
  gcOrphanContextPointers,
  isExpired,
  listActiveClaims,
  loadActiveClaimIfPresent,
  pathsCoveredByScopes,
  readContextFile,
  removeContextFile,
  writeContextFile,
} from "@backlog/claims";
import { findProject, loadConfig } from "@backlog/config";
import { detectGitDir, detectRepoRoot, git, stagedPaths } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";
import type { ClaimRecord, RepoConfig } from "@backlog/schemas";
import { detectClaimSourceMetadata } from "./claim-source.js";

// Build a topic string from the current branch + last commit subject so
// auto-claims have human-readable context in the activity log without
// requiring the user to type one. Falls back to "auto wip" if both
// signals are missing (initial commit on a fresh branch etc.).
async function deriveAutoClaimTopic(repoRoot: string): Promise<string> {
  let branch = "";
  try {
    branch = await git(["symbolic-ref", "--short", "HEAD"], repoRoot);
  } catch {
    /* detached HEAD or fresh repository */
  }
  return branch ? `auto: ${branch}` : "auto: wip";
}

// Reduce a list of staged file paths to a smaller set of glob scopes
// that still covers them. Keeps the claim's footprint readable in
// `claim list` instead of dumping 50 individual file paths. Strategy:
// group by top two path segments and use `<dir>/**` when the group
// has 3+ files, otherwise keep the file paths as-is.
function compactScopes(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
    const parts = p.split("/");
    const key = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  const scopes: string[] = [];
  for (const [key, files] of buckets) {
    if (files.length >= 3) {
      scopes.push(`${key}/**`);
    } else {
      scopes.push(...files);
    }
  }
  return scopes;
}

function resolveRepo(configRepos: RepoConfig[], explicitRepo?: string, repoRoot?: string): RepoConfig {
  if (explicitRepo) {
    const matched = configRepos.find((repo) => repo.id === explicitRepo);
    if (!matched) {
      throw new Error(`Unknown repository id: ${explicitRepo}`);
    }
    return matched;
  }

  if (repoRoot) {
    const matched = configRepos.find((repo) => repoCheckoutPath(repo) === repoRoot);
    if (matched) {
      return matched;
    }
  }

  if (configRepos.length === 1) {
    return configRepos[0]!;
  }

  throw new Error("Unable to determine repository. Pass --repository explicitly.");
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
  const claim = loadActiveClaimIfPresent(backlogDir, context.claim_id);
  if (!claim) {
    // Stale pointer: claim file is gone (archived, GC'd, or project was
    // moved by `backlog project migrate`). Clean up so the user isn't stuck
    // and surface the same "no claim" error they'd see if no pointer existed.
    removeContextFile(gitDir);
    throw new Error(
      `Stale backlog context in ${gitDir}: claim ${context.claim_id} no longer exists in ${backlogDir}/claims/active/. Cleared the pointer; start a new claim with \`backlog claim start\`.`,
    );
  }
  return claim;
}

export function registerClaimCommand(program: Command): void {
  const claim = program.command("claim").description("Manage local Backlog claims");

  claim
    .command("start")
    .description("Start a new claim for the current repository")
    .requiredOption("--topic <topic>", "Short claim topic")
    .requiredOption("--path <path...>", "Claimed repository-relative paths or globs")
    .option("--repository <repository>", "Configured repository id")
    .addOption(new Option("--repo <repo>", "Configured repository id").hideHelp())
    .option("--repository-root <path>", "Target repository root. Defaults to current git repository")
    .addOption(new Option("--repo-root <path>", "Target repository root. Defaults to current git repository").hideHelp())
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
      const checkoutPath = repoCheckoutPath(repo);
      if (!checkoutPath) throw new Error(`Repository ${repo.id} has no local checkout path.`);
      const createInput: Parameters<typeof createClaim>[0] = {
        backlogDir: workspace.backlogDir,
        repo: repo.id,
        repoPath: checkoutPath,
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
      console.log(`Repository:   ${claimRecord.repo}`);
      console.log(`Scope:  ${claimRecord.paths.join(", ")}`);
      console.log(`Until:  ${claimRecord.expires_at}`);
    });

  claim
    .command("gc")
    .description("Archive expired active claims and clean orphan .git/backlog-context.json pointers")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      // First archive expired actives, then sweep orphan context pointers.
      // Order matters: archiving moves a claim out of active, which makes
      // any pointer to it an orphan that the second pass will catch.
      const archivedResult = garbageCollectExpiredClaims(workspace.backlogDir);
      const config = loadConfig(workspace.backlogDir);
      const pointerResult = gcOrphanContextPointers({
        backlogDir: workspace.backlogDir,
        repoRoots: config.repos.map((repo) => repoCheckoutPath(repo)).filter((repoPath): repoPath is string => Boolean(repoPath)),
      });

      if (options.json) {
        console.log(JSON.stringify({ ...archivedResult, contextPointers: pointerResult }, null, 2));
        return;
      }
      console.log(`Archived expired claims: ${archivedResult.archived.length}`);
      for (const claimId of archivedResult.archived) {
        console.log(`- ${claimId}`);
      }
      console.log(
        `Scanned ${pointerResult.scanned} .git/backlog-context.json pointer(s); removed ${pointerResult.removed.length} orphan(s).`,
      );
      for (const orphan of pointerResult.removed) {
        console.log(`- ${orphan.repoRoot} (was pointing at ${orphan.claimId})`);
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
    .option("--repository-root <path>", "Target repository root. Defaults to current git repository")
    .addOption(new Option("--repo-root <path>", "Target repository root. Defaults to current git repository").hideHelp())
    .option("--staged", "Check staged files in the repository")
    .option("--path <path...>", "Explicit repository-relative paths to validate")
    .option(
      "--auto",
      "If no claim is active for this repository, create one ad-hoc covering the staged paths (topic = branch name) before checking. Honours [claims].auto_claim_on_commit.",
    )
    .action(async (options: { repoRoot?: string; staged?: boolean; path?: string[]; auto?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const project = workspace;

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);

      async function autoClaimOrThrow(error: unknown, opts: { allowExpiredBypass?: boolean } = {}): Promise<ClaimRecord | null> {
        // No claim yet for this repository. If --auto was passed AND the project has
        // auto_claim_on_commit enabled, mint one from the staged paths so the
        // commit goes through. Expired context is special: it is old local
        // state, so it should never block a commit by itself.
        const config = loadConfig(project.backlogDir);
        const wantsAuto = options.auto === true && config.claims.auto_claim_on_commit;
        if (!wantsAuto) {
          if (opts.allowExpiredBypass) {
            console.log("Expired claim archived; no auto-claim configured. Commit allowed without claim validation.");
            return null;
          }
          const paths = options.staged ? await stagedPaths(repoRoot) : options.path ?? [];
          if (paths.length === 0) {
            console.log("No staged paths; claim validation skipped.");
            return null;
          }
          garbageCollectExpiredClaims(project.backlogDir);
          const repo = resolveRepo(config.repos, undefined, repoRoot);
          const overlaps = listActiveClaims(project.backlogDir)
            .filter((claim) => claim.repo === repo.id && !isExpired(claim))
            .flatMap((claim) =>
              paths
                .filter((candidate) => pathsCoveredByScopes(claim.paths, [candidate]).length === 0)
                .map((candidate) => `${candidate} is protected by active claim ${claim.id} (${claim.topic})`),
            );
          if (overlaps.length === 0) {
            console.log("backlog: no active Backlog claim overlaps staged paths; commit allowed.");
            return null;
          }
          throw new Error(
            `Backlog active claim protects staged paths:\n${overlaps.map((line) => `  - ${line}`).join("\n")}`,
          );
        }
        const stagedForAuto = options.staged ? await stagedPaths(repoRoot) : options.path ?? [];
        if (stagedForAuto.length === 0) {
          // Nothing staged -> nothing to claim. Let the commit through
          // (empty commits / amend-only / merge commits land here).
          console.log("No staged paths; auto-claim skipped.");
          return null;
        }

        if (!opts.allowExpiredBypass && error instanceof Error && !/No local backlog context|Stale backlog context|expired/i.test(error.message)) {
          throw error;
        }

        const repo = resolveRepo(config.repos, undefined, repoRoot);
        const checkoutPath = repoCheckoutPath(repo);
        if (!checkoutPath) {
          console.error(`backlog: repository ${repo.id} has no local checkout path; commit allowed without auto-claim.`);
          process.exit(0);
        }
        const topic = await deriveAutoClaimTopic(repoRoot);
        const scopes = compactScopes(stagedForAuto);
        const sourceMetadata = { ...detectClaimSourceMetadata(), auto: "1" };
        const created = createClaim({
          backlogDir: project.backlogDir,
          repo: repo.id,
          repoPath: checkoutPath,
          topic,
          paths: scopes,
          mode: "exclusive",
          ttlMinutes: config.claims.ttl_minutes,
          metadata: sourceMetadata,
        });
        writeContextFile(gitDir, {
          version: 1,
          claim_id: created.id,
          updated_at: new Date().toISOString(),
        });
        console.log(`backlog: auto-claimed ${created.id} (${topic}) covering ${scopes.length} scope(s).`);
        return created;
      }

      let claimRecord: ClaimRecord | null;
      try {
        claimRecord = await resolveClaimFromContext(project.backlogDir, repoRoot);
      } catch (error) {
        claimRecord = await autoClaimOrThrow(error);
      }
      if (!claimRecord) return;

      if (claimRecord && isExpired(claimRecord)) {
        archiveClaim(project.backlogDir, claimRecord.id);
        removeContextFile(gitDir);
        console.log(`backlog: archived expired claim ${claimRecord.id} (expired at ${claimRecord.expires_at}).`);
        claimRecord = await autoClaimOrThrow(
          new Error(`Claim ${claimRecord.id} expired at ${claimRecord.expires_at}.`),
          { allowExpiredBypass: true },
        );
        if (!claimRecord) return;
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

      const overlaps = findOverlappingClaims(project.backlogDir, claimRecord)
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
    .description("Finish and archive the current repository-local claim (or all claims with --all)")
    .option("--repository-root <path>", "Target repository root. Defaults to current git repository")
    .addOption(new Option("--repo-root <path>", "Target repository root. Defaults to current git repository").hideHelp())
    .option("--all", "Finish every active claim and clear every .git/backlog-context.json across configured repositories")
    .option("--quiet", "Stay silent when there's nothing to finish (don't error)")
    .action(async (options: { repoRoot?: string; all?: boolean; quiet?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      if (options.all) {
        if (options.repoRoot) {
          throw new Error("--all and --repository-root are mutually exclusive.");
        }
        const config = loadConfig(workspace.backlogDir);
        const finished: string[] = [];
        const stale: string[] = [];

        // Archive every active claim. We do this even if no context
        // pointer references them — long-running orphan actives are
        // exactly the state `claim gc` would otherwise eventually clean.
        for (const active of listActiveClaims(workspace.backlogDir)) {
          archiveClaim(workspace.backlogDir, active.id);
          finished.push(active.id);
        }

        // Clear every .git/backlog-context.json — they reference claims
        // that are now archived, or were already orphans.
        for (const repo of config.repos) {
          const checkoutPath = repoCheckoutPath(repo);
          if (!checkoutPath) continue;
          let gitDir;
          try {
            gitDir = await detectGitDir(checkoutPath);
          } catch {
            continue;
          }
          const context = readContextFile(gitDir);
          if (!context) continue;
          removeContextFile(gitDir);
          stale.push(`${repo.id} (was pointing at ${context.claim_id})`);
        }

        if (finished.length === 0 && stale.length === 0) {
          if (!options.quiet) console.log("Nothing to finish — no active claims and no .git/backlog-context.json pointers.");
          return;
        }
        console.log(`Finished ${finished.length} active claim(s).`);
        for (const id of finished) console.log(`- ${id}`);
        if (stale.length > 0) {
          console.log(`Cleared ${stale.length} stale .git/backlog-context.json pointer(s).`);
          for (const line of stale) console.log(`- ${line}`);
        }
        return;
      }

      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const context = readContextFile(gitDir);
      if (!context) {
        if (options.quiet) return;
        throw new Error(
          `No active local claim pointer in ${gitDir}. Use \`--all\` to sweep every active claim and pointer in this project, or \`--quiet\` to suppress this error.`,
        );
      }

      // Tolerate a stale pointer: if the claim file is gone, treat the
      // finish as a no-op and clear the pointer (same recovery path as
      // claim check). A bare ENOENT here would otherwise replicate the
      // bug we already fixed for `claim check`.
      const claim = loadActiveClaimIfPresent(workspace.backlogDir, context.claim_id);
      if (!claim) {
        removeContextFile(gitDir);
        console.log(
          `Stale pointer in ${gitDir} (claim ${context.claim_id} no longer in active/). Cleared.`,
        );
        return;
      }

      archiveClaim(workspace.backlogDir, claim.id);
      removeContextFile(gitDir, claim.id);
      console.log(`Finished claim ${claim.id}`);
    });
}
