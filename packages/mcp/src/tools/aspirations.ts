import { runAspirationsAdd } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

export function registerAspirationsAddTool(server: McpServer): void {
  server.tool(
    'modex_aspirations_add',
    'Append an aspiration to a bound agent from a markdown file. Append-only — no edit or delete.',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the (already bound) agent.'),
      mdFile: z
        .string()
        .describe('Path to a markdown file describing the aspiration.'),
    },
    async ({ agentId, mdFile }) => {
      try {
        const captured = captureStreams();
        const result = await runAspirationsAdd(agentId, mdFile, {
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
