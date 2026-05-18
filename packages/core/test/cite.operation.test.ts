import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  createAgent,
  loadCredentials,
  readChain,
  saveCredentials,
  verifyChain,
  writeRegistryState,
} from '../src/index.js';
import { CiteError, runCite } from '../src/operations/cite.js';

const REGISTRY = 'https://registry.example';
const FIXED_AGENT_ID = '01928c8e-1234-7abc-8def-0123456789ab';
const BIND_HASH = 'f'.repeat(64);

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

function jsonResponse(status: number, body: unknown): Response {
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody || body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function scriptedFetch(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return r!;
  });
  return { fetch: fn as unknown as typeof globalThis.fetch, calls };
}

async function setupBoundAgent(): Promise<{ baseDir: string; configDir: string }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'modex-h-base-'));
  const configDir = await mkdtemp(join(tmpdir(), 'modex-h-cfg-'));
  await createAgent({
    baseDir,
    id: FIXED_AGENT_ID,
    ts: '2026-05-15T00:00:00.000Z',
  });
  // Write registry.json directly — saves us a full bind round-trip in setup.
  await writeRegistryState(join(baseDir, '.modex', FIXED_AGENT_ID, 'registry.json'), {
    schema_version: 1,
    registry_url: REGISTRY,
    agent_id: FIXED_AGENT_ID,
    bound_at: '2026-05-14T00:00:00.000Z',
    last_server_skills_md_sha256: BIND_HASH,
  });
  await saveCredentials(
    { schema_version: 1, access_token: 'tok_live', registry_url: REGISTRY },
    configDir,
  );
  return { baseDir, configDir };
}

describe('runCite', () => {
  it('cites with the default bind hash from registry.json and records provenance', async () => {
    const { baseDir, configDir } = await setupBoundAgent();
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, { session_token: 'tok_sess_xyz', bind_hash: BIND_HASH }),
    ]);
    const stdout = captureWritable();

    const result = await runCite(FIXED_AGENT_ID, {
      baseDir,
      configDir,
      fetch,
      ts: '2026-05-15T01:00:00.000Z',
      stdout: stdout.stream,
    });

    expect(result.bindHash).toBe(BIND_HASH);
    expect(result.sessionToken).toBe('tok_sess_xyz');
    expect(result.registryUrl).toBe(REGISTRY);

    // Default path sends an empty body — server fills in bind_hash.
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({});

    // Output carries the raw token (the user needs to copy it) and the full
    // bind_hash, labelled.
    expect(stdout.text()).toContain('session_token: tok_sess_xyz');
    expect(stdout.text()).toContain(`bind_hash:     ${BIND_HASH}`);

    // Provenance: genesis + cite. session_token is hashed, NOT stored raw.
    const chain = await readChain(join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    expect(chain[1]!.kind).toBe('cite');
    if (chain[1]!.kind === 'cite') {
      expect(chain[1]!.input.bind_hash).toBe(BIND_HASH);
      // sha256 of 'tok_sess_xyz'.
      expect(chain[1]!.output.session_token_sha256).toMatch(/^[0-9a-f]{64}$/);
      // Sanity: not the raw token.
      expect(chain[1]!.output.session_token_sha256).not.toContain('tok_sess_xyz');
    }
    verifyChain(chain);
  });

  it('forwards an explicit --bind-hash and records what the server echoes', async () => {
    const { baseDir, configDir } = await setupBoundAgent();
    const explicit = '1'.repeat(64);
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, { session_token: 'tok_a', bind_hash: explicit }),
    ]);
    const result = await runCite(FIXED_AGENT_ID, {
      bindHash: explicit,
      baseDir,
      configDir,
      fetch,
      stdout: captureWritable().stream,
    });
    expect(result.bindHash).toBe(explicit);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ bind_hash: explicit });
  });

  it('refuses a non-sha256 --bind-hash before any network call', async () => {
    const { baseDir, configDir } = await setupBoundAgent();
    const { fetch } = scriptedFetch([]);
    await expect(
      runCite(FIXED_AGENT_ID, {
        bindHash: 'not-a-hex-hash',
        baseDir,
        configDir,
        fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toBeInstanceOf(CiteError);
  });

  it('refuses without credentials', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'modex-h-base-empty-'));
    const configDir = await mkdtemp(join(tmpdir(), 'modex-h-cfg-empty-'));
    await createAgent({ baseDir, id: FIXED_AGENT_ID, ts: '2026-05-15T00:00:00.000Z' });
    await expect(
      runCite(FIXED_AGENT_ID, {
        baseDir,
        configDir,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/Not logged in/);
  });

  it('refuses when the agent is not bound (no registry.json)', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'modex-h-base-unbound-'));
    const configDir = await mkdtemp(join(tmpdir(), 'modex-h-cfg-'));
    await createAgent({ baseDir, id: FIXED_AGENT_ID, ts: '2026-05-15T00:00:00.000Z' });
    await saveCredentials(
      { schema_version: 1, access_token: 'tok_live', registry_url: REGISTRY },
      configDir,
    );
    await expect(
      runCite(FIXED_AGENT_ID, {
        baseDir,
        configDir,
        fetch: scriptedFetch([]).fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/not bound/);
  });

  it('clears the credential and re-raises on a 401', async () => {
    const { baseDir, configDir } = await setupBoundAgent();
    const { fetch } = scriptedFetch([jsonResponse(401, { error: 'invalid_token' })]);
    await expect(
      runCite(FIXED_AGENT_ID, {
        baseDir,
        configDir,
        fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/no longer valid/i);
    expect(await loadCredentials(configDir)).toBeNull();
  });

  it('refuses to record a citation when the server returns a non-sha256 bind_hash', async () => {
    const { baseDir, configDir } = await setupBoundAgent();
    const { fetch } = scriptedFetch([
      jsonResponse(200, { session_token: 'tok', bind_hash: 'definitely-not-hex' }),
    ]);
    await expect(
      runCite(FIXED_AGENT_ID, {
        baseDir,
        configDir,
        fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/non-sha256 bind_hash/);
    // No cite entry written.
    const chain = await readChain(join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(1);
  });
});
