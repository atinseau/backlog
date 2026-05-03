import { app, dialog, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadRegistry } from "@backlog/config";

interface DesktopState {
  lastProject?: string;
  /** Legacy state key from before workspaces were renamed projects. */
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

function looksLikeProject(p: string): boolean {
  if (!existsSync(p)) return false;
  if (existsSync(path.join(p, "config.toml"))) return true;
  if (existsSync(path.join(p, ".backlog", "config.toml"))) return true;
  return false;
}

export function rememberProject(projectPath: string): boolean {
  if (!looksLikeProject(projectPath)) return false;
  saveState({ lastProject: projectPath });
  return true;
}

/** @deprecated Use rememberProject. */
export const rememberWorkspace = rememberProject;

export async function resolveProject(window: BrowserWindow): Promise<string | undefined> {
  // Override hook for smoke tests, scripted launches, and "Open With…" flows.
  const fromEnv = process.env.BACKLOG_DESKTOP_PROJECT ?? process.env.BACKLOG_DESKTOP_WORKSPACE;
  if (fromEnv && looksLikeProject(fromEnv)) {
    rememberProject(fromEnv);
    return fromEnv;
  }

  const state = loadState();

  const savedProject = state.lastProject ?? state.lastWorkspace;
  if (savedProject && looksLikeProject(savedProject)) {
    return savedProject;
  }

  const registry = loadRegistry();
  const valid = registry.projects.filter((p) => looksLikeProject(p.path));

  if (valid.length > 0) {
    const [picked] = valid.sort(
      (a, b) => Date.parse(b.last_opened_at ?? b.added_at) - Date.parse(a.last_opened_at ?? a.added_at),
    );
    return picked?.path;
  }

  const browse = await dialog.showOpenDialog(window, {
    title: "Select a Backlog project folder",
    properties: ["openDirectory"],
    message: "Pick a folder containing .backlog/config.toml or a user-level project.",
  });
  if (browse.canceled || browse.filePaths.length === 0) return undefined;
  const picked = browse.filePaths[0]!;
  if (!looksLikeProject(picked)) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "Not a Backlog project",
      message: `The folder ${picked} is not a Backlog project.`,
      detail: "Run `backlog init` in that folder first.",
    });
    return undefined;
  }
  rememberProject(picked);
  return picked;
}

/** @deprecated Use resolveProject. */
export const resolveWorkspace = resolveProject;
