import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { workspaceConfigSchema, type WorkspaceConfig } from "@backlog/schemas";

export function loadConfig(backlogDir: string): WorkspaceConfig {
  const configPath = path.join(backlogDir, "config.toml");
  const raw = TOML.parse(fs.readFileSync(configPath, "utf8"));
  return workspaceConfigSchema.parse(raw);
}
