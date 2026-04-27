import crypto from "node:crypto";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";

export function generateProjectId(): string {
  return `WS-${crypto.randomBytes(4).toString("hex")}`;
}

// Returns the workspace's stable id, generating + persisting one if the
// config predates the project_id field. Idempotent.
export function ensureProjectId(backlogDir: string): string {
  const config = loadConfig(backlogDir);
  if (config.project_id) return config.project_id;
  const id = generateProjectId();
  saveConfig(backlogDir, { ...config, project_id: id });
  return id;
}
