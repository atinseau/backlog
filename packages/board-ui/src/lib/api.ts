import type { BoardResponse } from "./types.js";

const BASE = "/api/v1";

export async function fetchBoard(repo?: string): Promise<BoardResponse> {
  const url = new URL(`${BASE}/board`, window.location.origin);
  if (repo) url.searchParams.set("repo", repo);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Board fetch failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BoardResponse;
}

export async function fetchHealth(): Promise<{ ok: boolean; workspace: string; version: string }> {
  const response = await fetch(`${BASE}/health`);
  if (!response.ok) throw new Error(`Health failed: ${response.status}`);
  return response.json();
}
