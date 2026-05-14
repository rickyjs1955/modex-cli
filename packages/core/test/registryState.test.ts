import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type RegistryState,
  RegistryStateError,
  readRegistryState,
  writeRegistryState,
} from '../src/registryState.js';

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'modex-regstate-'));
  return join(dir, 'registry.json');
}

const SAMPLE: RegistryState = {
  schema_version: 1,
  registry_url: 'https://registry.modex.md',
  agent_id: '01928c8e-1234-7abc-8def-0123456789ab',
  bound_at: '2026-05-14T00:00:00.000Z',
  last_server_skills_md_sha256: 'a'.repeat(64),
};

describe('registryState', () => {
  it('returns null when the agent has never been bound', async () => {
    const path = await tempPath();
    expect(await readRegistryState(path)).toBeNull();
  });

  it('round-trips a written state', async () => {
    const path = await tempPath();
    await writeRegistryState(path, SAMPLE);
    expect(await readRegistryState(path)).toEqual(SAMPLE);
  });

  it('overwrites on a second write (re-bind)', async () => {
    const path = await tempPath();
    await writeRegistryState(path, SAMPLE);
    const updated = { ...SAMPLE, last_server_skills_md_sha256: 'b'.repeat(64) };
    await writeRegistryState(path, updated);
    expect((await readRegistryState(path))?.last_server_skills_md_sha256).toBe('b'.repeat(64));
  });

  it('throws RegistryStateError for malformed JSON', async () => {
    const path = await tempPath();
    await writeFile(path, '{ broken', 'utf8');
    await expect(readRegistryState(path)).rejects.toBeInstanceOf(RegistryStateError);
  });

  it('throws RegistryStateError for a schema mismatch', async () => {
    const path = await tempPath();
    await writeFile(path, JSON.stringify({ schema_version: 1, agent_id: 'x' }), 'utf8');
    await expect(readRegistryState(path)).rejects.toBeInstanceOf(RegistryStateError);
  });

  it('rejects a non-hex skills hash', async () => {
    const path = await tempPath();
    await writeFile(
      path,
      JSON.stringify({ ...SAMPLE, last_server_skills_md_sha256: 'not-hex' }),
      'utf8',
    );
    await expect(readRegistryState(path)).rejects.toBeInstanceOf(RegistryStateError);
  });
});
