import { execa } from "execa";
import { describeProcessFailure } from "../process.js";
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderReadiness,
  ProviderReadinessInput,
  ProviderRunRequest,
  ProviderRunResult,
} from "../types.js";

export const CUSTOM_PROVIDER_ID = "custom";

/**
 * Escape hatch for any runtime Backlog does not model: the agent supplies a
 * shell command and owns its own credentials, models and reasoning. Backlog
 * only tells it what to do — on stdin and in BACKLOG_PROMPT — and reads its
 * exit code.
 */
export class CustomProvider implements AgentProvider {
  readonly id = CUSTOM_PROVIDER_ID;
  readonly aliases = [] as const;

  describe(): ProviderDescriptor {
    return {
      id: this.id,
      displayName: "Custom command",
      models: [],
      reasoning: { supported: false, levels: [], allowsCustom: false },
      authModes: ["auto"],
      sandboxModes: [],
      capabilities: { executeRun: true, textCompletion: false, structuredOutput: false },
      requiresCommand: true,
    };
  }

  checkReadiness(input: ProviderReadinessInput): ProviderReadiness {
    const reasons = input.agent.command?.trim() ? [] : ["missing_command"];
    return { ready: reasons.length === 0, reasons };
  }

  async executeRun(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const command = request.agent.command?.trim();
    if (!command) {
      throw new Error(`Custom agent ${request.agent.id} is missing a command.`);
    }

    const result = await execa(command, {
      cwd: request.cwd,
      env: { ...request.env, BACKLOG_PROMPT: request.prompt },
      // `request.env` is already `process.env` plus everything the run
      // pipeline decided, so extending it again adds nothing — except that it
      // resurrects the variables the pipeline deliberately removed.
      // BACKLOG_AGENT_ROLE is the one that matters: run-executor clears it so
      // that only a runtime handing out the MCP façade can close the Backlog
      // CLI, and execa's default would have handed it straight back.
      extendEnv: false,
      input: request.prompt,
      shell: true,
      reject: false,
    });

    const spawned = {
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    const ok = spawned.exitCode === 0;
    const summary = spawned.stdout.trim();

    return {
      ok,
      summary: summary.length > 0 ? summary : null,
      usage: null,
      stdout: spawned.stdout,
      stderr: spawned.stderr,
      ...(ok ? {} : { failure: describeProcessFailure(spawned) }),
    };
  }
}
