#!/usr/bin/env node
import { Command } from "commander";
import { registerAgentCommand } from "./commands/agent.js";
import { runBoardCommand, registerBoardCommand } from "./commands/board.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerOrchestratorCommand } from "./commands/orchestrator.js";
import { registerRepoCommand } from "./commands/repo.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerRunCommand } from "./commands/run.js";
import { registerRunAlias } from "./commands/run-alias.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSourceCommand } from "./commands/source.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSubTaskCommand } from "./commands/subtask.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerWorktreeCommand } from "./commands/worktree.js";
import { maybeNotifyCliUpdate, runCliUpdate } from "./update-check.js";

declare const __BACKLOG_VERSION__: string;
// Replaced at build time by tsup's `define` from package.json#version.
// Falls back to "0.0.0-dev" when running via tsx/dev mode.
const VERSION = typeof __BACKLOG_VERSION__ !== "undefined" ? __BACKLOG_VERSION__ : "0.0.0-dev";

function normalizeCompatibilityArgv(argv: string[]): string[] {
  const normalized = [...argv];
  if (normalized[2] === "repository" || normalized[2] === "repos") {
    normalized[2] = "repositories";
  }
  for (let index = 2; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (!arg) continue;
    if (arg === "--repository") normalized[index] = "--repo";
    else if (arg.startsWith("--repository=")) normalized[index] = `--repo=${arg.slice("--repository=".length)}`;
    else if (arg === "--repository-root") normalized[index] = "--repo-root";
    else if (arg.startsWith("--repository-root=")) normalized[index] = `--repo-root=${arg.slice("--repository-root=".length)}`;
    else if (arg === "--repository-only") normalized[index] = "--repo-only";
    else if (arg.startsWith("--repository-only=")) normalized[index] = `--repo-only=${arg.slice("--repository-only=".length)}`;
    else if (arg === "--allow-repository") normalized[index] = "--allow-repo";
    else if (arg.startsWith("--allow-repository=")) normalized[index] = `--allow-repo=${arg.slice("--allow-repository=".length)}`;
  }
  return normalized;
}

const program = new Command();

program
  .name("backlog")
  .description("Backlog — orchestrator for AI coding agents. Claims, isolated worktrees, parallel runs.")
  .version(VERSION, "-v, --version");

program.hook("preAction", async (_thisCommand, actionCommand) => {
  await maybeNotifyCliUpdate(VERSION, actionCommand.name());
});

program
  .command("update")
  .description("Update the globally installed Backlog CLI")
  .action(runCliUpdate);

registerInitCommand(program);
registerDoctorCommand(program);
registerAgentCommand(program);
registerBoardCommand(program);
registerClaimCommand(program);
registerDaemonCommand(program);
registerHooksCommand(program);
registerMigrateCommand(program);
registerOrchestratorCommand(program);
registerRepoCommand(program);
registerReleaseCommand(program);
registerScheduleCommand(program);
registerSecretsCommand(program);
registerServeCommand(program);
registerStatusCommand(program);
registerSubTaskCommand(program);
registerRunCommand(program);
registerRunAlias(program);
registerSourceCommand(program);
registerTaskCommand(program);
registerProjectCommand(program);
registerWorktreeCommand(program);

program.action(async () => {
  await runBoardCommand();
});

program.parseAsync(normalizeCompatibilityArgv(process.argv)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
