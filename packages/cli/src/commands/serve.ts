import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startServer, type StartServerOptions } from "@backlog/server";

interface ServeOptions {
  port: string;
  host: string;
  workspace?: string;
  open: boolean;
  uiDist?: string;
}

function locateUiDist(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "public"),
    resolve(here, "../../server/dist/public"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
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
    // best-effort; ignore failures, the user can open the URL manually
  }
}

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Launch the local Backlog board (Hono server + kanban UI)")
    .option("-p, --port <port>", "TCP port to bind", "7878")
    .option("-h, --host <host>", "Hostname or IP to bind", "127.0.0.1")
    .option("-w, --workspace <path>", "Workspace directory containing .backlog/")
    .option("--no-open", "Do not open the browser automatically")
    .option("--ui-dist <path>", "Override the UI build directory")
    .action(async (options: ServeOptions) => {
      const port = Number.parseInt(options.port, 10);
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${options.port}`);
      }

      const startOptions: StartServerOptions = { port, host: options.host };
      if (options.workspace) startOptions.workspace = options.workspace;
      const uiDist = locateUiDist(options.uiDist);
      if (uiDist) startOptions.uiDistDir = uiDist;
      const server = await startServer(startOptions);

      console.log(`Backlog board listening at ${server.url}`);
      console.log(`Workspace: ${server.workspace.root}`);
      console.log("Press Ctrl+C to stop.");

      if (options.open) {
        openInBrowser(server.url);
      }

      const shutdown = async (signal: NodeJS.Signals) => {
        console.log(`\nReceived ${signal}, stopping…`);
        try {
          await server.close();
          process.exit(0);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
