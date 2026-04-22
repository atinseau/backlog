#!/usr/bin/env node
import { Command } from "commander";
import { registerAgentCommand } from "./commands/agent.js";
import { registerClaimCommand } from "./commands/claim.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerInitCommand } from "./commands/init.js";
import { registerRunCommand } from "./commands/run.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerWorkCommand } from "./commands/work.js";

const program = new Command();

program
  .name("cockpit")
  .description("Local-first AI execution control plane for coding teams")
  .version("0.1.0");

registerInitCommand(program);
registerDoctorCommand(program);
registerAgentCommand(program);
registerClaimCommand(program);
registerHooksCommand(program);
registerScheduleCommand(program);
registerStatusCommand(program);
registerTaskCommand(program);
registerRunCommand(program);
registerWorkCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
