import { runEvalAdd, runEvalList, runEvalResults, runEvalRun } from '@modexagents/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { captureStreams, mapToolError, okResult } from './util.js';

// All four eval tools wrap the core run* ops one-to-one. modex_eval_run
// needs ANTHROPIC_API_KEY in the MCP server's environment — same story as
// modex_feed — because the CLI-design choice (CLI calls Anthropic, not the
// server) propagates straight through to MCP.

export function registerEvalAddTool(server: McpServer): void {
  server.tool(
    'modex_eval_add',
    'Register an eval against an aspiration on the registry. Eval prompts attach to the aspiration (not a single agent), so any agent pinning that aspiration can be evaled with it.',
    {
      aspirationHash: z
        .string()
        .describe('sha256 of the aspiration (see modex_aspirations_list).'),
      text: z
        .string()
        .min(1)
        .describe('The eval prompt — what the agent will be asked.'),
      markRubric: z
        .string()
        .optional()
        .describe('Optional rubric the eval-runner uses to mark the response.'),
    },
    async ({ aspirationHash, text, markRubric }) => {
      try {
        const captured = captureStreams();
        const result = await runEvalAdd(aspirationHash, {
          text,
          markRubric,
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

export function registerEvalListTool(server: McpServer): void {
  server.tool(
    'modex_eval_list',
    'List the evals registered against an aspiration. Each eval has an eval_id, the prompt text, and an optional mark_rubric.',
    {
      aspirationHash: z
        .string()
        .describe('sha256 of the aspiration.'),
    },
    async ({ aspirationHash }) => {
      try {
        const captured = captureStreams();
        const result = await runEvalList(aspirationHash, {
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

export function registerEvalRunTool(server: McpServer): void {
  server.tool(
    'modex_eval_run',
    'Run one or more evals against an agent. Calls Anthropic locally (the MCP server\'s ANTHROPIC_API_KEY), marks the response, posts the outcome to the registry, and records an eval_run entry in the agent\'s local provenance chain. Pass evalId, aspirationHash, or both.',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the agent to probe.'),
      evalId: z
        .string()
        .optional()
        .describe('Run a specific eval by id. If aspirationHash is omitted, the server scans the agent\'s pinned aspirations to find this eval.'),
      aspirationHash: z
        .string()
        .optional()
        .describe('Run every eval registered on this aspiration. The aspiration must be pinned to the agent locally.'),
      model: z
        .string()
        .optional()
        .describe('Anthropic model id to use (default: Claude Haiku 4.5).'),
    },
    async ({ agentId, evalId, aspirationHash, model }) => {
      try {
        const captured = captureStreams();
        const result = await runEvalRun(agentId, {
          evalId,
          aspirationHash,
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

export function registerEvalResultsTool(server: McpServer): void {
  server.tool(
    'modex_eval_results',
    'Show past eval runs for an agent from the registry. Optionally filter to one eval id.',
    {
      agentId: z
        .string()
        .describe('UUIDv7 of the agent.'),
      evalId: z
        .string()
        .optional()
        .describe('Filter to runs of a specific eval.'),
    },
    async ({ agentId, evalId }) => {
      try {
        const captured = captureStreams();
        const result = await runEvalResults(agentId, {
          evalId,
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
