/**
 * How this CLI re-invokes itself.
 *
 * In the compiled binary `process.argv[1]` is a path inside Bun's virtual
 * filesystem (`/$bunfs/root/...`). It is not a file any other process can
 * execute, so handing it to `spawn()` — or writing it into a launchd/systemd
 * unit — produces something that never runs. The binary must re-invoke
 * `process.execPath`, which is the executable itself.
 *
 * In a dev run (`bun run packages/cli/src/bin.ts`) `process.execPath` is the
 * Bun binary and `argv[1]` is the real entrypoint, so both are needed.
 */

const BUNFS_PREFIX = "/$bunfs/";

/** True when running from a `bun build --compile` executable. */
export function isCompiledBinary(): boolean {
  const entry = process.argv[1];
  return entry === undefined || entry.startsWith(BUNFS_PREFIX);
}

/**
 * The command and leading arguments that re-run this CLI. Append the
 * subcommand and its flags:
 *
 *   const { command, prefixArgs } = selfExec();
 *   spawn(command, [...prefixArgs, "serve", "--port", "7878"]);
 */
export function selfExec(): { command: string; prefixArgs: string[] } {
  if (isCompiledBinary()) {
    return { command: process.execPath, prefixArgs: [] };
  }
  return { command: process.execPath, prefixArgs: [...process.execArgv, process.argv[1]!] };
}
