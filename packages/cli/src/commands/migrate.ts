// `backlog migrate <subcommand>` — workspace migrations.
//
// Currently the only subcommand is `ids`, which renames legacy
// hex/timestamp IDs (TASK-c4bdf6ac, ST-9a2f, RUN-b71e, CLM-…-…) to
// the sequential type_NNN format introduced in 1.4. Designed to grow
// — future workspace migrations register here too.

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProject } from "@backlog/config";
import { migrateWorkspaceIds } from "@backlog/core";

function ymdHM(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

export function registerMigrateCommand(program: Command): void {
  const migrate = program
    .command("migrate")
    .description("Run a workspace migration");

  migrate
    .command("ids")
    .description(
      "Rename legacy IDs (TASK-…, ST-…, RUN-…, CLM-…) to the sequential " +
        "task_NNN / subtask_NNN / run_NNN / claim_NNN / sync_NNN format. " +
        "Backs up the workspace before mutating anything.",
    )
    .option("--dry-run", "Print what would be migrated without writing")
    .option("--no-backup", "Skip the safety backup (advanced; you've been warned)")
    .action(async (options: { dryRun?: boolean; backup?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const backlogDir = workspace.backlogDir;

      if (!options.dryRun && options.backup !== false) {
        const stamp = ymdHM();
        const backup = `${backlogDir}.pre-id-migration-${stamp}`;
        if (fs.existsSync(backup)) {
          throw new Error(
            `Backup ${backup} already exists. Move or remove it before re-running, or pass --no-backup.`,
          );
        }
        copyDirSync(backlogDir, backup);
        console.log(`Backup: ${backup}`);
      }

      if (options.dryRun) {
        // Run on a snapshot copy to compute the report without mutating.
        const tmp = `${backlogDir}.dry-run-${ymdHM()}`;
        copyDirSync(backlogDir, tmp);
        try {
          const report = await migrateWorkspaceIds(tmp);
          console.log("Dry-run summary (no changes written):");
          console.log(JSON.stringify(report, null, 2));
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
        return;
      }

      const report = await migrateWorkspaceIds(backlogDir);
      console.log("Migrated:");
      for (const [type, counts] of Object.entries(report)) {
        if (type === "renames") continue;
        const c = counts as { migrated: number; preserved: number };
        console.log(`  ${type.padEnd(8)}  +${c.migrated} renamed, ${c.preserved} already in new format`);
      }
      console.log(`Total renames: ${Object.keys(report.renames).length}`);
    });
}
