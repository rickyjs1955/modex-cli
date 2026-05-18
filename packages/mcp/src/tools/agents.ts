import { listAgents, runAgentsCreate } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

export function registerAgentsCreateTool(server: McpServer): void {
  server.tool(
    'modex_agents_create',
    'Create a new agent under .modex/<uuid7>/. Returns the new agent id.',
    {
      name: z
        .string()
        .optional()
        .describe('Human-readable label for this agent (optional).'),
    },
    async ({ name }) => {
      try {
        const captured = captureStreams();
        const id = await runAgentsCreate({ name, stdout: captured.stdout });
        return okResult({ agentId: id }, captured.text());
      } catch (err) {
        return mapToolError(err);
      }
    },
  );
}

export function registerAgentsListTool(server: McpServer): void {
  server.tool(
    'modex_agents_list',
    'List all agents under .modex/ in the current working directory. Returns id, name, created_at, and skill count for each.',
    {},
    async () => {
      try {
        const agents = await listAgents();
        const summary = agents.map((a) => ({
          agentId: a.config.id,
          name: a.config.name,
          createdAt: a.config.created_at,
        }));
        return okResult({ agents: summary }, '');
      } catch (err) {
        return mapToolError(err);
      }
    },
  );
}
