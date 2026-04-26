import { startServer, type StartServerOptions } from "./index.js";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 7878;
const host = process.env.HOST ?? "127.0.0.1";
const workspace = process.env.BACKLOG_WORKSPACE;

const options: StartServerOptions = { port, host };
if (workspace) options.workspace = workspace;

startServer(options).then((server) => {
  console.log(`Backlog server (dev) listening at ${server.url}`);
  console.log(`Workspace: ${server.workspace.root}`);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
