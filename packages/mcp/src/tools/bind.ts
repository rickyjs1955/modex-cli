import { runBind } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

export function registerBindTool(server: McpServer): void {
  server.tool(
    'modex_bind',
    'Bind a local agent to the registry: upload SKILLS.md + provenance head + aspiration hashes. Requires a prior `modex login` (run from a terminal) — the MCP server reads ~/.config/modex/credentials.json.',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the agent to bind.'),
    },
    async ({ agentId }) => {
      try {
        const captured = captureStreams();
        const result = await runBind(agentId, {
          stdout: captured.stdout,
          stderr: captured.stderr,
        });
        return okResult(result, captured.text());
      } catch (err) {
        return mapToolError(err);
      }
    },
  );
}
