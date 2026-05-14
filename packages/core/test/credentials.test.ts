import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CredentialsError,
  clearCredentials,
  credentialsPath,
  loadCredentials,
  saveCredentials,
} from '../src/credentials.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'modex-cred-'));
}

const SAMPLE = {
  schema_version: 1 as const,
  access_token: 'tok_abc123',
  registry_url: 'https://registry.modex.md',
};

describe('credentials', () => {
  it('returns null when no credentials file exists', async () => {
    const dir = await tempDir();
    expect(await loadCredentials(dir)).toBeNull();
  });

  it('round-trips a saved credential', async () => {
    const dir = await tempDir();
    await saveCredentials(SAMPLE, dir);
    expect(await loadCredentials(dir)).toEqual(SAMPLE);
  });

  it('writes the credentials file with mode 0600', async () => {
    const dir = await tempDir();
    await saveCredentials(SAMPLE, dir);
    const s = await stat(credentialsPath(dir));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('overwrites an existing credential atomically', async () => {
    const dir = await tempDir();
    await saveCredentials(SAMPLE, dir);
    const updated = { ...SAMPLE, access_token: 'tok_new' };
    await saveCredentials(updated, dir);
    expect((await loadCredentials(dir))?.access_token).toBe('tok_new');
  });

  it('clearCredentials removes the file', async () => {
    const dir = await tempDir();
    await saveCredentials(SAMPLE, dir);
    await clearCredentials(dir);
    expect(await loadCredentials(dir)).toBeNull();
  });

  it('clearCredentials on a missing file is a no-op', async () => {
    const dir = await tempDir();
    await expect(clearCredentials(dir)).resolves.toBeUndefined();
  });

  it('throws CredentialsError for malformed JSON', async () => {
    const dir = await tempDir();
    await writeFile(credentialsPath(dir), '{ not json', 'utf8');
    await expect(loadCredentials(dir)).rejects.toBeInstanceOf(CredentialsError);
  });

  it('throws CredentialsError for a schema mismatch', async () => {
    const dir = await tempDir();
    await writeFile(
      credentialsPath(dir),
      JSON.stringify({ schema_version: 1, access_token: '' }),
      'utf8',
    );
    await expect(loadCredentials(dir)).rejects.toBeInstanceOf(CredentialsError);
  });

  it('does not leak the token into error messages', async () => {
    const dir = await tempDir();
    await writeFile(
      credentialsPath(dir),
      JSON.stringify({ schema_version: 99, access_token: 'tok_secret', registry_url: 'x' }),
      'utf8',
    );
    const err = await loadCredentials(dir).catch((e: Error) => e);
    expect(String(err)).not.toContain('tok_secret');
  });
});
