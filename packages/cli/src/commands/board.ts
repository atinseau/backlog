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
    .map((repo) => ({ id: repo.id, root: resolveRepoPath(projectRoot, repo.path) }))
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

function resolveLaunchContext(): {
  projectRoot: string | null;
  projectId: string | null;
  repoId: string | null;
  pickProject: boolean;
} {
  const cwdProject = findProject();
  if (cwdProject) {
    return {
      projectRoot: cwdProject.root,
      projectId: ensureProjectId(cwdProject.backlogDir),
      repoId: repoIdForCwd(cwdProject.root, cwdProject.backlogDir),
      pickProject: false,
    };
  }

  return {
    projectRoot: fallbackProjectRoot(),
    projectId: null,
    repoId: null,
    pickProject: true,
  };
}

function urlWithLaunchParams(baseUrl: string, context: ReturnType<typeof resolveLaunchContext>): string {
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
  const context = resolveLaunchContext();
  const openUrl = urlWithLaunchParams(baseUrl, context);
  const reachable = await probeServer(baseUrl);
  if (reachable) {
    console.log(`Opening ${openUrl}…`);
    openInBrowser(openUrl);
    return;
  }

  const args = serveNetworkArgs(baseUrl);
  if (context.projectRoot) args.push("--project", context.projectRoot);
  args.push("--open-url", relativeOpenUrl(openUrl));

  console.log(`No server reachable at ${baseUrl}; starting \`backlog serve\` (Ctrl+C to stop)…`);
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
