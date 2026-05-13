import { describe, expect, it, vi } from 'vitest';

import { extractSkills, ExtractionError } from '../src/extract.js';

function fakeClient(toolInput: unknown, stopReason = 'tool_use') {
  return {
    messages: {
      create: vi.fn(async () => ({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'emit_skills',
            input: toolInput,
          },
        ],
      })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const validToolInput = {
  skills: [
    {
      slug: 'five-whys',
      name: 'Five Whys',
      description: 'Ask why iteratively to walk from symptom to root cause.',
      tags: ['debugging', 'root-cause'],
    },
  ],
};

describe('extractSkills', () => {
  it('returns parsed skills with source attached from opts', async () => {
    const client = fakeClient(validToolInput);
    const skills = await extractSkills('A non-empty corpus.', {
      source: 'book.md',
      apiKey: 'test',
      client,
    });
    expect(skills).toEqual([
      {
        slug: 'five-whys',
        name: 'Five Whys',
        description: 'Ask why iteratively to walk from symptom to root cause.',
        tags: ['debugging', 'root-cause'],
        source: 'book.md',
      },
    ]);
    expect(client.messages.create).toHaveBeenCalledOnce();
  });

  it('marks the system prompt with cache_control on the API call', async () => {
    const client = fakeClient(validToolInput);
    await extractSkills('A non-empty corpus.', {
      source: 'book.md',
      apiKey: 'test',
      client,
    });
    const args = client.messages.create.mock.calls[0]![0];
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'emit_skills' });
  });

  it('rejects empty corpus before calling the API', async () => {
    const client = fakeClient(validToolInput);
    await expect(
      extractSkills('   \n\n   ', { source: 'x.md', apiKey: 'test', client }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('rejects oversized corpus before calling the API', async () => {
    const client = fakeClient(validToolInput);
    const big = 'x'.repeat(500_001);
    await expect(
      extractSkills(big, { source: 'x.md', apiKey: 'test', client }),
    ).rejects.toThrow(/exceeds the Phase A limit/);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('throws when model returns no tool_use block', async () => {
    const client = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'I refuse' }],
        })),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      extractSkills('hi', { source: 'x.md', apiKey: 'test', client }),
    ).rejects.toThrow(/did not emit the emit_skills tool call/);
  });

  it('throws when tool input fails schema validation', async () => {
    const client = fakeClient({
      skills: [{ slug: 'BAD-SLUG', name: 'x', description: 'x', tags: [] }],
    });
    await expect(
      extractSkills('hi', { source: 'x.md', apiKey: 'test', client }),
    ).rejects.toThrow(/failed validation/);
  });
});
