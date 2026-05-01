import { startServer, type StartServerOptions } from "./index.js";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 7878;
const host = process.env.HOST ?? "127.0.0.1";
const project = process.env.BACKLOG_PROJECT ?? process.env.BACKLOG_WORKSPACE;

const options: StartServerOptions = { port, host };
if (project) options.project = project;

startServer(options).then((server) => {
  console.log(`Backlog server (dev) listening at ${server.url}`);
  console.log(`Project: ${server.project.resolvedFrom}`);
  if (server.project.root !== server.project.resolvedFrom) {
    console.log(`Project data: ${server.project.root}`);
  }
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
