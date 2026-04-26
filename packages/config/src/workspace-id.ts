import crypto from "node:crypto";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";

export function generateWorkspaceId(): string {
  return `WS-${crypto.randomBytes(4).toString("hex")}`;
}

// Returns the workspace's stable id, generating + persisting one if the
// config predates the workspace_id field. Idempotent.
export function ensureWorkspaceId(backlogDir: string): string {
  const config = loadConfig(backlogDir);
  if (config.workspace_id) return config.workspace_id;
  const id = generateWorkspaceId();
  saveConfig(backlogDir, { ...config, workspace_id: id });
  return id;
}
