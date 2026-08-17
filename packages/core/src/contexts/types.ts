export type AgentContextId = "execution" | "orchestrator" | "completion";
export type McpAudience = "execution" | "orchestrator";

export interface AgentContext {
  /** Which tool set the MCP server should serve, or null for no server at all. */
  mcpAudience: McpAudience | null;
  /** The tool names that audience resolves to. The MCP server owns the
   *  authoritative copy; this one exists so the table can be asserted and so
   *  callers can build --allowedTools without spawning anything. */
  mcpTools: readonly string[];
  /** What the session may not use, in the runtime's own deny syntax. An entry
   *  is either a bare built-in tool name (`"Bash"`, denying the tool outright)
   *  or a permission specifier scoping one (`"Bash(backlog:*)"`, denying only
   *  matching invocations). */
  deniedBuiltins: readonly string[];
  /** Whether the user's own MCP servers stay reachable. */
  userMcpServers: "visible" | "hidden";
  /** Exported as BACKLOG_AGENT_ROLE, or null to export nothing. */
  cliRole: "execution" | null;
}
