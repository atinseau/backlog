import { updateRepository } from "./api.js";
import { t } from "./i18n.svelte.js";

export function isMissingRepositoryPathError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("enoent") ||
    lower.includes("no such file or directory") ||
    lower.includes("does not exist") ||
    lower.includes("cwd") && lower.includes("invalid")
  );
}

export async function pickReplacementRepositoryPath(repositoryId: string, currentPath: string): Promise<string | null> {
  const title = t("repos_view.relocate_picker", { repository: repositoryId });
  if (typeof window !== "undefined" && window.backlog?.pickFolder) {
    return window.backlog.pickFolder({ title, defaultPath: currentPath });
  }
  if (typeof window === "undefined") return null;
  const picked = window.prompt(t("repos_view.relocate_prompt", { repository: repositoryId }), currentPath);
  return picked?.trim() || null;
}

export async function relocateRepositoryPath(repositoryId: string, currentPath: string): Promise<boolean> {
  const picked = await pickReplacementRepositoryPath(repositoryId, currentPath);
  if (!picked || picked === currentPath) return false;
  await updateRepository(repositoryId, { path: picked });
  return true;
}
