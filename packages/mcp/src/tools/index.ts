import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAgentsCreateTool, registerAgentsListTool } from './agents.js';
import {
  registerAspirationsAddTool,
  registerAspirationsListTool,
} from './aspirations.js';
import { registerBindTool } from './bind.js';
import { registerCiteTool } from './cite.js';
import {
  registerEvalAddTool,
  registerEvalListTool,
  registerEvalResultsTool,
  registerEvalRunTool,
} from './evals.js';
import { registerFeedTool } from './feed.js';

// Login / logout deliberately omitted from the MCP surface: device-code
// auth needs a browser tab and a user reading a code from terminal output,
// which doesn't translate cleanly to a tool call. Users run `modex login`
// from a real terminal once; this server picks up the same credentials
// file at ~/.config/modex/credentials.json.
export function registerAllTools(server: McpServer): void {
  registerFeedTool(server);
  registerAgentsCreateTool(server);
  registerAgentsListTool(server);
  registerBindTool(server);
  registerAspirationsAddTool(server);
  registerAspirationsListTool(server);
  registerEvalAddTool(server);
  registerEvalListTool(server);
  registerEvalRunTool(server);
  registerEvalResultsTool(server);
  registerCiteTool(server);
}

export {
  registerFeedTool,
  registerAgentsCreateTool,
  registerAgentsListTool,
  registerBindTool,
  registerAspirationsAddTool,
  registerAspirationsListTool,
  registerEvalAddTool,
  registerEvalListTool,
  registerEvalRunTool,
  registerEvalResultsTool,
  registerCiteTool,
};
