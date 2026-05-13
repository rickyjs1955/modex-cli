import Anthropic from '@anthropic-ai/sdk';

import { ExtractionResultSchema, type Skill } from './schema.js';
import { EMIT_SKILLS_TOOL, MODEL_ID, SYSTEM_PROMPT } from './prompt.js';

// Phase A guard. Real chunking arrives in Phase C.
const MAX_CORPUS_BYTES = 500_000;

export class ExtractionError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractionError';
    this.cause = cause;
  }
}

export interface ExtractOptions {
  source: string;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  client?: Anthropic;
}

export async function extractSkills(
  corpus: string,
  opts: ExtractOptions,
): Promise<Skill[]> {
  const bytes = Buffer.byteLength(corpus, 'utf8');
  if (bytes > MAX_CORPUS_BYTES) {
    throw new ExtractionError(
      `Corpus is ${bytes} bytes, which exceeds the Phase A limit of ${MAX_CORPUS_BYTES}. Chunking arrives in Phase C.`,
    );
  }
  if (corpus.trim().length === 0) {
    throw new ExtractionError('Corpus is empty.');
  }

  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!opts.client && !apiKey) {
    throw new ExtractionError(
      'ANTHROPIC_API_KEY is not set. Export it in your environment, or copy .env.example to .env.',
    );
  }

  const client = opts.client ?? new Anthropic({ apiKey });
  const model = opts.model ?? MODEL_ID;

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [EMIT_SKILLS_TOOL],
      tool_choice: { type: 'tool', name: 'emit_skills' },
      messages: [
        {
          role: 'user',
          content: corpus,
        },
      ],
    });
  } catch (err) {
    throw new ExtractionError('Anthropic API call failed', err);
  }

  const toolUse = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'emit_skills',
  );
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ExtractionError(
      `Model did not emit the emit_skills tool call (stop_reason=${response.stop_reason}).`,
    );
  }

  const parsed = ExtractionResultSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new ExtractionError(`Model output failed validation: ${detail}`);
  }

  return parsed.data.skills.map((s) => ({ ...s, source: opts.source }));
}
