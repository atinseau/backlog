import { describe, expect, it } from "bun:test";
import { handleMcpRequest, MCP_PROTOCOL_VERSION } from "./server.js";

// The subset of MCP that a stdio tool server needs: initialize, tools/list,
// tools/call, plus the notification that follows initialize.

const noTools = {
  tools: [],
  callTool: async () => ({ ok: true, result: {} }),
};

function tools(names: string[]) {
  return {
    tools: names.map((name) => ({
      name,
      description: `does ${name}`,
      inputSchema: { type: "object", properties: {}, required: [] },
    })),
    callTool: async (name: string, input: unknown) => ({ ok: true, result: { called: name, input } }),
  };
}

describe("initialize", () => {
  it("answers with the protocol version and the tools capability", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, noTools);

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } },
    });
  });

  it("names the server so it is identifiable in a client's logs", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, noTools);

    expect((response as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("backlog");
  });

  it("echoes back a client's protocol version when it sends one", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      noTools,
    );

    expect((response as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2024-11-05");
  });

  it("stays silent on the notification that follows, as notifications have no reply", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, noTools);

    expect(response).toBeNull();
  });
});

describe("tools/list", () => {
  it("lists every tool with its schema", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      tools(["list_runs", "start_subtask"]),
    );
    const result = (response as { result: { tools: Array<{ name: string; inputSchema: unknown }> } }).result;

    expect(result.tools.map((tool) => tool.name)).toEqual(["list_runs", "start_subtask"]);
    expect(result.tools[0]?.inputSchema).toEqual({ type: "object", properties: {}, required: [] });
  });
});

describe("tools/call", () => {
  it("returns the tool's result as JSON text content", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_runs", arguments: { a: 1 } } },
      tools(["list_runs"]),
    );
    const result = (response as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } }).result;

    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]!.text)).toEqual({ called: "list_runs", input: { a: 1 } });
    expect(result.isError).toBeUndefined();
  });

  it("marks a refusal as an error result, not a protocol error", async () => {
    // The confirmation gate answers ok:false. The model must see the refusal
    // text and be able to try again, so it belongs in the result, not in a
    // JSON-RPC error that would abort the turn.
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "gated", arguments: {} } },
      {
        tools: [{ name: "gated", description: "d", inputSchema: { type: "object" } }],
        callTool: async () => ({ ok: false, result: { status: "awaiting_confirmation" } }),
      },
    );
    const result = (response as { result: { isError: boolean; content: Array<{ text: string }> } }).result;

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ status: "awaiting_confirmation" });
  });

  it("defaults missing arguments to an empty object", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_runs" } },
      tools(["list_runs"]),
    );
    const result = (response as { result: { content: Array<{ text: string }> } }).result;

    expect(JSON.parse(result.content[0]!.text)).toEqual({ called: "list_runs", input: {} });
  });

  it("reports an unknown tool as a JSON-RPC error", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } },
      tools(["list_runs"]),
    );

    expect((response as { error: { code: number; message: string } }).error.code).toBe(-32602);
  });

  it("turns a thrown handler into a JSON-RPC error rather than crashing", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "boom" } },
      {
        tools: [{ name: "boom", description: "d", inputSchema: { type: "object" } }],
        callTool: async () => {
          throw new Error("kaboom");
        },
      },
    );

    expect((response as { error: { message: string } }).error.message).toContain("kaboom");
  });
});

describe("unknown methods", () => {
  it("answers method-not-found for a request", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 8, method: "resources/list" }, noTools);

    expect((response as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("stays silent for an unknown notification", async () => {
    expect(await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/cancelled" }, noTools)).toBeNull();
  });
});
