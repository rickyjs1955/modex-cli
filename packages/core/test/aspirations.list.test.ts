import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createAgent, recordEntry } from '../src/index.js';
import { runAspirationsList } from '../src/operations/aspirations.js';

const FIXED_ID = '01928c8e-1234-7abc-8def-0123456789ab';
const REGISTRY = 'https://registry.example';

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

async function tempBaseDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'modex-asp-list-'));
}

describe('runAspirationsList', () => {
  it('reports "no aspirations" for an agent with only the genesis entry', async () => {
    const baseDir = await tempBaseDir();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    const stdout = captureWritable();
    const result = await runAspirationsList(FIXED_ID, { baseDir, stdout: stdout.stream });
    expect(result.aspirations).toEqual([]);
    expect(stdout.text()).toMatch(/no aspirations/);
  });

  it('emits one TSV line per aspiration_added entry, in chain order', async () => {
    const baseDir = await tempBaseDir();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    const provenance = join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl');
    await recordEntry({
      path: provenance,
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: 'a'.repeat(64), aspiration_bytes: 12, source: 'honesty.md' },
        output: { registry_url: REGISTRY },
      },
      ts: '2026-05-15T01:00:00.000Z',
    });
    await recordEntry({
      path: provenance,
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: 'b'.repeat(64), aspiration_bytes: 18, source: 'brevity.md' },
        output: { registry_url: REGISTRY },
      },
      ts: '2026-05-15T02:00:00.000Z',
    });

    const stdout = captureWritable();
    const result = await runAspirationsList(FIXED_ID, { baseDir, stdout: stdout.stream });

    expect(result.aspirations).toEqual([
      { sha256: 'a'.repeat(64), source: 'honesty.md', addedAt: '2026-05-15T01:00:00.000Z' },
      { sha256: 'b'.repeat(64), source: 'brevity.md', addedAt: '2026-05-15T02:00:00.000Z' },
    ]);
    const lines = stdout.text().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${'a'.repeat(64)}\thonesty.md\t2026-05-15T01:00:00.000Z`);
  });

  it('ignores non-aspiration entries in the chain', async () => {
    const baseDir = await tempBaseDir();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-15T00:00:00.000Z' });
    const provenance = join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl');
    // bound entry — should not appear in the list.
    await recordEntry({
      path: provenance,
      draft: {
        kind: 'bound',
        input: { skills_md_sha256: 'f'.repeat(64), aspiration_sha256s: [] },
        output: { registry_url: REGISTRY, bound_at: '2026-05-15T01:00:00.000Z' },
      },
      ts: '2026-05-15T01:00:00.000Z',
    });
    const result = await runAspirationsList(FIXED_ID, {
      baseDir,
      stdout: captureWritable().stream,
    });
    expect(result.aspirations).toEqual([]);
  });
});
