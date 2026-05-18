import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { MODEL_ID } from './prompt.js';

// Eval execution is two model calls:
//
//   1. RUN — system=agent's SKILLS.md, user=eval prompt. The model under
//      eval responds as if it were the agent.
//
//   2. MARK — system=marker prompt, user=structured rubric+probe+response.
//      A second model call grades the response against the rubric. Forced
//      tool-call output ensures we get a structured {pass, rationale}.
//
// If the eval has no mark_rubric, MARK is skipped and the result.mark is
// null — the run still produces a transcript that the registry can store.
//
// Both calls go through the same Anthropic client. The caller injects either
// `client` (tests) or `apiKey` (real runs); the local-CLI design means the
// user pays for both calls against their own ANTHROPIC_API_KEY.

export const MARK_SYSTEM_PROMPT = `You are a strict evaluator. You will be given a probe question, a rubric for marking, and a response from an AI agent. Decide whether the response satisfies the rubric.

Output exactly one tool call to emit_mark with:
- pass: boolean — true only if the response clearly satisfies the rubric
- rationale: string — one or two sentences explaining your decision

Be strict. When in doubt, mark as not-passed. Do not emit any text outside the tool call.`;

export const EMIT_MARK_TOOL = {
  name: 'emit_mark',
  description: 'Emit the structured mark for the agent response under the given rubric.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pass: {
        type: 'boolean',
        description: 'true only if the response clearly satisfies the rubric.',
      },
      rationale: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
        description: 'One or two sentences explaining the decision.',
      },
    },
    required: ['pass', 'rationale'],
    additionalProperties: false,
  },
};

export const MarkSchema = z.object({
  pass: z.boolean(),
  rationale: z.string().min(1).max(2000),
});
export type Mark = z.infer<typeof MarkSchema>;

export class EvalExecutionError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EvalExecutionError';
    this.cause = cause;
  }
}

export interface EvalExecuteOptions {
  skillsMd: string;
  evalText: string;
  markRubric?: string | null;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  client?: Anthropic;
}

export interface EvalExecutionResult {
  model: string;
  transcript: string;
  mark: Mark | null;
}

function getClient(opts: EvalExecuteOptions): Anthropic {
  if (opts.client) return opts.client;
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new EvalExecutionError(
      'ANTHROPIC_API_KEY is not set. Export it in your environment, or copy .env.example to .env.',
    );
  }
  return new Anthropic({ apiKey });
}

// Structural type — the create() call returns a union that includes a
// streaming variant without `.content`, but we never use streaming here, so
// accepting the narrower shape keeps the helper free of SDK union acrobatics.
interface MessageWithContent {
  content: Array<{ type: string; text?: string }>;
}

function extractTextResponse(response: MessageWithContent): string {
  const parts: string[] = [];
  for (const b of response.content) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n').trim();
}

// Cap the prompt the marker sees so a runaway response doesn't blow the
// marker call's context. 16 KB is plenty for "evaluate this response."
const MAX_RESPONSE_BYTES_FOR_MARKER = 16_000;

function truncateForMarker(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_RESPONSE_BYTES_FOR_MARKER) return text;
  // Truncate by characters then verify byte-length; multi-byte chars at the
  // boundary are fine, just count conservatively.
  const max = MAX_RESPONSE_BYTES_FOR_MARKER;
  return text.slice(0, max) + '\n[truncated — see provenance transcript_sha256 for full response]';
}

export async function executeEval(opts: EvalExecuteOptions): Promise<EvalExecutionResult> {
  if (opts.skillsMd.trim().length === 0) {
    throw new EvalExecutionError(
      'Agent SKILLS.md is empty. Feed the agent some sources before running an eval.',
    );
  }
  if (opts.evalText.trim().length === 0) {
    throw new EvalExecutionError('Eval text is empty.');
  }

  const client = getClient(opts);
  const model = opts.model ?? MODEL_ID;
  const maxTokens = opts.maxTokens ?? 4096;

  // --- RUN ---------------------------------------------------------------
  let runResponse;
  try {
    runResponse = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // SKILLS.md is the system prompt — the agent's identity. cache_control
      // mirrors extract.ts so repeat evals on the same agent reuse the
      // prefix.
      system: [
        {
          type: 'text',
          text: opts.skillsMd,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: opts.evalText }],
    });
  } catch (err) {
    throw new EvalExecutionError('Eval run: Anthropic API call failed', err);
  }
  const transcript = extractTextResponse(runResponse);
  if (transcript.length === 0) {
    throw new EvalExecutionError(
      `Eval run produced no text response (stop_reason=${runResponse.stop_reason}).`,
    );
  }

  // --- MARK --------------------------------------------------------------
  if (opts.markRubric === undefined || opts.markRubric === null || opts.markRubric.trim().length === 0) {
    return { model, transcript, mark: null };
  }

  const markerUser =
    `RUBRIC:\n${opts.markRubric.trim()}\n\n` +
    `PROBE:\n${opts.evalText.trim()}\n\n` +
    `RESPONSE:\n${truncateForMarker(transcript)}\n`;

  let markResponse;
  try {
    markResponse = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: MARK_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [EMIT_MARK_TOOL],
      tool_choice: { type: 'tool', name: 'emit_mark' },
      messages: [{ role: 'user', content: markerUser }],
    });
  } catch (err) {
    throw new EvalExecutionError('Eval mark: Anthropic API call failed', err);
  }

  const toolUse = markResponse.content.find(
    (b) => b.type === 'tool_use' && b.name === 'emit_mark',
  );
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new EvalExecutionError(
      `Marker did not emit emit_mark (stop_reason=${markResponse.stop_reason}).`,
    );
  }
  const parsed = MarkSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new EvalExecutionError(
      `Marker output failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    );
  }

  return { model, transcript, mark: parsed.data };
}
