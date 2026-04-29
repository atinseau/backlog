import { app, dialog, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadRegistry } from "@backlog/config";

interface DesktopState {
  lastWorkspace?: string;
}

function statePath(): string {
  return path.join(app.getPath("userData"), "state.json");
}

function loadState(): DesktopState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as DesktopState;
  } catch {
    return {};
  }
}

function saveState(state: DesktopState): void {
  const file = statePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function looksLikeWorkspace(p: string): boolean {
  if (!existsSync(p)) return false;
  if (existsSync(path.join(p, "config.toml"))) return true;
  if (existsSync(path.join(p, ".backlog", "config.toml"))) return true;
  return false;
}

export async function resolveWorkspace(window: BrowserWindow): Promise<string | undefined> {
  // Override hook for smoke tests, scripted launches, and "Open With…" flows.
  const fromEnv = process.env.BACKLOG_DESKTOP_WORKSPACE;
  if (fromEnv && looksLikeWorkspace(fromEnv)) {
    saveState({ lastWorkspace: fromEnv });
    return fromEnv;
  }

  const state = loadState();

  if (state.lastWorkspace && looksLikeWorkspace(state.lastWorkspace)) {
    return state.lastWorkspace;
  }

  const registry = loadRegistry();
  const valid = registry.projects.filter((p) => looksLikeWorkspace(p.path));

  if (valid.length === 1) {
    const picked = valid[0]!.path;
    saveState({ lastWorkspace: picked });
    return picked;
  }

  if (valid.length > 1) {
    const labels = valid.map(
      (p) => `${p.name} (${p.location === "user_level" ? "user-level" : "in-repo"})`,
    );
    const buttons = [...labels, "Browse…", "Quit"];
    const browseId = labels.length;
    const quitId = labels.length + 1;
    const result = await dialog.showMessageBox(window, {
      type: "question",
      title: "Choose a Backlog workspace",
      message: "Which workspace would you like to open?",
      buttons,
      cancelId: quitId,
      defaultId: 0,
    });
    if (result.response === quitId) return undefined;
    if (result.response < browseId) {
      const picked = valid[result.response]!.path;
      saveState({ lastWorkspace: picked });
      return picked;
    }
    // result.response === browseId → fall through to Browse…
  }

  const browse = await dialog.showOpenDialog(window, {
    title: "Select a Backlog workspace folder",
    properties: ["openDirectory"],
    message: "Pick a folder containing .backlog/config.toml or a user-level workspace.",
  });
  if (browse.canceled || browse.filePaths.length === 0) return undefined;
  const picked = browse.filePaths[0]!;
  if (!looksLikeWorkspace(picked)) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "Not a Backlog workspace",
      message: `The folder ${picked} is not a Backlog workspace.`,
      detail: "Run `backlog init` in that folder first.",
    });
    return undefined;
  }
  saveState({ lastWorkspace: picked });
  return picked;
}
