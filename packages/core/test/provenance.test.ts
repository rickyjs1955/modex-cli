import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  computeEntryHash,
  ProvenanceError,
  readChain,
  recordEntry,
  verifyChain,
  type FeedEntry,
} from '../src/provenance.js';

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'modex-prov-'));
  return join(dir, 'provenance.jsonl');
}

const SHA = 'a'.repeat(64);
const SHB = 'b'.repeat(64);

function feedDraft(source = 'book.md') {
  return {
    kind: 'feed' as const,
    input: {
      source,
      source_sha256: SHA,
      source_bytes: 1234,
      model: 'claude-haiku-4-5-20251001',
    },
    output: {
      skills_added: ['x-skill'],
      skills_updated: [],
      skills_removed: [],
      skills_md_sha256: SHB,
      skills_md_bytes: 567,
    },
  };
}

describe('recordEntry', () => {
  it('genesis entry has seq=1 and prev=null', async () => {
    const path = await tempPath();
    const e = await recordEntry({
      path,
      draft: {
        kind: 'agent_created',
        input: { name: 'a' },
        output: { agent_id: 'id-1' },
      },
      ts: '2026-05-13T00:00:00.000Z',
    });
    expect(e.seq).toBe(1);
    expect(e.prev).toBeNull();
    expect(e.entry_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('second entry links prev to first entry_sha256', async () => {
    const path = await tempPath();
    const a = await recordEntry({
      path,
      draft: {
        kind: 'agent_created',
        input: { name: 'a' },
        output: { agent_id: 'id-1' },
      },
      ts: '2026-05-13T00:00:00.000Z',
    });
    const b = await recordEntry({
      path,
      draft: feedDraft(),
      ts: '2026-05-13T00:01:00.000Z',
    });
    expect(b.seq).toBe(2);
    expect(b.prev).toBe(a.entry_sha256);
  });

  it('writes one canonical JSON line per entry', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id-1' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    await recordEntry({ path, draft: feedDraft(), ts: '2026-05-13T00:01:00.000Z' });
    const raw = await readFile(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      // Canonical: starts with `{"entry_sha256"` since keys are sorted.
      expect(l.startsWith('{"entry_sha256":')).toBe(true);
    }
  });

  it('hash is deterministic for the same content', async () => {
    const draft = feedDraft();
    const skeleton = {
      schema_version: 0 as const,
      seq: 1,
      ts: '2026-05-13T00:00:00.000Z',
      kind: draft.kind,
      input: draft.input,
      output: draft.output,
      prev: null,
    };
    const h1 = computeEntryHash(skeleton);
    const h2 = computeEntryHash({ ...skeleton });
    expect(h1).toBe(h2);
  });
});

describe('verifyChain', () => {
  it('accepts a valid 3-entry chain', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    await recordEntry({ path, draft: feedDraft('a.md'), ts: '2026-05-13T00:01:00.000Z' });
    await recordEntry({ path, draft: feedDraft('b.md'), ts: '2026-05-13T00:02:00.000Z' });
    const entries = await readChain(path);
    expect(() => verifyChain(entries)).not.toThrow();
  });

  it('detects mutated payload (entry_sha256 no longer matches)', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    const entries = await readChain(path);
    // Tamper: change source_bytes via JSON edit on disk.
    const raw = await readFile(path, 'utf8');
    const tampered = raw.replace('"name":"a"', '"name":"hacked"');
    await writeFile(path, tampered, 'utf8');
    const reread = await readChain(path);
    expect(reread).not.toEqual(entries); // sanity
    expect(() => verifyChain(reread)).toThrow(ProvenanceError);
  });

  it('detects a broken prev link', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    await recordEntry({ path, draft: feedDraft(), ts: '2026-05-13T00:01:00.000Z' });
    const entries = await readChain(path);
    // Forge a prev hash by hand.
    const broken: FeedEntry = {
      ...(entries[1] as FeedEntry),
      prev: 'f'.repeat(64),
    };
    expect(() => verifyChain([entries[0]!, broken])).toThrow(/prev/);
  });

  it('detects a non-monotonic seq', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    await recordEntry({ path, draft: feedDraft(), ts: '2026-05-13T00:01:00.000Z' });
    const entries = await readChain(path);
    const out_of_order = [entries[1]!, entries[0]!];
    expect(() => verifyChain(out_of_order)).toThrow(/seq/);
  });
});

describe('readChain', () => {
  it('returns [] for missing file', async () => {
    const e = await readChain('/tmp/does-not-exist-modex-prov.jsonl');
    expect(e).toEqual([]);
  });
});
