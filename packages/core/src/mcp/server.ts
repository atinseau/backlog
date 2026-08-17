// A minimal MCP tool server. Only the three methods a tool provider needs —
// initialize, tools/list, tools/call — spoken as JSON-RPC 2.0. Written by hand
// rather than pulled from the SDK because the surface is this small and the
// binary ships everything it depends on.

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_NAME = "backlog";

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolOutcome {
  /** False marks the result as an error the model can read and react to. */
  ok: boolean;
  result: unknown;
}

export interface McpToolHost {
  tools: McpToolDefinition[];
  callTool: (name: string, input: unknown) => Promise<McpToolOutcome>;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  /** Absent on notifications, which take no reply. */
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string } };

function ok(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: number | string, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Tool results travel as text content; JSON keeps them machine-readable. */
function toolContent(outcome: McpToolOutcome): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.result) }],
    ...(outcome.ok ? {} : { isError: true }),
  };
}

async function handleToolCall(
  id: number | string,
  params: Record<string, unknown>,
  host: McpToolHost,
): Promise<JsonRpcResponse> {
  const name = String(params["name"] ?? "");
  if (!host.tools.some((tool) => tool.name === name)) {
    return fail(id, INVALID_PARAMS, `Unknown tool: ${name}`);
  }
  try {
    return ok(id, toolContent(await host.callTool(name, params["arguments"] ?? {})));
  } catch (error) {
    return fail(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle one JSON-RPC message.
 * @returns the response to write back, or null for a notification.
 */
export async function handleMcpRequest(
  request: JsonRpcRequest,
  host: McpToolHost,
): Promise<JsonRpcResponse | null> {
  const params = request.params ?? {};

  // Notifications carry no id and expect no answer.
  if (request.id === undefined) return null;

  switch (request.method) {
    case "initialize":
      return ok(request.id, {
        // Agreeing to the client's version keeps us compatible with older ones.
        protocolVersion: String(params["protocolVersion"] ?? MCP_PROTOCOL_VERSION),
        capabilities: { tools: {} },
        serverInfo: { name: MCP_SERVER_NAME, version: "1" },
      });
    case "ping":
      return ok(request.id, {});
    case "tools/list":
      return ok(request.id, { tools: host.tools });
    case "tools/call":
      return handleToolCall(request.id, params, host);
    default:
      return fail(request.id, METHOD_NOT_FOUND, `Unsupported method: ${request.method}`);
  }
}
