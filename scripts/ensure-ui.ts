#!/usr/bin/env bun
/**
 * Build the board only when it's actually missing or stale.
 *
 * Wired as `predev`, so `bun run dev serve` always serves a current board
 * without anyone having to remember `build:ui` — while `bun run dev status`
 * and friends stay instant, since an up-to-date check is a few milliseconds
 * of stat() calls rather than a 1.5s Vite run.
 *
 * Only `dev` needs this. Typecheck and tests pass without the board on disk
 * (the imports in ui-assets.ts are covered by ambient declarations, and
 * static.ts guards its dynamic import), and `bun run build` builds the board
 * itself, unconditionally, so a release never ships a cached bundle.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const UI = join(ROOT, "packages/board-ui");
const OUTPUT = join(UI, "dist/index.html");

/** Inputs whose change should invalidate the built board. */
const SOURCES = [join(UI, "src"), join(UI, "vite.config.ts"), join(UI, "package.json")];

async function newestMtime(target: string): Promise<number> {
  const info = await stat(target).catch(() => null);
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;

  const entries = await readdir(target, { recursive: true, withFileTypes: true });
  let newest = info.mtimeMs;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const child = await stat(join(entry.parentPath, entry.name)).catch(() => null);
    if (child && child.mtimeMs > newest) newest = child.mtimeMs;
  }
  return newest;
}

const builtAt = await stat(OUTPUT).then((s) => s.mtimeMs).catch(() => 0);

if (builtAt > 0) {
  const sourceTimes = await Promise.all(SOURCES.map(newestMtime));
  if (Math.max(...sourceTimes) <= builtAt) {
    process.exit(0); // up to date — say nothing, this runs before every dev command
  }
  console.log("→ board UI is stale, rebuilding");
} else {
  console.log("→ board UI not built yet, building");
}

const proc = Bun.spawn(["bun", "run", "build"], { cwd: UI, stdout: "inherit", stderr: "inherit" });
process.exit(await proc.exited);
