import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import { projectConfigSchema, type ProjectConfig } from "@backlog/schemas";

const LEGACY_KEY_RENAMES: Record<string, string> = {
  workspace_name: "project_name",
  workspace_mode: "project_mode",
  workspace_id: "project_id",
};

// In-place migrate raw TOML keys from the old "workspace_*" naming to the new
// "project_*" naming. Returns true when at least one key was rewritten.
function migrateLegacyKeys(raw: Record<string, unknown>): boolean {
  let changed = false;
  for (const [legacy, fresh] of Object.entries(LEGACY_KEY_RENAMES)) {
    if (legacy in raw && !(fresh in raw)) {
      raw[fresh] = raw[legacy];
      delete raw[legacy];
      changed = true;
    }
  }
  return changed;
}

export function loadConfig(backlogDir: string): ProjectConfig {
  const configPath = path.join(backlogDir, "config.toml");
  const raw = TOML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const migrated = migrateLegacyKeys(raw);
  const config = projectConfigSchema.parse(raw);
  if (migrated) {
    fs.writeFileSync(configPath, TOML.stringify(config as unknown as TOML.JsonMap), "utf8");
  }
  return config;
}
