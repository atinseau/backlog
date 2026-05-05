import { spawn } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import {
  ensureProjectId,
  findProject,
  getBacklogUserDir,
  listRegisteredProjects,
  loadConfig,
} from "@backlog/config";
import { detectRepoRoot } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";

export const DEFAULT_BOARD_URL = "http://127.0.0.1:7878";
const HEALTH_PATH = "/api/v1/health";

// "Show me the board." Smart wrapper around `backlog serve`:
//   - If a server is already listening at the URL, just open the
//     browser. Useful when serve runs as a daemon or in another
//     terminal.
//   - Otherwise, exec `backlog serve` (which itself opens the browser
//     by default) and block until Ctrl+C. Means a one-shot
//     `backlog board` always shows the kanban without making the user
//     pick between commands.
async function probeServer(url: string, timeoutMs = 750): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(HEALTH_PATH, url), { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // best-effort
  }
}

function resolveRepoPath(projectRoot: string, repoPath: string): string {
  return path.isAbsolute(repoPath)
    ? path.resolve(repoPath)
    : path.resolve(projectRoot, repoPath);
}

function repoIdForCwd(projectRoot: string, backlogDir: string, cwd = process.cwd()): string | null {
  const config = loadConfig(backlogDir);
  const current = path.resolve(cwd);
  const matches = config.repos
    .map((repo) => {
      const checkoutPath = repoCheckoutPath(repo);
      return checkoutPath ? { id: repo.id, root: resolveRepoPath(projectRoot, checkoutPath) } : null;
    })
    .filter((repo): repo is { id: string; root: string } => Boolean(repo))
    .filter((repo) => current === repo.root || current.startsWith(repo.root + path.sep))
    .sort((a, b) => b.root.length - a.root.length);
  return matches[0]?.id ?? null;
}

function fallbackProjectRoot(): string | null {
  const defaultBacklogProject = path.join(getBacklogUserDir(), "backlog");
  try {
    const fallback = findProject(defaultBacklogProject, { honorEnv: false, skipRegistry: true });
    if (fallback) return fallback.root;
  } catch {
    // fall through to registry
  }

  const registered = listRegisteredProjects()
    .filter((project) => findProject(project.path, { honorEnv: false, skipRegistry: true }) !== null)
    .sort((a, b) => Date.parse(b.last_opened_at ?? b.added_at) - Date.parse(a.last_opened_at ?? a.added_at));
  return registered[0]?.path ?? null;
}

function repoIdFromPath(repoRoot: string): string {
  return path.basename(repoRoot).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repository";
}

export async function resolveLaunchContext(cwd = process.cwd()): Promise<{
  projectRoot: string | null;
  projectId: string | null;
  repoId: string | null;
  repoOnlyRoot: string | null;
  pickProject: boolean;
}> {
  const cwdProject = findProject(cwd);
  if (cwdProject) {
    return {
      projectRoot: cwdProject.root,
      projectId: ensureProjectId(cwdProject.backlogDir),
      repoId: repoIdForCwd(cwdProject.root, cwdProject.backlogDir, cwd),
      repoOnlyRoot: null,
      pickProject: false,
    };
  }

  try {
    const repoRoot = await detectRepoRoot(cwd);
    return {
      projectRoot: null,
      projectId: null,
      repoId: repoIdFromPath(repoRoot),
      repoOnlyRoot: repoRoot,
      pickProject: false,
    };
  } catch {
    // Not in a git repository. Fall back to the registered-project picker.
  }

  return {
    projectRoot: fallbackProjectRoot(),
    projectId: null,
    repoId: null,
    repoOnlyRoot: null,
    pickProject: true,
  };
}

function urlWithLaunchParams(baseUrl: string, context: Awaited<ReturnType<typeof resolveLaunchContext>>): string {
  const url = new URL(baseUrl);
  if (context.projectId) url.searchParams.set("project", context.projectId);
  if (context.repoId) url.searchParams.set("repo", context.repoId);
  if (context.pickProject) url.searchParams.set("pick_project", "1");
  return url.toString();
}

function serveNetworkArgs(url: string): string[] {
  const parsed = new URL(url);
  const args: string[] = [];
  if (parsed.hostname) args.push("--host", parsed.hostname);
  if (parsed.port) args.push("--port", parsed.port);
  return args;
}

function relativeOpenUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function serverMatchesRepoOnly(baseUrl: string, repoRoot: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/v1/projects/current", baseUrl));
    if (!response.ok) return false;
    const json = (await response.json()) as { repo_only?: { root?: string } | null };
    return json.repo_only?.root === repoRoot;
  } catch {
    return false;
  }
}

async function nextAvailableUrl(baseUrl: string): Promise<string> {
  const parsed = new URL(baseUrl);
  const startPort = Number.parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
  for (let port = startPort + 1; port < startPort + 20; port += 1) {
    const candidate = new URL(baseUrl);
    candidate.port = String(port);
    if (!(await probeServer(candidate.toString(), 250))) {
      return candidate.toString();
    }
  }
  throw new Error(`No available board port found after ${baseUrl}.`);
}

function execServeAndBlock(args: string[]): void {
  // Re-invoke ourselves as `backlog serve` through the current Node
  // process. This works both for the built CLI (dist/bin.js) and for
  // `tsx src/bin.ts` in the monorepo dev script.
  const entry = process.argv[1];
  const child = entry
    ? spawn(process.execPath, [...process.execArgv, entry, "serve", ...args], { stdio: "inherit" })
    : spawn("backlog", ["serve", ...args], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Forward signals so Ctrl+C in the parent terminal stops the child
  // serve cleanly.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
}

export async function runBoardCommand(options: { url?: string } = {}): Promise<void> {
  const baseUrl = options.url ?? DEFAULT_BOARD_URL;
  const context = await resolveLaunchContext();
  let serveUrl = baseUrl;
  let openUrl = urlWithLaunchParams(serveUrl, context);
  const reachable = await probeServer(serveUrl);
  if (reachable) {
    if (context.repoOnlyRoot && !(await serverMatchesRepoOnly(serveUrl, context.repoOnlyRoot))) {
      serveUrl = await nextAvailableUrl(serveUrl);
      openUrl = urlWithLaunchParams(serveUrl, context);
    } else {
      console.log(`Opening ${openUrl}…`);
      openInBrowser(openUrl);
      return;
    }
  }

  if (reachable && serveUrl === baseUrl) {
    console.log(`Opening ${openUrl}…`);
    openInBrowser(openUrl);
    return;
  }

  const args = serveNetworkArgs(serveUrl);
  if (context.projectRoot) args.push("--project", context.projectRoot);
  if (context.repoOnlyRoot) args.push("--repository-only", context.repoOnlyRoot);
  args.push("--open-url", relativeOpenUrl(openUrl));

  console.log(`Starting \`backlog serve\` at ${serveUrl} (Ctrl+C to stop)…`);
  execServeAndBlock(args);
}

export function registerBoardCommand(program: Command): void {
  program
    .command("board")
    .description("Open the kanban board (start a server if none is running, otherwise just open the URL)")
    .option("--url <url>", "Override the URL to open", DEFAULT_BOARD_URL)
    .action(async (options: { url: string }) => {
      await runBoardCommand({ url: options.url });
    });
}
