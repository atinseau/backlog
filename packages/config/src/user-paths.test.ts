import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getBacklogUserDir, getLegacyBacklogConfigDir, getUserConfigDir } from "./user-paths.js";

describe("getUserConfigDir", () => {
  it("uses ~/Library/Application Support on darwin", () => {
    expect(getUserConfigDir("Foo", {}, "darwin")).toBe(
      path.join(os.homedir(), "Library", "Application Support", "Foo"),
    );
  });

  it("uses XDG_CONFIG_HOME on linux when set", () => {
    expect(getUserConfigDir("foo", { XDG_CONFIG_HOME: "/custom/xdg" }, "linux")).toBe(
      path.join("/custom/xdg", "foo"),
    );
  });

  it("falls back to ~/.config on linux when XDG_CONFIG_HOME is unset", () => {
    expect(getUserConfigDir("foo", {}, "linux")).toBe(path.join(os.homedir(), ".config", "foo"));
  });

  it("falls back to ~/.config on linux when XDG_CONFIG_HOME is empty", () => {
    expect(getUserConfigDir("foo", { XDG_CONFIG_HOME: "" }, "linux")).toBe(
      path.join(os.homedir(), ".config", "foo"),
    );
  });

  it("uses APPDATA on win32 when set", () => {
    expect(getUserConfigDir("Foo", { APPDATA: "C:\\\\Roaming" }, "win32")).toBe(
      path.join("C:\\\\Roaming", "Foo"),
    );
  });

  it("falls back to ~/AppData/Roaming on win32 when APPDATA is unset", () => {
    expect(getUserConfigDir("Foo", {}, "win32")).toBe(
      path.join(os.homedir(), "AppData", "Roaming", "Foo"),
    );
  });
});

describe("getBacklogUserDir", () => {
  it("returns ~/.backlog/ on darwin", () => {
    expect(getBacklogUserDir({}, "darwin")).toBe(path.join(os.homedir(), ".backlog"));
  });

  it("returns ~/.backlog/ on linux too", () => {
    expect(getBacklogUserDir({}, "linux")).toBe(path.join(os.homedir(), ".backlog"));
  });

  it("returns ~/.backlog/ on win32 too", () => {
    expect(getBacklogUserDir({}, "win32")).toBe(path.join(os.homedir(), ".backlog"));
  });
});

describe("getLegacyBacklogConfigDir", () => {
  it("returns the platform-specific Backlog/ dir for migration purposes", () => {
    expect(getLegacyBacklogConfigDir({}, "darwin")).toBe(
      path.join(os.homedir(), "Library", "Application Support", "Backlog"),
    );
    expect(getLegacyBacklogConfigDir({}, "linux")).toBe(path.join(os.homedir(), ".config", "Backlog"));
  });
});
