import { afterEach, describe, expect, it } from "bun:test";
import { isCompiledBinary, selfExec } from "./self-exec.js";

const originalArgv1 = process.argv[1];

afterEach(() => {
  if (originalArgv1 === undefined) process.argv.length = 1;
  else process.argv[1] = originalArgv1;
});

describe("isCompiledBinary", () => {
  it("is false for a dev run, where argv[1] is a real entrypoint", () => {
    process.argv[1] = "/repo/packages/cli/src/bin.ts";
    expect(isCompiledBinary()).toBe(false);
  });

  it("is true inside a compiled binary, where argv[1] is a /$bunfs/ path", () => {
    process.argv[1] = "/$bunfs/root/backlog";
    expect(isCompiledBinary()).toBe(true);
  });

  it("is true when argv[1] is absent", () => {
    process.argv.length = 1;
    expect(isCompiledBinary()).toBe(true);
  });
});

describe("selfExec", () => {
  it("re-execs the binary itself when compiled — a /$bunfs/ path is not executable", () => {
    process.argv[1] = "/$bunfs/root/backlog";
    const { command, prefixArgs } = selfExec();
    expect(command).toBe(process.execPath);
    expect(prefixArgs).toEqual([]);
  });

  it("hands the entrypoint back to the runtime in a dev run", () => {
    process.argv[1] = "/repo/packages/cli/src/bin.ts";
    const { command, prefixArgs } = selfExec();
    expect(command).toBe(process.execPath);
    expect(prefixArgs.at(-1)).toBe("/repo/packages/cli/src/bin.ts");
  });
});
