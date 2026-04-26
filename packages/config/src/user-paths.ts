import os from "node:os";
import path from "node:path";

// Cross-platform user-config directory for one app, no external dep.
// Mac:     ~/Library/Application Support/<appName>/
// Linux:   $XDG_CONFIG_HOME/<appName>/  (defaults to ~/.config/)
// Windows: %APPDATA%\<appName>\  (falls back to ~/AppData/Roaming/<appName>/)
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

// Where Backlog stores user-level state (not workspace-level).
export function getBacklogUserDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string {
  return getUserConfigDir("Backlog", env, platform);
}
