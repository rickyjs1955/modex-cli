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
      source_url: null,
      source_kind: 'markdown' as const,
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
      schema_version: 1 as const,
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

  // Pin the exact bytes that flow through canonicalize → sha256 for a known
  // entry. If this hash changes, *something* about the canonicalizer or the
  // entry shape moved. Either roll PROVENANCE_SCHEMA_VERSION or fix the
  // regression — do not just update this constant.
  it('produces a known sha256 hex for a pinned canonical entry', () => {
    const pinned = {
      schema_version: 1 as const,
      seq: 1,
      ts: '2026-05-13T00:00:00.000Z',
      kind: 'agent_created' as const,
      input: { name: 'pinned' },
      output: { agent_id: 'agent-pinned' },
      prev: null,
    };
    expect(computeEntryHash(pinned)).toBe(
      'e70316058bd9633dade1b0bc426e56d9912b0ba000cbd1fa1d4f2bb55bbda5f0',
    );
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

  it('rejects a v0 (Phase B) chain with an actionable message', async () => {
    const path = await tempPath();
    const v0Line =
      JSON.stringify({
        schema_version: 0,
        seq: 1,
        ts: '2026-05-13T00:00:00.000Z',
        kind: 'agent_created',
        input: { name: 'old' },
        output: { agent_id: 'old-id' },
        prev: null,
        entry_sha256: 'a'.repeat(64),
      }) + '\n';
    await writeFile(path, v0Line, 'utf8');
    await expect(readChain(path)).rejects.toThrow(/schema_version=0/);
    await expect(readChain(path)).rejects.toThrow(/0\.1\.x/);
  });

  it('rejects an unknown entry kind with an upgrade hint (forward-compat)', async () => {
    const path = await tempPath();
    const futureLine =
      JSON.stringify({
        schema_version: 1,
        seq: 1,
        ts: '2026-05-13T00:00:00.000Z',
        kind: 'teleported', // a kind from some hypothetical future modex-cli
        input: {},
        output: {},
        prev: null,
        entry_sha256: 'a'.repeat(64),
      }) + '\n';
    await writeFile(path, futureLine, 'utf8');
    await expect(readChain(path)).rejects.toThrow(/not recognized by this build/);
    await expect(readChain(path)).rejects.toThrow(/upgrade modex-cli/);
  });
});

describe('recordEntry — Phase D kinds', () => {
  it('records a bound entry and keeps the chain verifiable', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    const bound = await recordEntry({
      path,
      draft: {
        kind: 'bound',
        input: { skills_md_sha256: SHA, aspiration_sha256s: [] },
        output: { registry_url: 'https://registry.modex.md', bound_at: '2026-05-14T00:00:00.000Z' },
      },
      ts: '2026-05-13T00:01:00.000Z',
    });
    expect(bound.kind).toBe('bound');
    expect(bound.seq).toBe(2);
    const chain = await readChain(path);
    expect(chain).toHaveLength(2);
    verifyChain(chain);
  });

  it('records an aspiration_added entry and keeps the chain verifiable', async () => {
    const path = await tempPath();
    await recordEntry({
      path,
      draft: { kind: 'agent_created', input: { name: 'a' }, output: { agent_id: 'id' } },
      ts: '2026-05-13T00:00:00.000Z',
    });
    const asp = await recordEntry({
      path,
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: SHB, aspiration_bytes: 42, source: 'goal.md' },
        output: { registry_url: 'https://registry.modex.md' },
      },
      ts: '2026-05-13T00:02:00.000Z',
    });
    expect(asp.kind).toBe('aspiration_added');
    const chain = await readChain(path);
    expect(chain).toHaveLength(2);
    if (chain[1]!.kind === 'aspiration_added') {
      expect(chain[1]!.input.source).toBe('goal.md');
      expect(chain[1]!.input.aspiration_bytes).toBe(42);
    }
    verifyChain(chain);
  });

  it('rejects a bound draft with a non-hex skills hash', async () => {
    const path = await tempPath();
    await expect(
      recordEntry({
        path,
        draft: {
          kind: 'bound',
          input: { skills_md_sha256: 'not-hex', aspiration_sha256s: [] },
          output: { registry_url: 'https://registry.modex.md', bound_at: '2026-05-14T00:00:00.000Z' },
        },
      }),
    ).rejects.toThrow(ProvenanceError);
  });
});
