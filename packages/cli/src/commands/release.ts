import fs from "node:fs";
import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { buildReleaseSnapshot } from "@backlog/core";

function renderText(snapshot: Awaited<ReturnType<typeof buildReleaseSnapshot>>): string {
  return snapshot
    .map((repo) => `${repo.repo} | enabled=${repo.enabled} | ${repo.branch} | ${repo.head} | ${repo.tag ?? "no-tag"} | dirty=${repo.dirty} | active_runs=${repo.activeRuns} | archived_runs=${repo.archivedRuns}`)
    .join("\n");
}

function renderMarkdown(snapshot: Awaited<ReturnType<typeof buildReleaseSnapshot>>): string {
  const lines = [
    "| Repo | Enabled | Branch | Head | Tag | Dirty | Active runs | Archived runs |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const repo of snapshot) {
    lines.push(`| ${repo.repo} | ${repo.enabled ? "yes" : "no"} | ${repo.branch} | ${repo.head} | ${repo.tag ?? "no-tag"} | ${repo.dirty ? "yes" : "no"} | ${repo.activeRuns} | ${repo.archivedRuns} |`);
  }
  return lines.join("\n");
}

export function registerReleaseCommand(program: Command): void {
  const release = program.command("release").description("Inspect repo versions in the project");

  release
    .command("snapshot")
    .description("Capture a version snapshot for configured repos")
    .option("--repo <id>", "Only snapshot one configured repo")
    .option("--include-disabled", "Include disabled repos in the snapshot")
    .option("--dirty-only", "Only show repos with uncommitted changes")
    .option("--output <path>", "Write the rendered snapshot to a file")
    .option("--markdown", "Render a Markdown table")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: {
      repo?: string;
      includeDisabled?: boolean;
      json?: boolean;
      dirtyOnly?: boolean;
      markdown?: boolean;
      output?: string;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.json && options.markdown) {
        throw new Error("Use either --json or --markdown, not both.");
      }
      const config = loadConfig(workspace.backlogDir);
      if (options.repo && !config.repos.some((repo) => repo.id === options.repo)) {
        throw new Error(`Unknown repo: ${options.repo}`);
      }
      const snapshot = (await buildReleaseSnapshot(workspace.backlogDir, config, {
        ...(options.repo ? { repoId: options.repo } : {}),
        ...(options.includeDisabled ? { includeDisabled: true } : {}),
      }))
        .filter((repo) => !options.dirtyOnly || repo.dirty);

      if (options.json) {
        const rendered = JSON.stringify(snapshot, null, 2);
        if (options.output) {
          fs.writeFileSync(options.output, rendered + "\n", "utf8");
          console.log(`Wrote release snapshot to ${options.output}`);
          return;
        }
        console.log(rendered);
        return;
      }
      if (snapshot.length === 0) {
        const targetText = options.repo ? `repo ${options.repo}` : options.includeDisabled ? "configured repos" : "enabled repos";
        console.log(options.dirtyOnly ? `No dirty ${targetText} configured.` : `No ${targetText} configured.`);
        return;
      }
      if (options.markdown) {
        const rendered = renderMarkdown(snapshot);
        if (options.output) {
          fs.writeFileSync(options.output, rendered + "\n", "utf8");
          console.log(`Wrote release snapshot to ${options.output}`);
          return;
        }
        console.log(rendered);
        return;
      }

      const rendered = renderText(snapshot);
      if (options.output) {
        fs.writeFileSync(options.output, rendered + "\n", "utf8");
        console.log(`Wrote release snapshot to ${options.output}`);
        return;
      }
      console.log(rendered);
    });
}
