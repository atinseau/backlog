import { updateRepo } from "./api.js";
import { t } from "./i18n.svelte.js";

export function isMissingRepoPathError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("enoent") ||
    lower.includes("no such file or directory") ||
    lower.includes("does not exist") ||
    lower.includes("cwd") && lower.includes("invalid")
  );
}

export async function pickReplacementRepoPath(repoId: string, currentPath: string): Promise<string | null> {
  const title = t("repos_view.relocate_picker", { repo: repoId });
  if (typeof window !== "undefined" && window.backlog?.pickFolder) {
    return window.backlog.pickFolder({ title, defaultPath: currentPath });
  }
  if (typeof window === "undefined") return null;
  const picked = window.prompt(t("repos_view.relocate_prompt", { repo: repoId }), currentPath);
  return picked?.trim() || null;
}

export async function relocateRepoPath(repoId: string, currentPath: string): Promise<boolean> {
  const picked = await pickReplacementRepoPath(repoId, currentPath);
  if (!picked || picked === currentPath) return false;
  await updateRepo(repoId, { path: picked });
  return true;
}
