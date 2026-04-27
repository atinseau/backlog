import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DaemonRenderInput,
  getDaemonPaths,
  renderLaunchdPlist,
  renderSystemdUnit,
} from "./daemon.js";

const baseInput: DaemonRenderInput = {
  binary: "/Users/jane/.npm-global/bin/backlog",
  workspaceRoot: "/Users/jane/Dev/myproject",
  port: 7878,
  logDir: "/Users/jane/Library/Logs/backlog",
  homeDir: "/Users/jane",
};

describe("renderLaunchdPlist", () => {
  it("emits a well-formed plist with the expected label and program args", () => {
    const out = renderLaunchdPlist(baseInput);
    expect(out).toMatch(/^<\?xml version="1\.0"/);
    expect(out).toContain("<key>Label</key>");
    expect(out).toContain("<string>com.backlog.serve</string>");
    expect(out).toContain("<string>/Users/jane/.npm-global/bin/backlog</string>");
    expect(out).toContain("<string>serve</string>");
    expect(out).toContain("<string>--workspace</string>");
    expect(out).toContain("<string>/Users/jane/Dev/myproject</string>");
    expect(out).toContain("<string>--port</string>");
    expect(out).toContain("<string>7878</string>");
    expect(out).toContain("<string>--no-open</string>");
  });

  it("turns on RunAtLoad and KeepAlive so the daemon restarts on crash and at login", () => {
    const out = renderLaunchdPlist(baseInput);
    expect(out).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(out).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("routes stdout and stderr to the log directory", () => {
    const out = renderLaunchdPlist(baseInput);
    expect(out).toContain("/Users/jane/Library/Logs/backlog/serve.log");
    expect(out).toContain("/Users/jane/Library/Logs/backlog/serve.error.log");
  });

  it("escapes XML-unsafe characters in workspace paths", () => {
    const out = renderLaunchdPlist({
      ...baseInput,
      workspaceRoot: "/Users/jane/Dev/<weird>&'\"path",
    });
    expect(out).toContain("&lt;weird&gt;&amp;&apos;&quot;path");
    expect(out).not.toContain("<weird>");
  });
});

describe("renderSystemdUnit", () => {
  it("includes the standard sections", () => {
    const out = renderSystemdUnit(baseInput);
    expect(out).toContain("[Unit]");
    expect(out).toContain("[Service]");
    expect(out).toContain("[Install]");
  });

  it("calls backlog serve with the right args", () => {
    const out = renderSystemdUnit(baseInput);
    expect(out).toContain(
      "ExecStart=/Users/jane/.npm-global/bin/backlog serve --workspace /Users/jane/Dev/myproject --port 7878 --no-open",
    );
  });

  it("restarts on failure", () => {
    const out = renderSystemdUnit(baseInput);
    expect(out).toContain("Restart=on-failure");
  });

  it("targets default.target so it starts at user login", () => {
    const out = renderSystemdUnit(baseInput);
    expect(out).toContain("WantedBy=default.target");
  });
});

describe("getDaemonPaths", () => {
  it("places the launchd plist under ~/Library/LaunchAgents on darwin", () => {
    const paths = getDaemonPaths("darwin", "/Users/jane");
    expect(paths?.unitPath).toBe(
      path.join("/Users/jane", "Library", "LaunchAgents", "com.backlog.serve.plist"),
    );
    expect(paths?.logsDir).toBe(path.join("/Users/jane", "Library", "Logs", "backlog"));
    expect(paths?.startHint).toContain("launchctl bootstrap");
    expect(paths?.stopHint).toContain("launchctl bootout");
  });

  it("places the systemd unit under ~/.config/systemd/user on linux", () => {
    const paths = getDaemonPaths("linux", "/home/jane");
    expect(paths?.unitPath).toBe(
      path.join("/home/jane", ".config", "systemd", "user", "backlog.service"),
    );
    expect(paths?.logsDir).toBe(path.join("/home/jane", ".local", "state", "backlog"));
    expect(paths?.startHint).toContain("systemctl --user");
    expect(paths?.startHint).toContain("enable --now backlog.service");
    expect(paths?.stopHint).toContain("systemctl --user disable --now backlog.service");
  });

  it("returns null on unsupported platforms", () => {
    expect(getDaemonPaths("win32", "C:\\Users\\jane")).toBeNull();
    expect(getDaemonPaths("aix", "/home/jane")).toBeNull();
  });
});
