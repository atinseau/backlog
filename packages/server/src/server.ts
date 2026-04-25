import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthHooks } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";

declare const __BACKLOG_SERVER_VERSION__: string;
const VERSION =
  typeof __BACKLOG_SERVER_VERSION__ !== "undefined" ? __BACKLOG_SERVER_VERSION__ : "0.0.0-dev";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await server.register(cors, {
    origin: process.env.BACKLOG_SERVER_CORS_ORIGIN ?? true,
  });

  registerAuthHooks(server);
  await registerHealthRoutes(server, { version: VERSION });
  await registerAuthRoutes(server);
  await registerWorkspaceRoutes(server);

  return server;
}

export { VERSION };
