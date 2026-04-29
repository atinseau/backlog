#!/usr/bin/env node
import { Command } from "commander";
import { registerAgentCommand } from "./commands/agent.js";
import { registerBoardCommand } from "./commands/board.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerDaemonCommand } from "./commands/daemon.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerInitCommand } from "./commands/init.js";
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

declare const __BACKLOG_VERSION__: string;
// Replaced at build time by tsup's `define` from package.json#version.
// Falls back to "0.0.0-dev" when running via tsx/dev mode.
const VERSION = typeof __BACKLOG_VERSION__ !== "undefined" ? __BACKLOG_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("backlog")
  .description("Backlog — orchestrator for AI coding agents. Claims, isolated worktrees, parallel runs.")
  .version(VERSION, "-v, --version");

registerInitCommand(program);
registerDoctorCommand(program);
registerAgentCommand(program);
registerBoardCommand(program);
registerClaimCommand(program);
registerDaemonCommand(program);
registerHooksCommand(program);
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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
