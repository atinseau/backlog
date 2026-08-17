import { describe, expect, it } from "bun:test";
import { parsePorcelainPaths } from "./git-status.js";

// `git status --porcelain` uses a fixed layout: two status columns, a space,
// then the path. The first column is blank for a worktree-only change, so
// trimming the line before slicing eats the first character of the filename.

describe("parsePorcelainPaths", () => {
  it("reads the path of a worktree modification, whose first column is blank", () => {
    expect(parsePorcelainPaths(" M README.md")).toEqual(["README.md"]);
  });

  it("reads the path of a staged modification", () => {
    expect(parsePorcelainPaths("M  README.md")).toEqual(["README.md"]);
  });

  it("reads the path of an untracked file", () => {
    expect(parsePorcelainPaths("?? notes.txt")).toEqual(["notes.txt"]);
  });

  it("keeps a nested path intact", () => {
    expect(parsePorcelainPaths(" M .backlog/id-counters.json")).toEqual([".backlog/id-counters.json"]);
  });

  it("unquotes a path with a space in it", () => {
    expect(parsePorcelainPaths('?? "my file.txt"')).toEqual(["my file.txt"]);
  });

  it("takes the destination of a rename", () => {
    expect(parsePorcelainPaths("R  old.txt -> new.txt")).toEqual(["new.txt"]);
  });

  it("reads every line of a multi-file status", () => {
    expect(parsePorcelainPaths(" M a.ts\n?? b.ts\nA  c.ts")).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("ignores blank lines and trailing newlines", () => {
    expect(parsePorcelainPaths(" M a.ts\n\n")).toEqual(["a.ts"]);
  });

  it("returns nothing for a clean tree", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
  });
});
