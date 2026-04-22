import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildReleaseSnapshot } from "@cockpit-ai/core";

export function registerReleaseCommand(program: Command): void {
  const release = program.command("release").description("Inspect repo versions in the workspace");

  release
    .command("snapshot")
    .description("Capture a version snapshot for all enabled repos")
    .option("--dirty-only", "Only show repos with uncommitted changes")
    .option("--markdown", "Render a Markdown table")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean; dirtyOnly?: boolean; markdown?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const snapshot = (await buildReleaseSnapshot(workspace.cockpitDir, config))
        .filter((repo) => !options.dirtyOnly || repo.dirty);
      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }
      if (snapshot.length === 0) {
        console.log(options.dirtyOnly ? "No dirty enabled repos configured." : "No enabled repos configured.");
        return;
      }
      if (options.markdown) {
        console.log("| Repo | Branch | Head | Tag | Dirty | Active runs | Archived runs |");
        console.log("| --- | --- | --- | --- | --- | --- | --- |");
        for (const repo of snapshot) {
          console.log(`| ${repo.repo} | ${repo.branch} | ${repo.head} | ${repo.tag ?? "no-tag"} | ${repo.dirty ? "yes" : "no"} | ${repo.activeRuns} | ${repo.archivedRuns} |`);
        }
        return;
      }
      for (const repo of snapshot) {
        console.log(`${repo.repo} | ${repo.branch} | ${repo.head} | ${repo.tag ?? "no-tag"} | dirty=${repo.dirty} | active_runs=${repo.activeRuns} | archived_runs=${repo.archivedRuns}`);
      }
    });
}
