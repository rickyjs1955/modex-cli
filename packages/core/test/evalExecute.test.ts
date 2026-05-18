import { describe, expect, it, vi } from 'vitest';

import { executeEval, EvalExecutionError } from '../src/evalExecute.js';

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

interface ScriptedResponse {
  stop_reason?: string;
  content: ContentBlock[];
}

// Build a fake Anthropic client whose messages.create returns a queue of
// scripted responses in order. Two queues are useful because executeEval
// makes up to two calls (run, then mark).
function fakeClient(responses: ScriptedResponse[]) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const create = vi.fn(async (args: Record<string, unknown>) => {
    calls.push(args);
    const r = responses[i] ?? responses[responses.length - 1]!;
    i++;
    return {
      id: `msg_${i}`,
      type: 'message',
      role: 'assistant',
      model: (args['model'] as string) ?? 'claude-haiku-4-5-20251001',
      stop_reason: r.stop_reason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: r.content,
    };
  });
  return {
    client: { messages: { create } } as unknown as Parameters<typeof executeEval>[0]['client'],
    calls,
    create,
  };
}

const SKILLS = '---\nschema_version: 0\n---\n# Skills\n\nBe thoughtful.\n';

describe('executeEval — run-only path (no mark_rubric)', () => {
  it('returns the transcript with mark=null when no rubric is supplied', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'A thoughtful response.' }] },
    ]);
    const result = await executeEval({
      skillsMd: SKILLS,
      evalText: 'Probe text',
      client,
      apiKey: 'ignored-when-client-supplied',
    });
    expect(result.mark).toBeNull();
    expect(result.transcript).toBe('A thoughtful response.');
    // Only one API call when there's no rubric to evaluate against.
    expect(create).toHaveBeenCalledOnce();
  });

  it('treats empty-string mark_rubric the same as missing', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'response' }] },
    ]);
    const result = await executeEval({
      skillsMd: SKILLS,
      evalText: 'probe',
      markRubric: '   ',
      client,
    });
    expect(result.mark).toBeNull();
    expect(create).toHaveBeenCalledOnce();
  });

  it('caches the SKILLS.md system prompt with ephemeral cache_control', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'response' }] },
    ]);
    await executeEval({ skillsMd: SKILLS, evalText: 'probe', client });
    const args = create.mock.calls[0]![0] as Record<string, unknown>;
    const system = args['system'] as Array<{ cache_control?: { type: string } }>;
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('executeEval — run + mark path', () => {
  it('makes a second call to the marker and returns the structured mark', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'response from agent' }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_mark',
            input: { pass: true, rationale: 'response satisfied the rubric' },
          },
        ],
      },
    ]);
    const result = await executeEval({
      skillsMd: SKILLS,
      evalText: 'probe',
      markRubric: 'pass if response is thoughtful',
      client,
    });
    expect(result.mark).toEqual({ pass: true, rationale: 'response satisfied the rubric' });
    expect(create).toHaveBeenCalledTimes(2);
    // Marker call uses tool_choice with emit_mark forced.
    const markArgs = create.mock.calls[1]![0] as Record<string, unknown>;
    expect(markArgs['tool_choice']).toEqual({ type: 'tool', name: 'emit_mark' });
  });

  it('forwards the rubric + probe + response into the marker user message', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'AGENT_SAID' }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_mark',
            input: { pass: false, rationale: 'flattered the user' },
          },
        ],
      },
    ]);
    await executeEval({
      skillsMd: SKILLS,
      evalText: 'THE_PROBE',
      markRubric: 'THE_RUBRIC',
      client,
    });
    const markArgs = create.mock.calls[1]![0] as Record<string, unknown>;
    const messages = markArgs['messages'] as Array<{ content: string }>;
    expect(messages[0]!.content).toContain('THE_RUBRIC');
    expect(messages[0]!.content).toContain('THE_PROBE');
    expect(messages[0]!.content).toContain('AGENT_SAID');
  });

  it('rejects empty SKILLS.md before calling the API', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'unused' }] },
    ]);
    await expect(
      executeEval({ skillsMd: '   \n\n', evalText: 'probe', client }),
    ).rejects.toBeInstanceOf(EvalExecutionError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects empty eval text before calling the API', async () => {
    const { client, create } = fakeClient([
      { content: [{ type: 'text', text: 'unused' }] },
    ]);
    await expect(
      executeEval({ skillsMd: SKILLS, evalText: '\t  ', client }),
    ).rejects.toBeInstanceOf(EvalExecutionError);
    expect(create).not.toHaveBeenCalled();
  });

  it('throws when the run returns no text content', async () => {
    const { client } = fakeClient([{ content: [] }]);
    await expect(
      executeEval({ skillsMd: SKILLS, evalText: 'probe', client }),
    ).rejects.toThrow(/produced no text/);
  });

  it('throws when the marker does not emit the emit_mark tool', async () => {
    const { client } = fakeClient([
      { content: [{ type: 'text', text: 'response' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I refuse to mark' }] },
    ]);
    await expect(
      executeEval({
        skillsMd: SKILLS,
        evalText: 'probe',
        markRubric: 'rubric',
        client,
      }),
    ).rejects.toThrow(/did not emit emit_mark/);
  });

  it('throws when the marker emits an invalid mark shape', async () => {
    const { client } = fakeClient([
      { content: [{ type: 'text', text: 'response' }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_mark',
            input: { pass: 'maybe', rationale: '' }, // both fields wrong
          },
        ],
      },
    ]);
    await expect(
      executeEval({
        skillsMd: SKILLS,
        evalText: 'probe',
        markRubric: 'rubric',
        client,
      }),
    ).rejects.toThrow(/failed validation/);
  });
});
