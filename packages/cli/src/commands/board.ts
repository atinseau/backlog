import { spawn } from "node:child_process";
import { Command } from "commander";

const DEFAULT_URL = "http://127.0.0.1:7878";
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

function execServeAndBlock(): void {
  // Re-invoke ourselves as `backlog serve`. process.argv[1] is the
  // backlog binary entry — we want a child that's transparently the
  // user's same install, so this reuses any `npm link` / version
  // they already have on PATH.
  const backlogBin = process.argv[1] ?? "backlog";
  const child = spawn(backlogBin, ["serve"], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Forward signals so Ctrl+C in the parent terminal stops the child
  // serve cleanly.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
}

export function registerBoardCommand(program: Command): void {
  program
    .command("board")
    .description("Open the kanban board (start a server if none is running, otherwise just open the URL)")
    .option("--url <url>", "Override the URL to open", DEFAULT_URL)
    .action(async (options: { url: string }) => {
      const reachable = await probeServer(options.url);
      if (reachable) {
        console.log(`Opening ${options.url}…`);
        openInBrowser(options.url);
        return;
      }
      console.log(`No server reachable at ${options.url}; starting \`backlog serve\` (Ctrl+C to stop)…`);
      execServeAndBlock();
    });
}
