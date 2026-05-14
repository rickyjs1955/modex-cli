import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  createAgent,
  loadCredentials,
  readChain,
  readRegistryState,
  recordEntry,
  verifyChain,
} from '../src/index.js';

import { runLogin, runLogout } from '../src/operations/login.js';
import { runBind } from '../src/operations/bind.js';
import { runAspirationsAdd } from '../src/operations/aspirations.js';

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

function jsonResponse(status: number, body: unknown): Response {
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody || body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Scripted fetch keyed by URL substring → queue of responses.
function routedFetch(routes: Record<string, Response[]>) {
  const calls: Array<{ url: string; body: unknown; auth: string | undefined }> = [];
  const cursors: Record<string, number> = {};
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: u,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers['authorization'],
    });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error(`no route for ${u}`);
    const idx = cursors[key] ?? 0;
    cursors[key] = idx + 1;
    const queue = routes[key]!;
    return queue[idx] ?? queue[queue.length - 1]!;
  });
  return { fetch: fn as unknown as typeof globalThis.fetch, calls };
}

async function tempDirs(): Promise<{ baseDir: string; configDir: string }> {
  return {
    baseDir: await mkdtemp(join(tmpdir(), 'modex-d-base-')),
    configDir: await mkdtemp(join(tmpdir(), 'modex-d-cfg-')),
  };
}

const START_PAYLOAD = {
  device_code: 'dev_abc',
  user_code: 'WXYZ-1234',
  verify_url: `${REGISTRY}/activate`,
  expires_in: 900,
  interval: 5,
};

describe('runLogin / runLogout', () => {
  it('completes the device-code flow and saves a 0600 credential', async () => {
    const { configDir } = await tempDirs();
    const { fetch } = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [
        jsonResponse(200, { error: 'authorization_pending' }),
        jsonResponse(200, { access_token: 'tok_live' }),
      ],
    });
    const stdout = captureWritable();

    const result = await runLogin({
      registry: REGISTRY,
      configDir,
      fetch,
      sleep: async () => {},
      stdout: stdout.stream,
    });

    expect(result.registryUrl).toBe(REGISTRY);
    expect(stdout.text()).toContain('WXYZ-1234');
    expect(stdout.text()).toContain(`${REGISTRY}/activate`);

    const creds = await loadCredentials(configDir);
    expect(creds?.access_token).toBe('tok_live');
    expect(creds?.registry_url).toBe(REGISTRY);
  });

  it('logout clears the credential', async () => {
    const { configDir } = await tempDirs();
    const { fetch } = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [jsonResponse(200, { access_token: 'tok_live' })],
    });
    await runLogin({
      registry: REGISTRY,
      configDir,
      fetch,
      sleep: async () => {},
      stdout: captureWritable().stream,
    });
    await runLogout({ configDir, stdout: captureWritable().stream });
    expect(await loadCredentials(configDir)).toBeNull();
  });
});

