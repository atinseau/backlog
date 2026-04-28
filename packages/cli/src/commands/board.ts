import { spawn } from "node:child_process";
import { Command } from "commander";

const DEFAULT_URL = "http://127.0.0.1:7878";
const HEALTH_PATH = "/api/v1/health";

// Open the kanban board in the user's default browser. Differs from
// `backlog serve` in that it doesn't start the server itself — it
// expects one to already be running (a daemon, a previous `serve`, or
// a manual instance) and just probes the health endpoint to confirm.
//
// If nothing is listening, prints the suggested next step rather than
// silently spawning serve in the background. That kept the spawn
// path optional so a daemon-managed setup doesn't suddenly get a
// stray foreground server.
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

export function registerBoardCommand(program: Command): void {
  program
    .command("board")
    .description("Open the kanban board in your default browser (assumes `backlog serve` is running)")
    .option("--url <url>", "Override the URL to open", DEFAULT_URL)
    .option("--no-probe", "Skip the health check and open the URL anyway")
    .action(async (options: { url: string; probe: boolean }) => {
      if (options.probe) {
        const reachable = await probeServer(options.url);
        if (!reachable) {
          console.error(`No server reachable at ${options.url}.`);
          console.error("Start one with `backlog serve` (or pass --no-probe to open the URL anyway).");
          process.exitCode = 1;
          return;
        }
      }
      console.log(`Opening ${options.url}…`);
      openInBrowser(options.url);
    });
}
