import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { ClaudeCodeProvider } from "./provider.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claude-completion-"));
}

/** A stand-in `claude` that echoes one `--output-format json` payload. */
function fakeClaude(dir: string, payload: Record<string, unknown>, exitCode = 0): string {
  const binary = path.join(dir, "fake-claude.sh");
  fs.writeFileSync(
    binary,
    ["#!/usr/bin/env bash", "cat > /dev/null", `cat <<'JSON'`, JSON.stringify(payload), "JSON", `exit ${exitCode}`].join("\n"),
    "utf8",
  );
  fs.chmodSync(binary, 0o755);
  return binary;
}

/** Captures stdin so we can assert the prompt never travels through argv. */
function stdinRecordingClaude(dir: string, payload: Record<string, unknown>): { binary: string; stdinFile: string } {
  const binary = path.join(dir, "stdin-claude.sh");
  const stdinFile = path.join(dir, "stdin.txt");
  fs.writeFileSync(
    binary,
    [
      "#!/usr/bin/env bash",
      `cat > ${JSON.stringify(stdinFile)}`,
      `cat <<'JSON'`,
      JSON.stringify(payload),
      "JSON",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(binary, 0o755);
  return { binary, stdinFile };
}

/** Records the argv the CLI was invoked with, so flag choices stay observable. */
function argvRecordingClaude(dir: string, payload: Record<string, unknown>): { binary: string; argvFile: string } {
  const binary = path.join(dir, "recording-claude.sh");
  const argvFile = path.join(dir, "argv.txt");
  fs.writeFileSync(
    binary,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`,
      "cat > /dev/null",
      `cat <<'JSON'`,
      JSON.stringify(payload),
      "JSON",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(binary, 0o755);
  return { binary, argvFile };
}

const provider = new ClaudeCodeProvider({ executableExists: () => true });
const noSecrets = () => null;

describe("ClaudeCodeProvider.complete", () => {
  it("returns the model's answer as plain text", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: "Fix the topbar dropdown", usage: { input_tokens: 10, output_tokens: 4 } });

    const completion = await provider.complete({
      prompt: "name this task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(completion.text).toBe("Fix the topbar dropdown");
  });

  it("reports token usage so the call shows up in cost reporting", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: "x", usage: { input_tokens: 10, output_tokens: 4 } });

    const completion = await provider.complete({ prompt: "p", command: binary, cwd: dir, getSecret: noSecrets });

    expect(completion.usage).toMatchObject({ input_tokens: 10, output_tokens: 4 });
  });

  it("answers directly instead of exploring the checkout", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = argvRecordingClaude(dir, { result: "x" });

    await provider.complete({ prompt: "p", command: binary, cwd: dir, getSecret: noSecrets });
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");

    expect(argv).toContain("--disallowedTools");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("json");
  });

  it("uses the caller's system prompt rather than the coding-agent default", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = argvRecordingClaude(dir, { result: "x" });

    await provider.complete({
      prompt: "p",
      systemPrompt: "You name things.",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");

    expect(argv[argv.indexOf("--system-prompt") + 1]).toBe("You name things.");
  });

  it("fails loudly when the CLI exits non-zero", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: "" }, 1);

    await expect(
      provider.complete({ prompt: "p", command: binary, cwd: dir, getSecret: noSecrets }),
    ).rejects.toThrow(/exit code 1/);
  });

  it("fails when the CLI returns an empty answer", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: "   " });

    await expect(
      provider.complete({ prompt: "p", command: binary, cwd: dir, getSecret: noSecrets }),
    ).rejects.toThrow(/empty/i);
  });
});

describe("ClaudeCodeProvider.completeStructured", () => {
  const schema = {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  } as const;

  it("parses the JSON object the model produced", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: '{"title":"Add the widget"}' });

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(structured.value).toEqual({ title: "Add the widget" });
  });

  it("tolerates a fenced code block around the JSON", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: '```json\n{"title":"Add the widget"}\n```' });

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(structured.value).toEqual({ title: "Add the widget" });
  });

  it("tolerates a sentence wrapped around the JSON", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: 'Here you go: {"title":"Add the widget"} — hope that helps.' });

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(structured.value).toEqual({ title: "Add the widget" });
  });

  it("lets the CLI enforce the schema rather than asking for JSON in prose", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = argvRecordingClaude(dir, { result: '{"title":"x"}' });

    await provider.completeStructured({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");

    expect(JSON.parse(argv[argv.indexOf("--json-schema") + 1]!)).toEqual(schema);
  });

  it("prefers the object the CLI already parsed over re-parsing the text", async () => {
    const dir = scratchDir();
    // The text says one thing, structured_output another: whichever wins tells
    // us which path the provider took.
    const binary = fakeClaude(dir, {
      result: '{"title":"from text"}',
      structured_output: { title: "from structured_output" },
    });

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(structured.value).toEqual({ title: "from structured_output" });
  });

  it("falls back to parsing the text when the CLI is too old for --json-schema", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: '{"title":"from text"}' });

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema: schema as unknown as Record<string, unknown>,
      schemaName: "task",
      command: binary,
      cwd: dir,
      getSecret: noSecrets,
    });

    expect(structured.value).toEqual({ title: "from text" });
  });

  it("sends the prompt on stdin, not in argv", async () => {
    const dir = scratchDir();
    const { binary, stdinFile } = stdinRecordingClaude(dir, { result: "ok" });

    await provider.complete({ prompt: "name this task", command: binary, cwd: dir, getSecret: noSecrets });

    expect(fs.readFileSync(stdinFile, "utf8")).toBe("name this task");
  });

  it("reports unparseable output instead of returning garbage", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { result: "I could not do that." });

    await expect(
      provider.completeStructured({
        prompt: "p",
        schema: schema as unknown as Record<string, unknown>,
        schemaName: "task",
        command: binary,
        cwd: dir,
        getSecret: noSecrets,
      }),
    ).rejects.toThrow(/JSON/i);
  });
});