describe('runBind', () => {
  async function setupLoggedIn() {
    const { baseDir, configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-14T00:00:00.000Z', name: 'demo' });
    const { fetch } = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [jsonResponse(200, { access_token: 'tok_live' })],
    });
    await runLogin({
      registry: REGISTRY,
      configDir,
      fetch,
      sleep: async () => {},
      stdout: captureWritable().stream,
    });
    return { baseDir, configDir };
  }

  it('binds: posts SKILLS.md + provenance head, records a bound entry, writes registry.json', async () => {
    const { baseDir, configDir } = await setupLoggedIn();
    const { fetch, calls } = routedFetch({
      '/bind': [
        jsonResponse(200, {
          skills_md_sha256: 'f'.repeat(64),
          bound_at: '2026-05-14T01:00:00.000Z',
        }),
      ],
    });
    const stdout = captureWritable();

    const result = await runBind(FIXED_ID, {
      baseDir,
      configDir,
      fetch,
      ts: '2026-05-14T01:00:00.000Z',
      stdout: stdout.stream,
    });

    expect(result.boundAt).toBe('2026-05-14T01:00:00.000Z');
    // Request carried a bearer token + the bind body fields.
    expect(calls[0]!.auth).toBe('Bearer tok_live');
    const body = calls[0]!.body as Record<string, unknown>;
    expect(typeof body['skills_md']).toBe('string');
    expect(typeof body['skills_md_sha256']).toBe('string');
    expect(typeof body['provenance_head_sha256']).toBe('string');
    expect(body['aspiration_sha256s']).toEqual([]);

    // A `bound` provenance entry was appended and the chain still verifies.
    const chain = await readChain(join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(2);
    expect(chain[1]!.kind).toBe('bound');
    verifyChain(chain);

    // registry.json cache written.
    const state = await readRegistryState(join(baseDir, '.modex', FIXED_ID, 'registry.json'));
    expect(state?.last_server_skills_md_sha256).toBe('f'.repeat(64));
    expect(state?.registry_url).toBe(REGISTRY);
  });

  it('maps a 409 to an already-bound error and writes nothing locally', async () => {
    const { baseDir, configDir } = await setupLoggedIn();
    const { fetch } = routedFetch({
      '/bind': [jsonResponse(409, { error: 'already_bound' })],
    });

    await expect(
      runBind(FIXED_ID, { baseDir, configDir, fetch, stdout: captureWritable().stream }),
    ).rejects.toThrow(/already bound/);

    // Only the genesis entry — no `bound` entry, no registry.json.
    const chain = await readChain(join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(1);
    expect(await readRegistryState(join(baseDir, '.modex', FIXED_ID, 'registry.json'))).toBeNull();
  });

  it('clears the credential on a 401', async () => {
    const { baseDir, configDir } = await setupLoggedIn();
    const { fetch } = routedFetch({
      '/bind': [jsonResponse(401, { error: 'invalid_token' })],
    });

    await expect(
      runBind(FIXED_ID, { baseDir, configDir, fetch, stdout: captureWritable().stream }),
    ).rejects.toThrow(/no longer valid/i);

    expect(await loadCredentials(configDir)).toBeNull();
  });

  it('refuses to bind when not logged in', async () => {
    const { baseDir } = await tempDirs();
    const { configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-14T00:00:00.000Z' });
    await expect(
      runBind(FIXED_ID, { baseDir, configDir, stdout: captureWritable().stream }),
    ).rejects.toThrow(/Not logged in/);
  });
});

describe('runAspirationsAdd', () => {
  async function setupBound() {
    const { baseDir, configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-14T00:00:00.000Z', name: 'demo' });
    const loginFetch = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [jsonResponse(200, { access_token: 'tok_live' })],
    });
    await runLogin({
      registry: REGISTRY,
      configDir,
      fetch: loginFetch.fetch,
      sleep: async () => {},
      stdout: captureWritable().stream,
    });
    const bindFetch = routedFetch({
      '/bind': [
        jsonResponse(200, { skills_md_sha256: 'f'.repeat(64), bound_at: '2026-05-14T01:00:00.000Z' }),
      ],
    });
    await runBind(FIXED_ID, {
      baseDir,
      configDir,
      fetch: bindFetch.fetch,
      ts: '2026-05-14T01:00:00.000Z',
      stdout: captureWritable().stream,
    });
    return { baseDir, configDir };
  }

  it('posts the aspiration and records an aspiration_added entry', async () => {
    const { baseDir, configDir } = await setupBound();
    const aspFile = join(baseDir, 'goal.md');
    await writeFile(aspFile, '# Become great at code review\n', 'utf8');
    const { fetch, calls } = routedFetch({
      '/aspirations': [jsonResponse(201, { created_at: '2026-05-14T02:00:00.000Z' })],
    });
    const stdout = captureWritable();

    const result = await runAspirationsAdd(FIXED_ID, aspFile, {
      baseDir,
      configDir,
      fetch,
      ts: '2026-05-14T02:00:00.000Z',
      stdout: stdout.stream,
    });

    expect(result.source).toBe('goal.md');
    expect(calls[0]!.auth).toBe('Bearer tok_live');
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body['content']).toBe('# Become great at code review\n');
    expect(typeof body['sha256']).toBe('string');

    // genesis + bound + aspiration_added
    const chain = await readChain(join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(3);
    expect(chain[2]!.kind).toBe('aspiration_added');
    verifyChain(chain);
  });

  it('refuses when the agent is not bound', async () => {
    const { baseDir, configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-14T00:00:00.000Z' });
    // Log in but never bind.
    const loginFetch = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [jsonResponse(200, { access_token: 'tok_live' })],
    });
    await runLogin({
      registry: REGISTRY,
      configDir,
      fetch: loginFetch.fetch,
      sleep: async () => {},
      stdout: captureWritable().stream,
    });
    const aspFile = join(baseDir, 'goal.md');
    await writeFile(aspFile, '# A goal\n', 'utf8');

    await expect(
      runAspirationsAdd(FIXED_ID, aspFile, {
        baseDir,
        configDir,
        fetch: routedFetch({}).fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/not bound/);
  });

  it('bind picks up a pre-existing aspiration_added entry in aspiration_sha256s', async () => {
    // An aspiration entry can exist in the chain before bind (e.g. recorded by
    // a prior flow). Re-bind must surface its hash to the registry.
    const { baseDir, configDir } = await tempDirs();
    await createAgent({ baseDir, id: FIXED_ID, ts: '2026-05-14T00:00:00.000Z' });
    const loginFetch = routedFetch({
      '/v1/auth/cli/device-code': [jsonResponse(200, START_PAYLOAD)],
      '/v1/auth/cli/token': [jsonResponse(200, { access_token: 'tok_live' })],
    });
    await runLogin({
      registry: REGISTRY,
      configDir,
      fetch: loginFetch.fetch,
      sleep: async () => {},
      stdout: captureWritable().stream,
    });
    await recordEntry({
      path: join(baseDir, '.modex', FIXED_ID, 'provenance.jsonl'),
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: 'c'.repeat(64), aspiration_bytes: 10, source: 'g.md' },
        output: { registry_url: REGISTRY },
      },
      ts: '2026-05-14T00:30:00.000Z',
    });

    const { fetch, calls } = routedFetch({
      '/bind': [
        jsonResponse(200, { skills_md_sha256: 'f'.repeat(64), bound_at: '2026-05-14T01:00:00.000Z' }),
      ],
    });
    await runBind(FIXED_ID, {
      baseDir,
      configDir,
      fetch,
      ts: '2026-05-14T01:00:00.000Z',
      stdout: captureWritable().stream,
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body['aspiration_sha256s']).toEqual(['c'.repeat(64)]);
  });
});
