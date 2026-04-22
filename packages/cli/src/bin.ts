#!/usr/bin/env node
import { Command } from "commander";
import { registerClaimCommand } from "./commands/claim.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerHooksCommand } from "./commands/hooks.js";
import { registerInitCommand } from "./commands/init.js";
import { registerStatusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("cockpit")
  .description("Local-first AI execution control plane for coding teams")
  .version("0.1.0");

registerInitCommand(program);
registerDoctorCommand(program);
registerClaimCommand(program);
registerHooksCommand(program);
registerStatusCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
