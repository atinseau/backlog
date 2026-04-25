#!/usr/bin/env node
import { Command } from "commander";
import { registerAgentCommand } from "./commands/agent.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerInitCommand } from "./commands/init.js";
import { registerRepoCommand } from "./commands/repo.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerRunCommand } from "./commands/run.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerSourceCommand } from "./commands/source.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerWorkCommand } from "./commands/work.js";
import { registerWorktreeCommand } from "./commands/worktree.js";

declare const __BACKLOG_VERSION__: string;
// Replaced at build time by tsup's `define` from package.json#version.
// Falls back to "0.0.0-dev" when running via tsx/dev mode.
const VERSION = typeof __BACKLOG_VERSION__ !== "undefined" ? __BACKLOG_VERSION__ : "0.0.0-dev";

const program = new Command();

program
  .name("backlog")
  .description("Backlog — turns planning inputs into safe agent execution.")
  .version(VERSION, "-v, --version");

registerInitCommand(program);
registerDoctorCommand(program);
registerAuthCommand(program);
registerAgentCommand(program);
registerClaimCommand(program);
registerHooksCommand(program);
registerRepoCommand(program);
registerReleaseCommand(program);
registerScheduleCommand(program);
registerStatusCommand(program);
registerTaskCommand(program);
registerRunCommand(program);
registerSourceCommand(program);
registerWorkCommand(program);
registerWorktreeCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
