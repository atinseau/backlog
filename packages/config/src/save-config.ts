import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import type { WorkspaceConfig } from "@backlog/schemas";

export function saveConfig(backlogDir: string, config: WorkspaceConfig): string {
  const configPath = path.join(backlogDir, "config.toml");
  const serialized = TOML.stringify(config as unknown as TOML.JsonMap);
  fs.writeFileSync(configPath, serialized, "utf8");
  return configPath;
}
