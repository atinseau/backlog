import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { startServer, type StartServerOptions } from "@backlog/server";

interface ServeOptions {
  port: string;
  host: string;
  project?: string;
  workspace?: string;
  open: boolean;
  uiDist?: string;
}

function locateUiDist(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Monorepo dev: board-ui builds into packages/server/dist/public.
    resolve(process.cwd(), "packages/server/dist/public"),
    // Monorepo dev: board-ui builds into packages/server/dist/public.
    resolve(here, "../../../server/dist/public"),
    // Dev CLI after a package build: packages/cli/src/commands/serve.ts -> ../../dist/public.
    resolve(here, "../../dist/public"),
    // Published/built CLI: packages/cli/dist/commands/serve.js -> ../public.
    resolve(here, "../public"),
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "index.html"))) return candidate;
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
    .option("--project <path>", "Project directory containing .backlog/")
    .option("-w, --workspace <path>", "Compatibility alias for --project")
    .option("--no-open", "Do not open the browser automatically")
    .option("--ui-dist <path>", "Override the UI build directory")
    .action(async (options: ServeOptions) => {
      const port = Number.parseInt(options.port, 10);
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid --port value: ${options.port}`);
      }

      if (options.project && options.workspace) {
        throw new Error("Use either --project or --workspace, not both.");
      }
      const startOptions: StartServerOptions = { port, host: options.host };
      if (options.project) startOptions.project = options.project;
      if (options.workspace) startOptions.workspace = options.workspace;
      const uiDist = locateUiDist(options.uiDist);
      if (uiDist) startOptions.uiDistDir = uiDist;
      const server = await startServer(startOptions);

      console.log(`Backlog board listening at ${server.url}`);
      console.log(`Project: ${server.project.resolvedFrom}`);
      if (server.project.root !== server.project.resolvedFrom) {
        console.log(`Project data: ${server.project.root}`);
      }
      console.log("Press Ctrl+C to stop.");

      if (options.open) {
        openInBrowser(server.url);
      }

      let shuttingDown = false;
      const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) {
          // Second Ctrl+C → exit immediately, even if a stream is still hanging.
          console.log(`\n${signal} received again, forcing exit.`);
          process.exit(130);
        }
        shuttingDown = true;
        console.log(`\nReceived ${signal}, stopping…`);
        // Safety net: if server.close() somehow still hangs, give it 3 s then exit.
        const hardExit = setTimeout(() => {
          console.error("Shutdown timed out, forcing exit.");
          process.exit(1);
        }, 3000);
        hardExit.unref();
        try {
          await server.close();
          clearTimeout(hardExit);
          process.exit(0);
        } catch (error) {
          clearTimeout(hardExit);
          console.error(error);
          process.exit(1);
        }
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
