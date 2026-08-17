import { buildApp, VERSION } from "./app.js";
import { createRepoOnlyProject, resolveProject, type ServerProject } from "./project-context.js";

export interface StartServerOptions {
  project?: string;
  /** Compatibility alias for `project`. */
  workspace?: string;
  /** Open a workspace folder without registering a Backlog project. */
  repoOnly?: string;
  port?: number;
  host?: string;
  uiDistDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  host: string;
  project: ServerProject;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const project = options.repoOnly
    ? await createRepoOnlyProject(options.repoOnly)
    : resolveProject(options.project ?? options.workspace);
  const appOptions: { project: ServerProject; uiDistDir?: string } = { project };
  if (options.uiDistDir) appOptions.uiDistDir = options.uiDistDir;
  const { app, buses } = buildApp(appOptions);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 7878;

  const server = Bun.serve({
    fetch: app.fetch,
    port,
    hostname: host,
    // SSE streams stay open for the lifetime of the board; without this Bun
    // would cut them at its default 10s idle timeout.
    idleTimeout: 0,
  });

  // When the caller passed port: 0, the OS picked a free port — read it back
  // from the bound socket so the returned url reflects reality. `server.port`
  // is only undefined for unix-socket servers, which we never create.
  const boundPort = server.port ?? port;
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return {
    url: `http://${displayHost}:${boundPort}`,
    port: boundPort,
    host,
    project,
    close: async () => {
      // Belt-and-suspenders shutdown. The hydrate side (suspenders)
      // forces orchestrator → idle on next launch. The belt is here:
      // before tearing down the HTTP server, walk every registered
      // project and (a) freeze its orchestrator state to idle so
      // there's no surviving "running" flag on disk, (b) cancel any
      // non-terminal active runs with a `shutdown` reason — they
      // would otherwise be reaped as orphaned `interrupted` on next
      // launch, but explicit cancellation produces a cleaner audit
      // trail and a less alarming UX than "Reaped on hydrate".
      try {
        const { loadRegistry } = await import("@backlog/config");
        const {
          shutdownOrchestrator,
          updateOrchestratorState,
          listActiveRuns,
          updateRunStatus,
        } = await import("@backlog/core");
        const registry = loadRegistry();
        const seenDirs = new Set<string>([project.backlogDir]);
        const dirs = [project.backlogDir];
        for (const project of registry.projects) {
          const root = project.path;
          const dir = project.location === "user_level" ? root : `${root}/.backlog`;
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir);
            dirs.push(dir);
          }
        }
        for (const dir of dirs) {
          try {
            // Stop the timer first so no new ticks fire mid-shutdown.
            shutdownOrchestrator(dir);
            // Cancel any in-flight runs — running, preparing, queued.
            // awaiting_review stays as-is since the agent isn't busy
            // and a human still needs to act on it.
            for (const run of listActiveRuns(dir)) {
              if (run.status === "running" || run.status === "preparing" || run.status === "queued") {
                try {
                  updateRunStatus(dir, run.id, "canceled", "Canceled — server shutting down");
                } catch {
                  // best effort: don't block shutdown on a single bad run
                }
              }
            }
            // Always reset orchestrator state to idle so next launch
            // doesn't auto-resume even if shutdownOrchestrator missed
            // anything.
            updateOrchestratorState(dir, {
              mode: "idle",
              started_at: null,
              paused_at: null,
            });
          } catch {
            // best effort per project
          }
        }
      } catch {
        // Don't block shutdown on cleanup failures — the suspenders
        // (hydrate-side reset) will catch what we missed.
      }

      buses.stopAll();
      // `true` closes in-flight requests too — without it the long-lived SSE
      // streams would hold the server open indefinitely on Ctrl+C.
      await server.stop(true);
    },
  };
}

export { buildApp, VERSION };
export type { ServerProject } from "./project-context.js";
export type { AppEnv } from "./project-resolver.js";
