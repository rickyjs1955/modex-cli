import { runCite } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

// The cite tool returns a `session_token` in its result. That's deliberate
// — the MCP host (Claude Code, Cursor, …) needs to surface it so the user
// can use it downstream. Local provenance stores only the sha256 of the
// token, matching the CLI behavior; the raw token never lands on disk via
// modex.

export function registerCiteTool(server: McpServer): void {
  server.tool(
    'modex_cite',
    'Register a citation of an agent\'s SKILLS.md at a specific bind hash. Returns a session_token for downstream attribution; records the citation locally (session_token is stored as sha256 only — the raw token only appears in this tool response).',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the (already bound) agent.'),
      bindHash: z
        .string()
        .optional()
        .describe(
          'sha256 of a specific bound snapshot. Defaults to the agent\'s latest from local registry.json.',
        ),
    },
    async ({ agentId, bindHash }) => {
      try {
        const captured = captureStreams();
        const result = await runCite(agentId, {
          bindHash,
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
