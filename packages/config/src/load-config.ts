import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { workspaceConfigSchema, type WorkspaceConfig } from "@cockpit-ai/schemas";

export function loadConfig(cockpitDir: string): WorkspaceConfig {
  const configPath = path.join(cockpitDir, "config.toml");
  const raw = TOML.parse(fs.readFileSync(configPath, "utf8"));
  return workspaceConfigSchema.parse(raw);
}
