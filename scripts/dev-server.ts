/**
 * Dev launcher for the API + server half of the stack.
 *
 * Exists instead of a one-line package.json script for three reasons:
 * resolving the project the way a dev expects, failing loudly on a busy
 * port instead of dying with "Is port 7878 in use?", and skipping the
 * `predev` board build that `bun run dev serve` drags along — pointless
 * here, since Vite serves the board in the paired `dev:ui` process.
 *
 * Environment:
 *   BACKLOG_DEV_PORT      API port                    (default 7878)
 *   BACKLOG_DEV_PROJECT   directory to work on        (default: this checkout)
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.BACKLOG_DEV_PORT ?? 7878);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`BACKLOG_DEV_PORT is not a usable port: ${process.env.BACKLOG_DEV_PORT}`);
  process.exit(1);
}

// `bun run` always resets cwd to the package root, so this is the repository
// root whatever subdirectory the command was typed in. That determinism is
// the point: the dev stack always opens the checkout it lives in.
const root = process.cwd();

// The directory to work on. Defaults to this checkout, so `bun run dev:all`
// with no setup opens the repository it lives in.
const target = resolve(process.env.BACKLOG_DEV_PROJECT ?? root);

if (!existsSync(target) || !statSync(target).isDirectory()) {
  console.error(`BACKLOG_DEV_PROJECT is not a directory: ${target}`);
  process.exit(1);
}

// Two ways to open a directory, and the right one is not a preference — it is
// whether .backlog/ is there. `serve --project` refuses to start without it,
// which is every directory that has never been initialised. Repository-only
// opens any checkout against an ephemeral board under ~/.backlog/.repo-boards/.
const initialised = existsSync(resolve(target, ".backlog"));
const projectArgs = initialised ? ["--project", target] : ["--repository-only", target];

// Pre-flight the port. The CLI's own message ("Is port 7878 in use?") does not
// say what holds it, and the usual answer is another backlog you forgot about.
const busy = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
  signal: AbortSignal.timeout(700),
})
  .then(() => true)
  .catch(() => false);

if (busy) {
  console.error(
    `Port ${port} already answers on /api/v1/health — another backlog server is running.\n` +
      `Stop it, or pick another port: BACKLOG_DEV_PORT=7993 bun run dev:all`,
  );
  process.exit(1);
}

console.log(
  initialised
    ? `project  ${target}`
    : `project  ${target} (no .backlog/ — ephemeral board; run \`bun run dev init\` there to keep state)`,
);

// bin.ts directly, not `bun run dev`: that alias carries a `predev` hook that
// rebuilds the board with Vite before starting. Wasted work here.
const child = spawn(
  process.execPath,
  ["run", "packages/cli/src/bin.ts", "serve", "--port", String(port), ...projectArgs],
  { cwd: root, stdio: "inherit" },
);

// bun --parallel sends SIGINT/SIGTERM to this process, not to its grandchild.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
