import { mkdtemp, writeFile } from 'node:fs/promises';
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

function fakeAnthropic(skills: Array<{ slug: string; name: string; description: string; tags: string[] }>) {
  return {
    messages: {
      create: vi.fn(async () => ({
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
            input: { skills },
          },
        ],
      })),
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

describe('runFeed (integration)', () => {
  it('writes skills.md, appends a valid feed provenance entry, and prints a summary', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z', name: 'demo' });
    const corpus = await tempCorpus(base, 'book.md', 'Some corpus text describing techniques.');
    const stdout = captureWritable();
    const stderr = captureWritable();

    const result = await runFeed(FIXED_ID, corpus, {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        {
          slug: 'five-whys',
          name: 'Five Whys',
          description: 'Ask why iteratively.',
          tags: ['debugging'],
        },
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(result.added).toEqual(['five-whys']);
    expect(result.updated).toEqual([]);
    expect(result.warnedOverCap).toBe(false);
    expect(stdout.text()).toContain(`feed ${FIXED_ID}: +1 added`);

    // Provenance: 2 entries (genesis + feed), valid chain
    const chain = await readChain(join(base, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    expect(chain[1]!.kind).toBe('feed');
    expect(chain[1]!.prev).toBe(chain[0]!.entry_sha256);
    if (chain[1]!.kind === 'feed') {
      expect(chain[1]!.input.source).toBe('book.md');
      expect(chain[1]!.output.skills_added).toEqual(['five-whys']);
      expect(chain[1]!.output.skills_md_sha256).toBe(result.skillsMdSha256);
    }
    verifyChain(chain);

    // skills.md round-trips through parseSkills.
    const skillsRaw = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(base, '.modex', FIXED_ID, 'skills.md'), 'utf8'),
    );
    const parsed = parseSkills(skillsRaw);
    expect(parsed.skills.map((s) => s.slug)).toEqual(['five-whys']);
  });

  it('second feed reports updated for the same slug with new content', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID_2, ts: '2026-05-13T00:00:00.000Z' });
    const corpus = await tempCorpus(base, 'book.md', 'Corpus.');

    await runFeed(FIXED_ID_2, corpus, {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        { slug: 'five-whys', name: 'Five Whys', description: 'v1', tags: ['debugging'] },
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: captureWritable().stream,
      stderr: captureWritable().stream,
    });

    const stdout = captureWritable();
    const result = await runFeed(FIXED_ID_2, corpus, {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        { slug: 'five-whys', name: 'Five Whys', description: 'v2', tags: ['debugging'] },
        { slug: 'new-skill', name: 'New Skill', description: 'desc', tags: ['x'] },
      ]),
      ts: '2026-05-13T00:02:00.000Z',
      stdout: stdout.stream,
      stderr: captureWritable().stream,
    });

    expect(result.added).toEqual(['new-skill']);
    expect(result.updated).toEqual(['five-whys']);
    expect(stdout.text()).toContain('+1 added, 1 updated');

    const chain = await readChain(join(base, '.modex', FIXED_ID_2, 'provenance.jsonl'));
    expect(chain).toHaveLength(3);
    verifyChain(chain);
  });

  it('emits a token-cap warning to stderr when skills.md exceeds the per-agent cap', async () => {
    const base = await tempBase();
    // Tiny cap so any non-trivial skills.md trips it.
    await createAgent({
      baseDir: base,
      id: FIXED_ID,
      ts: '2026-05-13T00:00:00.000Z',
      tokenCapWarnAt: 10,
    });
    const corpus = await tempCorpus(base, 'book.md', 'Corpus.');
    const stderr = captureWritable();

    const result = await runFeed(FIXED_ID, corpus, {
      baseDir: base,
      apiKey: 'test',
      client: fakeAnthropic([
        { slug: 'a', name: 'A', description: 'd', tags: ['x'] },
      ]),
      ts: '2026-05-13T00:01:00.000Z',
      stdout: captureWritable().stream,
      stderr: stderr.stream,
    });

    expect(result.warnedOverCap).toBe(true);
    expect(stderr.text()).toMatch(/^warning: skills\.md is ~\d+ tokens \(cap: 10\)/);
  });

  it('errors with AgentError when the agent does not exist', async () => {
    const base = await tempBase();
    const corpus = await tempCorpus(base, 'book.md', 'Corpus.');
    await expect(
      runFeed(FIXED_ID, corpus, {
        baseDir: base,
        apiKey: 'test',
        client: fakeAnthropic([{ slug: 'a', name: 'A', description: 'd', tags: ['x'] }]),
        stdout: captureWritable().stream,
        stderr: captureWritable().stream,
      }),
    ).rejects.toThrow(/Agent .* not found/);
  });
});
