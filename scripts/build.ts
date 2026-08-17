#!/usr/bin/env bun
/**
 * Build the whole project into one self-contained executable.
 *
 * Three steps, in order:
 *   1. Vite builds the Svelte board into packages/board-ui/dist.
 *   2. We assert that every emitted file is listed in the server's
 *      ui-assets.ts, which is what `bun build --compile` follows to embed
 *      them. A new asset that nobody imports would otherwise 404 at runtime.
 *   3. `bun build --compile` bundles the CLI, the server, every workspace
 *      package and the board into a single binary.
 *
 * Usage:
 *   bun run build                          # native binary → dist/backlog
 *   bun run build --target bun-linux-x64   # cross-compiled → dist/backlog-linux-x64
 */
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const UI_DIST = join(ROOT, "packages/board-ui/dist");
const UI_ASSETS_MODULE = join(ROOT, "packages/server/src/ui-assets.ts");
const ENTRY = join(ROOT, "packages/cli/src/bin.ts");

function parseArgs(argv: string[]): { target?: string; outfile?: string } {
  const result: { target?: string; outfile?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === "--target" && next) {
      result.target = next;
      i++;
    } else if (argv[i] === "--outfile" && next) {
      result.outfile = next;
      i++;
    }
  }
  return result;
}

async function run(cmd: string[], cwd = ROOT): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${code}`);
  }
}

/** Every file under a directory, as paths relative to it with a leading slash. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `/${relative(dir, join(entry.parentPath, entry.name))}`);
}

/**
 * Guard against silent drift: Vite emitting a file that ui-assets.ts does not
 * import means that file never makes it into the binary.
 */
async function assertAssetsAreEmbedded(): Promise<void> {
  const emitted = await listFiles(UI_DIST);
  const module = await Bun.file(UI_ASSETS_MODULE).text();
  const missing = emitted.filter((path) => !module.includes(`"${path}"`));
  if (missing.length > 0) {
    throw new Error(
      [
        `packages/board-ui/dist has ${missing.length} file(s) not embedded by ui-assets.ts:`,
        ...missing.map((path) => `  ${path}`),
        "",
        "Add an import + UI_ASSETS entry for each, and give it a stable name in",
        "packages/board-ui/vite.config.ts (rollupOptions.output).",
      ].join("\n"),
    );
  }
  console.log(`✓ ${emitted.length} board assets embedded`);
}

const args = parseArgs(Bun.argv.slice(2));
const version = (await Bun.file(join(ROOT, "package.json")).json()).version as string;
const outfile = args.outfile ?? join(ROOT, "dist", args.target ? `backlog-${args.target.replace(/^bun-/, "")}` : "backlog");

console.log(`→ building board UI`);
await run(["bun", "run", "build"], join(ROOT, "packages/board-ui"));

console.log(`→ checking embedded assets`);
await assertAssetsAreEmbedded();

console.log(`→ compiling ${relative(ROOT, outfile)} (v${version}${args.target ? `, ${args.target}` : ""})`);
await run([
  "bun",
  "build",
  "--compile",
  // No --minify / --sourcemap: on a ~63 MB binary minification saves ~3%, and
  // `--compile` writes the sourcemap as a sibling .map file the binary can't
  // carry with it. Unminified code keeps stack traces readable on its own.
  ...(args.target ? [`--target=${args.target}`] : []),
  `--define=__BACKLOG_VERSION__=${JSON.stringify(version)}`,
  `--define=__BACKLOG_SERVER_VERSION__=${JSON.stringify(version)}`,
  ENTRY,
  "--outfile",
  outfile,
]);

const size = Bun.file(outfile).size || Bun.file(`${outfile}.exe`).size;
console.log(`✓ ${relative(ROOT, outfile)} — ${(size / 1024 / 1024).toFixed(1)} MB`);
