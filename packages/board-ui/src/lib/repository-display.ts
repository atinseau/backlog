import type { Repository } from "./types.js";

export function basename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || trimmed || "";
}

export function repositoryDisplayName(repo: Pick<Repository, "id" | "path" | "checkout_path" | "remote_url" | "name">): string {
  return repo.name?.trim() || basename(repo.checkout_path ?? repo.path ?? repo.remote_url ?? "") || repo.id;
}

export function repositoryIdentityHint(repo: Pick<Repository, "id" | "path" | "checkout_path" | "remote_url" | "name">): string | null {
  const display = repositoryDisplayName(repo);
  return display === repo.id ? null : repo.id;
}
