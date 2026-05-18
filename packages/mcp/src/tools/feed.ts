import { runFeed } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

export function registerFeedTool(server: McpServer): void {
  server.tool(
    'modex_feed',
    'Extract skills from one or more sources (files, globs, or http(s) URLs) and merge them into the named agent\'s SKILLS.md. Sources processed sequentially; each lands one provenance entry. Requires ANTHROPIC_API_KEY in the server\'s environment.',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the target agent (see modex_agents_list).'),
      patterns: z
        .array(z.string().min(1))
        .min(1)
        .describe('File paths, globs, or http(s) URLs. Local files: .txt, .md, .pdf, .epub.'),
      model: z
        .string()
        .optional()
        .describe('Anthropic model id to use (default: Claude Haiku 4.5).'),
    },
    async ({ agentId, patterns, model }) => {
      try {
        const captured = captureStreams();
        const result = await runFeed(agentId, patterns, {
          model,
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
