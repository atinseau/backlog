import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hydrateOrchestrator } from "@backlog/core";
import { Hono } from "hono";
import { EventBusRegistry } from "./lib/event-bus-registry.js";
import { agentsRoutes } from "./routes/agents.js";
import { boardRoutes } from "./routes/board.js";
import { claimsRoutes } from "./routes/claims.js";
import { commitsRoutes } from "./routes/commits.js";
import { eventsRoutes } from "./routes/events.js";
import { integrationsRoutes } from "./routes/integrations.js";
import { healthRoutes } from "./routes/health.js";
import { orchestrateRoutes } from "./routes/orchestrate.js";
import { activityRoutes } from "./routes/activity.js";
import { orchestratorRoutes } from "./routes/orchestrator.js";
import { orchestratorChatRoutes } from "./routes/orchestrator-chat.js";
import { runDiffRoutes } from "./routes/run-diff.js";
import { reposRoutes } from "./routes/repos.js";
import { hooksRoutes } from "./routes/hooks.js";
import { secretsRoutes } from "./routes/secrets.js";
import { foldersRoutes } from "./routes/folders.js";
import { runsRoutes } from "./routes/runs.js";
import { projectRoutes } from "./routes/project.js";
import { projectsRoutes } from "./routes/projects.js";
import { subtasksRoutes } from "./routes/subtasks.js";
import { tasksRoutes } from "./routes/tasks.js";
import { usersRoutes } from "./routes/users.js";
import { staticHandler, staticPlaceholderHandler } from "./static.js";
import type { ServerProject } from "./project-context.js";
import { type AppEnv, ProjectResolver } from "./project-resolver.js";

declare const __BACKLOG_SERVER_VERSION__: string;
const VERSION =
  typeof __BACKLOG_SERVER_VERSION__ !== "undefined" ? __BACKLOG_SERVER_VERSION__ : "0.0.0-dev";

export interface BuildAppOptions {
  project: ServerProject;
  uiDistDir?: string;
}

export interface BuildAppResult {
  app: Hono<AppEnv>;
  buses: EventBusRegistry;
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Backlog (UI not built)</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 4rem auto; max-width: 36rem; color: #1a1a1a; padding: 0 1rem; }
    code { background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 3px; }
    a { color: #0a84ff; }
    h1 { font-size: 1.4rem; }
  </style>
</head>
<body>
  <h1>Backlog — API ready, UI bundle missing</h1>
  <p>The API is up. To build the kanban UI:</p>
  <pre><code>pnpm --filter @backlog/board-ui build</code></pre>
  <p>Then re-run <code>backlog serve</code>. Try the API directly:</p>
  <ul>
    <li><a href="/api/v1/health">/api/v1/health</a></li>
    <li><a href="/api/v1/board">/api/v1/board</a></li>
    <li><a href="/api/v1/claims">/api/v1/claims</a></li>
    <li><a href="/api/v1/agents">/api/v1/agents</a></li>
  </ul>
</body>
</html>`;

function defaultUiDistDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "public");
}

export function buildApp(options: BuildAppOptions): BuildAppResult {
  const app = new Hono<AppEnv>();
  const buses = new EventBusRegistry();
  const resolver = new ProjectResolver(options.project);

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    if (process.env.BACKLOG_SERVER_LOG === "1") {
      console.log(`${c.req.method} ${c.req.path} → ${c.res.status} ${duration}ms`);
    }
  });

  // Resolves ?project=<id> (or x-backlog-project header) on every API
  // request, falling back to the default project the server was launched
  // with. Replies 404 if the requested project isn't in the registry.
  app.use("/api/v1/*", resolver.middleware());

  app.route("/api/v1", healthRoutes(VERSION));
  app.route("/api/v1", boardRoutes());
  app.route("/api/v1", claimsRoutes());
  app.route("/api/v1", agentsRoutes());
  app.route("/api/v1", tasksRoutes());
  app.route("/api/v1", subtasksRoutes());
  app.route("/api/v1", orchestrateRoutes());
  app.route("/api/v1", orchestratorRoutes());
  app.route("/api/v1", orchestratorChatRoutes());
  app.route("/api/v1", activityRoutes());
  app.route("/api/v1", runDiffRoutes());
  app.route("/api/v1", reposRoutes());
  app.route("/api/v1", hooksRoutes());
  app.route("/api/v1", secretsRoutes());
  app.route("/api/v1", foldersRoutes());
  app.route("/api/v1", runsRoutes());
  app.route("/api/v1", projectRoutes());
  app.route("/api/v1", projectsRoutes(options.project));
  app.route("/api/v1", commitsRoutes());
  app.route("/api/v1", integrationsRoutes());
  app.route("/api/v1", usersRoutes());
  app.route("/api/v1", eventsRoutes(buses));

  // Hydrate the orchestrator for EVERY registered project, not just
  // the one the server was launched bound to. The kanban can switch
  // projects via the topbar selector and route API calls to any
  // registered project via the `?project=` query param. If we
  // hydrated only the bound one, switching to another project
  // could surface its stale state — running orchestrator, queued
  // subtasks, orphaned worktrees — none of which had a chance to be
  // cleaned up on this server boot. The user reported exactly this:
  // launched the desktop app (bound to twoody), kanban auto-routed to
  // demo via localStorage, demo's orchestrator.json was `running` from
  // last session, queue picked up stale subtasks, three runs auto-fired.
  // Hydrating every project at startup ensures every door is clean.
  void (async () => {
    try {
      const { loadRegistry } = await import("@backlog/config");
      const { hydrateOrchestrator: hydrate } = await import("@backlog/core");
      const registry = loadRegistry();
      const seenDirs = new Set<string>([options.project.backlogDir]);
      // Always start with the bound project.
      await hydrate(options.project.backlogDir).catch(() => undefined);
      for (const project of registry.projects) {
        const root = project.path;
        const dir = project.location === "user_level" ? root : `${root}/.backlog`;
        if (seenDirs.has(dir)) continue;
        seenDirs.add(dir);
        await hydrate(dir).catch(() => undefined);
      }
    } catch (error) {
      if (process.env.BACKLOG_SERVER_LOG === "1") {
        console.error("orchestrator hydrate failed", error);
      }
    }
  })();

  const uiDir = options.uiDistDir ?? defaultUiDistDir();
  if (existsSync(uiDir)) {
    app.use("*", staticHandler({ rootDir: uiDir }));
  } else {
    app.get("*", staticPlaceholderHandler(PLACEHOLDER_HTML));
  }

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  return { app, buses };
}

export { VERSION };
