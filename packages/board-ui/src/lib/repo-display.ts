import type { Repo } from "./types.js";

export function basename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed || "";
}

export function repoDisplayName(repo: Pick<Repo, "id" | "path" | "name">): string {
  return repo.name?.trim() || basename(repo.path) || repo.id;
}

export function repoIdentityHint(repo: Pick<Repo, "id" | "path" | "name">): string | null {
  const display = repoDisplayName(repo);
  return display === repo.id ? null : repo.id;
}
