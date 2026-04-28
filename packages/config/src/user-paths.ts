import os from "node:os";
import path from "node:path";

// Cross-platform user-config directory for an arbitrary app, no external
// dep. Kept for completeness — Backlog itself does NOT use it (see
// getBacklogUserDir below for why).
//   Mac:     ~/Library/Application Support/<appName>/
//   Linux:   $XDG_CONFIG_HOME/<appName>/  (defaults to ~/.config/)
//   Windows: %APPDATA%\<appName>\  (falls back to ~/AppData/Roaming/<appName>/)
export function getUserConfigDir(appName: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const home = os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }
  if (platform === "win32") {
    const appData = env.APPDATA && env.APPDATA.length > 0
      ? env.APPDATA
      : path.join(home, "AppData", "Roaming");
    return path.join(appData, appName);
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
    ? env.XDG_CONFIG_HOME
    : path.join(home, ".config");
  return path.join(xdg, appName);
}

// Where Backlog stores all user-level state: the project registry
// (projects.json) AND each user_level workspace as a sibling subdirectory
// (e.g. ~/.backlog/twoody/). We deliberately do NOT use the platform-
// specific config dir for two reasons:
//   1. Backlog is a developer CLI; users expect ~/.backlog/ the same way
//      they get ~/.gitconfig, ~/.npm/, ~/.docker/, ~/.aws/.
//   2. The same path works identically on macOS, Linux, and Windows, which
//      keeps documentation, hooks, and scripts portable.
// Older versions stored projects.json under ~/Library/Application Support/
// Backlog/ on macOS — loadRegistry() migrates that file on first read.
export function getBacklogUserDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string {
  // env / platform parameters retained for API compatibility but ignored;
  // this dir is the same on every platform now.
  void env;
  void platform;
  return path.join(os.homedir(), ".backlog");
}

// Where Backlog used to keep the registry (and only the registry) before
// the move to ~/.backlog/. We fall back to this on first read so users with
// existing registries don't lose their data.
export function getLegacyBacklogConfigDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return getUserConfigDir("Backlog", env, platform);
}
