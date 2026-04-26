import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { RepoProvider } from "@backlog/schemas";

export interface CloneRepoInput {
  url: string;
  dest: string;
  branch?: string;
  /** Skip clone if the dest already looks like a git repo. */
  skipIfExists?: boolean;
}

export interface CloneRepoResult {
  cloned: boolean;
  dest: string;
}

export async function cloneRepo(input: CloneRepoInput): Promise<CloneRepoResult> {
  const { url, dest, branch, skipIfExists = true } = input;
  const absoluteDest = path.resolve(dest);

  if (fs.existsSync(path.join(absoluteDest, ".git"))) {
    if (skipIfExists) return { cloned: false, dest: absoluteDest };
    throw new Error(`Destination already contains a git repository: ${absoluteDest}`);
  }

  fs.mkdirSync(path.dirname(absoluteDest), { recursive: true });

  const args = ["clone"];
  if (branch) args.push("--branch", branch);
  args.push("--", url, absoluteDest);

  await execa("git", args, { stdio: "inherit" });
  return { cloned: true, dest: absoluteDest };
}

const PROVIDER_PATTERNS: Array<{ provider: RepoProvider; matcher: RegExp }> = [
  { provider: "github", matcher: /(^|@|\/)github\.com[:/]/ },
  { provider: "gitlab", matcher: /(^|@|\/)gitlab\.com[:/]/ },
  { provider: "bitbucket", matcher: /(^|@|\/)bitbucket\.org[:/]/ },
];

export function detectGitProvider(url: string): RepoProvider {
  for (const { provider, matcher } of PROVIDER_PATTERNS) {
    if (matcher.test(url)) return provider;
  }
  return "other";
}

/**
 * Pull the human-friendly repo slug out of a git URL — e.g. for
 * "https://github.com/foo/bar.git" returns "bar". Falls back to the URL itself.
 */
export function repoIdFromGitUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  const lastSegment = trimmed.split(/[/:]/).pop() ?? trimmed;
  const withoutGit = lastSegment.replace(/\.git$/i, "");
  return withoutGit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repo";
}
