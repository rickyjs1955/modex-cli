import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAllTools } from './tools/index.js';

export const SERVER_NAME = 'modex-mcp';
export const SERVER_VERSION = '0.4.0';

// Build an MCP server with every modex tool registered. Transport is the
// caller's choice — `runStdio` wires stdio for the CLI entry; tests construct
// a server and exercise tool handlers directly.
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerAllTools(server);
  return server;
}

// Boot the server on stdio. Returns when the transport closes (host
// disconnects). The MCP host owns the lifetime — we don't install signal
// handlers; the host's exit propagates to this process via stdin close.
export async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { registerAllTools } from './tools/index.js';
