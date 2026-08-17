import fs from "node:fs";
import path from "node:path";
import type { Agent } from "@backlog/schemas";
import { parseCodexJsonStream } from "../../provider-usage.js";
import { describeProcessFailure, resolveExecutable, spawnStreaming } from "../process.js";
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderModelChoice,
  ProviderReadiness,
  ProviderReadinessInput,
  ProviderReasoningSupport,
  ProviderRunRequest,
  ProviderRunResult,
} from "../types.js";
import { parseCodexStreamLine } from "./stream.js";

export const CODEX_PROVIDER_ID = "codex";
export const OPENAI_API_KEY = "OPENAI_API_KEY";

const DEFAULT_EXECUTABLE = "codex";
const DEFAULT_SANDBOX = "workspace-write";
/** Named so it does not collide with the run's own artifacts at commit time. */
const LAST_MESSAGE_FILE = ".backlog-codex-last-message.md";

const CODEX_MODELS: ProviderModelChoice[] = [
  { value: "gpt-5.5", label: "GPT-5.5", family: "gpt-5.5", description: "Strongest current Codex model." },
  { value: "gpt-5.4", label: "GPT-5.4", family: "gpt-5.4", description: "Frontier fallback for agentic coding." },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", family: "gpt-5.4-mini", description: "Fast and cheap for lighter tasks." },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", family: "gpt-5.3-codex", description: "Previous coding-focused model." },
];

const CODEX_REASONING: ProviderReasoningSupport = {
  supported: true,
  allowsCustom: true,
  defaultLevel: "medium",
  levels: [
    { value: "minimal", label: "minimal", description: "Barely any deliberation." },
    { value: "low", label: "low", description: "Cheapest useful setting." },
    { value: "medium", label: "medium", description: "Default balance." },
    { value: "high", label: "high", description: "More deliberation." },
    { value: "xhigh", label: "xhigh", description: "Maximum deliberation." },
  ],
};

function codexExecutableFor(agent: Pick<Agent, "command">): string {
  const command = agent.command?.trim();
  return command && command.length > 0 ? command : DEFAULT_EXECUTABLE;
}

export interface CodexProviderDeps {
  executableExists: (command: string) => boolean;
}

/**
 * OpenAI Codex as a Backlog runtime. Unlike Claude Code it holds no session
 * of its own, so an API key is a genuine prerequisite here.
 */
export class CodexProvider implements AgentProvider {
  readonly id = CODEX_PROVIDER_ID;
  readonly aliases = ["openai"] as const;

  constructor(private readonly deps: CodexProviderDeps) {}

  describe(): ProviderDescriptor {
    return {
      id: this.id,
      displayName: "Codex",
      models: CODEX_MODELS,
      reasoning: CODEX_REASONING,
      authModes: ["api_key"],
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
      capabilities: { executeRun: true, textCompletion: false, structuredOutput: false },
      requiresCommand: false,
    };
  }

  checkReadiness(input: ProviderReadinessInput): ProviderReadiness {
    const reasons: string[] = [];
    const executable = codexExecutableFor(input.agent);
    if (!this.deps.executableExists(executable)) {
      reasons.push(`missing_executable:${executable}`);
    }
    // Deliberately the stored secret only: a key that happens to sit in the
    // server's shell is not a project-level configuration, and treating it as
    // one would make readiness depend on how the server was launched.
    if (!input.getSecret(OPENAI_API_KEY)) {
      reasons.push(`missing_api_key:${OPENAI_API_KEY}`);
    }
    return { ready: reasons.length === 0, reasons };
  }

  async executeRun(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const { agent } = request;
    const scratchDir = request.scratchDir ?? request.cwd;
    const lastMessagePath = path.join(scratchDir, LAST_MESSAGE_FILE);

    const args = ["exec", "--skip-git-repo-check", "--json", "--output-last-message", lastMessagePath];
    if (agent.model?.trim()) {
      args.push("--model", agent.model.trim());
    }
    if (request.reasoningEffort?.trim()) {
      args.push("-c", `model_reasoning_effort="${request.reasoningEffort.trim()}"`);
    }
    if (agent.profile?.trim()) {
      args.push("--profile", agent.profile.trim());
    }
    args.push("--sandbox", agent.sandbox_mode ?? DEFAULT_SANDBOX);
    // `-` tells codex to read the prompt from stdin.
    args.push("--cd", request.cwd, "-");

    const spawned = await spawnStreaming({
      executable: resolveExecutable(codexExecutableFor(agent)),
      args,
      cwd: request.cwd,
      env: this.environmentFor(request),
      input: request.prompt,
      onLine: (line) => {
        for (const event of parseCodexStreamLine(line)) {
          request.onActivity(event);
        }
      },
    });

    const summary = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, "utf8").trim() : "";
    const ok = spawned.exitCode === 0;

    return {
      ok,
      summary: summary.length > 0 ? summary : null,
      usage: parseCodexJsonStream(spawned.stdout, agent.model ?? this.id),
      stdout: spawned.stdout,
      stderr: spawned.stderr,
      ...(ok ? {} : { failure: describeProcessFailure(spawned) }),
    };
  }

  private environmentFor(request: ProviderRunRequest): NodeJS.ProcessEnv {
    const stored = request.getSecret(OPENAI_API_KEY);
    // The shell wins, matching the historical precedence in buildProviderEnv.
    return request.env[OPENAI_API_KEY] || !stored
      ? request.env
      : { ...request.env, [OPENAI_API_KEY]: stored };
  }
}
