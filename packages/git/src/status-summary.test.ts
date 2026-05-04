import { describe, expect, it } from "vitest";
import { parseGitStatusEntries, parseGitStatusPorcelain } from "./status-summary.js";

describe("parseGitStatusPorcelain", () => {
  it("summarizes changed files by git status kind", () => {
    const status = parseGitStatusPorcelain([
      "A  src/new.ts",
      " M src/edited.ts",
      "D  src/removed.ts",
      "R  src/old.ts -> src/new-name.ts",
      "?? notes.md",
      "UU src/conflict.ts",
    ].join("\n"));

    expect(status).toMatchObject({
      clean: false,
      total: 6,
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
      untracked: 1,
      conflicted: 1,
      staged: 4,
      unstaged: 2,
    });
  });

  it("reports a clean tree when porcelain output is empty", () => {
    expect(parseGitStatusPorcelain("")).toMatchObject({
      clean: true,
      total: 0,
    });
  });

  it("returns path-level entries for a changes view", () => {
    expect(parseGitStatusEntries("R  src/old.ts -> src/new.ts\n?? notes.md")).toEqual([
      {
        path: "src/new.ts",
        old_path: "src/old.ts",
        kind: "renamed",
        index_status: "R",
        working_tree_status: " ",
        staged: true,
        unstaged: false,
      },
      {
        path: "notes.md",
        kind: "untracked",
        index_status: "?",
        working_tree_status: "?",
        staged: false,
        unstaged: false,
      },
    ]);
  });

  it("keeps the first path character for unstaged-only changes", () => {
    expect(parseGitStatusEntries(" M screens/MainScreen/MainScreen.js")).toMatchObject([
      {
        path: "screens/MainScreen/MainScreen.js",
        kind: "modified",
        index_status: " ",
        working_tree_status: "M",
      },
    ]);
  });

  it("is resilient if an unstaged porcelain line was already left-trimmed", () => {
    expect(parseGitStatusEntries("M screens/MainScreen/MainScreen.js")).toMatchObject([
      {
        path: "screens/MainScreen/MainScreen.js",
        kind: "modified",
        index_status: " ",
        working_tree_status: "M",
      },
    ]);
  });
});
