import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { EventBus } from "./lib/event-bus.js";
import { agentsRoutes } from "./routes/agents.js";
import { boardRoutes } from "./routes/board.js";
import { claimsRoutes } from "./routes/claims.js";
import { eventsRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { orchestrateRoutes } from "./routes/orchestrate.js";
import { runsRoutes } from "./routes/runs.js";
import { tasksRoutes } from "./routes/tasks.js";
import { workItemsRoutes } from "./routes/work-items.js";
import { staticHandler, staticPlaceholderHandler } from "./static.js";
import type { ServerWorkspace } from "./workspace-context.js";

declare const __BACKLOG_SERVER_VERSION__: string;
const VERSION =
  typeof __BACKLOG_SERVER_VERSION__ !== "undefined" ? __BACKLOG_SERVER_VERSION__ : "0.0.0-dev";

export interface BuildAppOptions {
  workspace: ServerWorkspace;
  uiDistDir?: string;
}

export interface BuildAppResult {
  app: Hono;
  bus: EventBus;
}

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Backlog Board (UI not built)</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 4rem auto; max-width: 36rem; color: #1a1a1a; padding: 0 1rem; }
    code { background: #f4f4f4; padding: 0.15rem 0.35rem; border-radius: 3px; }
    a { color: #0a84ff; }
    h1 { font-size: 1.4rem; }
  </style>
</head>
<body>
  <h1>Backlog Board — API ready, UI bundle missing</h1>
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
  const app = new Hono();
  const bus = new EventBus();
  bus.start(options.workspace.backlogDir);

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    if (process.env.BACKLOG_SERVER_LOG === "1") {
      console.log(`${c.req.method} ${c.req.path} → ${c.res.status} ${duration}ms`);
    }
  });

  app.route("/api/v1", healthRoutes(options.workspace, VERSION));
  app.route("/api/v1", boardRoutes(options.workspace));
  app.route("/api/v1", claimsRoutes(options.workspace));
  app.route("/api/v1", agentsRoutes(options.workspace));
  app.route("/api/v1", workItemsRoutes(options.workspace));
  app.route("/api/v1", tasksRoutes(options.workspace));
  app.route("/api/v1", orchestrateRoutes(options.workspace));
  app.route("/api/v1", runsRoutes(options.workspace));
  app.route("/api/v1", eventsRoutes(bus));

  const uiDir = options.uiDistDir ?? defaultUiDistDir();
  if (existsSync(uiDir)) {
    app.use("*", staticHandler({ rootDir: uiDir }));
  } else {
    app.get("*", staticPlaceholderHandler(PLACEHOLDER_HTML));
  }

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  return { app, bus };
}

export { VERSION };
