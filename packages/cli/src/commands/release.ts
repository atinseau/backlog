import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildReleaseSnapshot } from "@cockpit-ai/core";

export function registerReleaseCommand(program: Command): void {
  const release = program.command("release").description("Inspect repo versions in the workspace");

  release
    .command("snapshot")
    .description("Capture a version snapshot for all enabled repos")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const snapshot = await buildReleaseSnapshot(config);
      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }
      if (snapshot.length === 0) {
        console.log("No enabled repos configured.");
        return;
      }
      for (const repo of snapshot) {
        console.log(`${repo.repo} | ${repo.branch} | ${repo.head} | ${repo.tag ?? "no-tag"}`);
      }
    });
}
