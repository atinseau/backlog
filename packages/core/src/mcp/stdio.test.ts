import { describe, expect, it } from "bun:test";
import { serveMcpOverStdio } from "./stdio.js";
import type { McpToolHost } from "./server.js";

/** Feeds the given lines as if they arrived on stdin, and collects what is written back. */
async function exchange(lines: string[], host: McpToolHost): Promise<unknown[]> {
  const written: string[] = [];
  await serveMcpOverStdio({
    host,
    input: (async function* () {
      for (const line of lines) yield line;
    })(),
    write: (line) => {
      written.push(line);
    },
  });
  return written.map((line) => JSON.parse(line) as unknown);
}

const host: McpToolHost = {
  tools: [{ name: "list_runs", description: "d", inputSchema: { type: "object" } }],
  callTool: async (name) => ({ ok: true, result: { called: name } }),
};

describe("serveMcpOverStdio", () => {
  it("answers one line per request", async () => {
    const responses = await exchange(
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      ],
      host,
    );

    expect(responses).toHaveLength(2);
    expect((responses[1] as { id: number }).id).toBe(2);
  });

  it("writes nothing for a notification", async () => {
    const responses = await exchange(
      [
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      ],
      host,
    );

    expect(responses).toHaveLength(1);
    expect((responses[0] as { id: number }).id).toBe(1);
  });

  it("ignores blank lines rather than answering them", async () => {
    expect(await exchange(["", "   ", ""], host)).toEqual([]);
  });

  it("reports malformed JSON as a parse error instead of dying", async () => {
    const responses = await exchange(["{not json"], host);

    expect((responses[0] as { error: { code: number } }).error.code).toBe(-32700);
  });

  it("keeps serving after a malformed line", async () => {
    const responses = await exchange(
      ["{not json", JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })],
      host,
    );

    expect(responses).toHaveLength(2);
    expect((responses[1] as { id: number }).id).toBe(9);
  });

  it("preserves request order in its answers", async () => {
    const responses = await exchange(
      [1, 2, 3].map((id) => JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })),
      host,
    );

    expect(responses.map((response) => (response as { id: number }).id)).toEqual([1, 2, 3]);
  });
});
