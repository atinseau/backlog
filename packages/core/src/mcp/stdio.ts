import { handleMcpRequest, type JsonRpcRequest, type McpToolHost } from "./server.js";

// MCP over stdio: one JSON message per line in, one per line out. Requests are
// answered in order — a tool that starts a run must not overtake the read that
// was meant to precede it.

const PARSE_ERROR = -32700;

export interface StdioServerInput {
  host: McpToolHost;
  /** Lines arriving on stdin, without their trailing newline. */
  input: AsyncIterable<string>;
  /** Writes one response line. The newline is added by the caller's transport. */
  write: (line: string) => void;
}

async function* linesOf(stream: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

export async function serveMcpOverStdio(input: StdioServerInput): Promise<void> {
  for await (const line of input.input) {
    if (!line.trim()) continue;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      // A parse error has no id to answer to; null is what JSON-RPC prescribes.
      input.write(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Invalid JSON" } }),
      );
      continue;
    }

    const response = await handleMcpRequest(request, input.host);
    if (response) input.write(JSON.stringify(response));
  }
}

/** Wire the server to the real process stdin/stdout. */
export async function serveMcpOnProcessStdio(host: McpToolHost): Promise<void> {
  await serveMcpOverStdio({
    host,
    input: linesOf(Bun.stdin.stream()),
    write: (line) => {
      // stdout is the protocol channel: nothing else may ever be written there.
      process.stdout.write(`${line}\n`);
    },
  });
}
