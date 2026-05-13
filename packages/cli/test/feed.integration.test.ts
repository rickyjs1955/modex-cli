import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createAgent, parseSkills, readChain, verifyChain } from '@modex/core';

import { runFeed } from '../src/commands/feed.js';

const FIXED_ID = '01928c8e-1234-7abc-8def-0123456789ab';
const FIXED_ID_2 = '01928c8e-5678-7abc-8def-0123456789ab';

function captureWritable() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  return { stream: stream as unknown as NodeJS.WritableStream, text: () => chunks.join('') };
}

function fakeAnthropic(
  skillsByCall: Array<Array<{ slug: string; name: string; description: string; tags: string[] }>>,
) {
  let call = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const skills = skillsByCall[call] ?? skillsByCall[skillsByCall.length - 1] ?? [];
        call++;
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'emit_skills', input: { skills } },
          ],
        };
      }),
    },
  };
}

async function tempBase(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'modex-cli-int-'));
}

async function tempCorpus(base: string, name: string, content: string): Promise<string> {
  const p = join(base, name);
  await writeFile(p, content, 'utf8');
  return p;
}

describe('runFeed (batch integration)', () => {
  it('writes skills.md, appends a v1 feed entry, prints a per-source line + done summary', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z', name: 'demo' });
    const corpus = await tempCorpus(base, 'book.md', 'Some corpus text describing techniques.');
    const stdout = captureWritable();
    const stderr = captureWritable();

    const result = await runFeed(FIXED_ID, [corpus], {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        [{ slug: 'five-whys', name: 'Five Whys', description: 'Ask why iteratively.', tags: ['debugging'] }],
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(result.perSource).toHaveLength(1);
    expect(result.perSource[0]!.added).toEqual(['five-whys']);
    expect(result.perSource[0]!.updated).toEqual([]);
    expect(stdout.text()).toContain('[1/1] book.md: +1 added, 0 updated');
    expect(stdout.text()).toContain('done: 1 source, 1 added, 0 updated total');

    const chain = await readChain(join(base, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    expect(chain[1]!.kind).toBe('feed');
    if (chain[1]!.kind === 'feed') {
      expect(chain[1]!.input.source).toBe('book.md');
      expect(chain[1]!.input.source_kind).toBe('markdown');
      expect(chain[1]!.input.source_url).toBeNull();
      expect(chain[1]!.output.skills_added).toEqual(['five-whys']);
    }
    verifyChain(chain);

    const skillsRaw = await readFile(join(base, '.modex', FIXED_ID, 'skills.md'), 'utf8');
    expect(parseSkills(skillsRaw).skills.map((s) => s.slug)).toEqual(['five-whys']);
  });

  it('processes multiple sources sequentially and chains a feed entry per source', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID_2, ts: '2026-05-13T00:00:00.000Z' });
    const a = await tempCorpus(base, 'a.md', 'first source');
    const b = await tempCorpus(base, 'b.md', 'second source');
    const c = await tempCorpus(base, 'c.md', 'third source');
    const stdout = captureWritable();

    const result = await runFeed(FIXED_ID_2, [a, b, c], {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        [{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }],
        [{ slug: 'two', name: 'Two', description: 'd', tags: ['x'] }],
        [{ slug: 'three', name: 'Three', description: 'd', tags: ['x'] }],
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: stdout.stream,
      stderr: captureWritable().stream,
    });

    expect(result.perSource.map((r) => r.source)).toEqual(['a.md', 'b.md', 'c.md']);
    const out = stdout.text();
    expect(out).toContain('[1/3] a.md');
    expect(out).toContain('[2/3] b.md');
    expect(out).toContain('[3/3] c.md');
    expect(out).toContain('done: 3 sources, 3 added, 0 updated total');

    const chain = await readChain(join(base, '.modex', FIXED_ID_2, 'provenance.jsonl'));
    expect(chain).toHaveLength(4); // genesis + 3 feeds
    verifyChain(chain);
  });

  it('expands a glob in pattern arguments', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    await tempCorpus(base, 'a.md', 'a');
    await tempCorpus(base, 'b.md', 'b');
    const stdout = captureWritable();

    const result = await runFeed(FIXED_ID, ['*.md'], {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        [{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }],
        [{ slug: 'two', name: 'Two', description: 'd', tags: ['x'] }],
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: stdout.stream,
      stderr: captureWritable().stream,
    });

    expect(result.perSource.map((r) => r.source).sort()).toEqual(['a.md', 'b.md']);
  });

  it('stops on first error: failed source means later sources never write a chain entry', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    const a = await tempCorpus(base, 'a.md', 'a');
    const c = await tempCorpus(base, 'c.md', 'c');
    let calls = 0;
    const client = {
      messages: {
        create: vi.fn(async () => {
          calls++;
          if (calls === 2) throw new Error('synthetic API failure');
          return {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-4-5-20251001',
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [
              {
                type: 'tool_use',
                id: 'tool_1',
                name: 'emit_skills',
                input: { skills: [{ slug: 'one', name: 'One', description: 'd', tags: ['x'] }] },
              },
            ],
          };
        }),
      },
    };
    const b = await tempCorpus(base, 'b.md', 'b');
    await expect(
      runFeed(FIXED_ID, [a, b, c], {
        baseDir: base,
        apiKey: 'test',
        client,
        loadSource: async (p) => ({
          source: p.split('/').pop()!,
          source_url: null,
          source_kind: 'markdown',
          content: 'fake',
        }),
        ts: '2026-05-13T00:01:00.000Z',
        stdout: captureWritable().stream,
        stderr: captureWritable().stream,
      }),
    ).rejects.toThrow(/Anthropic API call failed/);

    // Genesis + first source's feed entry only — third never started.
    const chain = await readChain(join(base, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    verifyChain(chain);
  });

  it('records source_kind=web and source_url for a URL target', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    const stdout = captureWritable();

    await runFeed(FIXED_ID, ['https://example.com/article'], {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        [{ slug: 'urlskill', name: 'Url Skill', description: 'd', tags: ['x'] }],
      ]),
      // Bypass the real network/Readability stack — feed-level test.
      loadSource: async (target) => ({
        source: target,
        source_url: target,
        source_kind: 'web',
        content: 'extracted page text',
      }),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: stdout.stream,
      stderr: captureWritable().stream,
    });

    const chain = await readChain(join(base, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain[1]!.kind).toBe('feed');
    if (chain[1]!.kind === 'feed') {
      expect(chain[1]!.input.source_kind).toBe('web');
      expect(chain[1]!.input.source_url).toBe('https://example.com/article');
      expect(chain[1]!.input.source).toBe('https://example.com/article');
    }
  });

  it('errors with AgentError when the agent does not exist', async () => {
    const base = await tempBase();
    const corpus = await tempCorpus(base, 'book.md', 'Corpus.');
    await expect(
      runFeed(FIXED_ID, [corpus], {
        baseDir: base,
        apiKey: 'test',
        client: fakeAnthropic([[{ slug: 'a', name: 'A', description: 'd', tags: ['x'] }]]),
        stdout: captureWritable().stream,
        stderr: captureWritable().stream,
      }),
    ).rejects.toThrow(/Agent .* not found/);
  });

  it('emits a token-cap warning to stderr when skills.md exceeds the per-agent cap', async () => {
    const base = await tempBase();
    await createAgent({
      baseDir: base,
      id: FIXED_ID,
      ts: '2026-05-13T00:00:00.000Z',
      tokenCapWarnAt: 10,
    });
    const corpus = await tempCorpus(base, 'book.md', 'Corpus.');
    const stderr = captureWritable();

    const result = await runFeed(FIXED_ID, [corpus], {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([[{ slug: 'a', name: 'A', description: 'd', tags: ['x'] }]]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: captureWritable().stream,
      stderr: stderr.stream,
    });

    expect(result.perSource[0]!.warnedOverCap).toBe(true);
    expect(stderr.text()).toMatch(/^warning: skills\.md is ~\d+ tokens \(cap: 10\)/);
  });
});
