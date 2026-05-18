import { describe, expect, it, vi } from 'vitest';

import {
  addAspiration,
  addEval,
  bindAgent,
  listEvals,
  pollForToken,
  RegistryError,
  startDeviceCode,
  type DeviceCodeStart,
} from '../src/registry/index.js';

const REGISTRY = 'https://registry.example';

function jsonResponse(status: number, body: unknown): Response {
  // 204/205/304 must have a null body per the Response constructor.
  const nullBodyStatus = status === 204 || status === 205 || status === 304;
  return new Response(body === null || nullBodyStatus ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Build a fetch stub that returns scripted responses in order. Records the
// requests it saw so assertions can inspect URL / headers / body.
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

const noSleep = async () => {};

const START: DeviceCodeStart = {
  device_code: 'dev_abc',
  user_code: 'WXYZ-1234',
  verify_url: 'https://registry.example/activate',
  expires_in: 900,
  interval: 5,
};

describe('startDeviceCode', () => {
  it('returns the parsed device-code payload', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(200, START)]);
    const result = await startDeviceCode(REGISTRY, { fetch });
    expect(result).toEqual(START);
    expect(calls[0]!.url).toBe('https://registry.example/v1/auth/cli/device-code');
    expect(calls[0]!.init?.method).toBe('POST');
  });

  it('throws RegistryError on non-200', async () => {
    const { fetch } = scriptedFetch([jsonResponse(500, { error: 'internal' })]);
    await expect(startDeviceCode(REGISTRY, { fetch })).rejects.toBeInstanceOf(RegistryError);
  });

  it('throws RegistryError on a malformed payload', async () => {
    const { fetch } = scriptedFetch([jsonResponse(200, { device_code: 'x' })]);
    await expect(startDeviceCode(REGISTRY, { fetch })).rejects.toThrow(/malformed/);
  });
});

describe('pollForToken', () => {
  it('returns the access token once approved', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, { error: 'authorization_pending' }),
      jsonResponse(200, { error: 'authorization_pending' }),
      jsonResponse(200, { access_token: 'tok_live' }),
    ]);
    const token = await pollForToken(REGISTRY, START, { fetch, sleep: noSleep });
    expect(token).toBe('tok_live');
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('https://registry.example/v1/auth/cli/token');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ device_code: 'dev_abc' });
  });

  it('lengthens the interval on slow_down', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const { fetch } = scriptedFetch([
      jsonResponse(200, { error: 'slow_down' }),
      jsonResponse(200, { access_token: 'tok_live' }),
    ]);
    await pollForToken(REGISTRY, START, { fetch, sleep });
    // First sleep at the base 5s interval, second after slow_down → 10s.
    expect(sleeps).toEqual([5000, 10000]);
  });

  it('invokes onPending for each pending poll', async () => {
    const onPending = vi.fn();
    const { fetch } = scriptedFetch([
      jsonResponse(200, { error: 'authorization_pending' }),
      jsonResponse(200, { error: 'slow_down' }),
      jsonResponse(200, { access_token: 'tok_live' }),
    ]);
    await pollForToken(REGISTRY, START, { fetch, sleep: noSleep, onPending });
    expect(onPending).toHaveBeenCalledTimes(2);
  });

  it('throws when the device code expires before approval', async () => {
    // now() advances past the deadline on the first check after one sleep.
    let t = 0;
    const now = () => {
      t += 1_000_000;
      return t;
    };
    const { fetch } = scriptedFetch([jsonResponse(200, { error: 'authorization_pending' })]);
    await expect(
      pollForToken(REGISTRY, START, { fetch, sleep: noSleep, now }),
    ).rejects.toThrow(/expired/);
  });

  it('throws on a terminal error like access_denied', async () => {
    const { fetch } = scriptedFetch([jsonResponse(200, { error: 'access_denied' })]);
    const err = await pollForToken(REGISTRY, START, { fetch, sleep: noSleep }).catch(
      (e: RegistryError) => e,
    );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).code).toBe('access_denied');
  });
});

describe('bindAgent', () => {
  const body = {
    skills_md: '---\nschema_version: 0\n---\n',
    skills_md_sha256: 'a'.repeat(64),
    provenance_head_sha256: 'b'.repeat(64),
    aspiration_sha256s: [],
  };

  it('sends a bearer token and returns the parsed response', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, { skills_md_sha256: 'a'.repeat(64), bound_at: '2026-05-14T00:00:00Z' }),
    ]);
    const result = await bindAgent(REGISTRY, 'agent-1', 'tok_live', body, { fetch });
    expect(result.bound_at).toBe('2026-05-14T00:00:00Z');
    expect(calls[0]!.url).toBe('https://registry.example/v1/agents/agent-1/bind');
    expect((calls[0]!.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer tok_live',
    );
  });

  it('maps 409 to an already-bound RegistryError', async () => {
    const { fetch } = scriptedFetch([jsonResponse(409, { error: 'already_bound' })]);
    const err = await bindAgent(REGISTRY, 'agent-1', 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect(err).toBeInstanceOf(RegistryError);
    expect((err as RegistryError).status).toBe(409);
    expect((err as RegistryError).message).toMatch(/already bound/);
  });

  it('maps 401 to a token-invalid RegistryError', async () => {
    const { fetch } = scriptedFetch([jsonResponse(401, { error: 'invalid_token' })]);
    const err = await bindAgent(REGISTRY, 'agent-1', 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBe(401);
  });

  it('wraps transport failures with a null status', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const err = await bindAgent(REGISTRY, 'agent-1', 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBeNull();
    expect((err as RegistryError).message).toMatch(/Could not reach the registry/);
  });
});

describe('addAspiration', () => {
  const body = { sha256: 'c'.repeat(64), content: '# Aspiration\n' };

  it('posts content + hash with a bearer token', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(201, { created_at: '2026-05-14T00:00:00Z' })]);
    const result = await addAspiration(REGISTRY, 'agent-1', 'tok', body, { fetch });
    expect(result.created_at).toBe('2026-05-14T00:00:00Z');
    expect(calls[0]!.url).toBe('https://registry.example/v1/agents/agent-1/aspirations');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(body);
  });

  it('accepts an empty 2xx body', async () => {
    const { fetch } = scriptedFetch([jsonResponse(204, null)]);
    await expect(addAspiration(REGISTRY, 'agent-1', 'tok', body, { fetch })).resolves.toBeDefined();
  });

  it('maps 404 to a not-bound RegistryError', async () => {
    const { fetch } = scriptedFetch([jsonResponse(404, { error: 'not_found' })]);
    const err = await addAspiration(REGISTRY, 'agent-1', 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBe(404);
    expect((err as RegistryError).message).toMatch(/bind/);
  });
});

const ASP_HASH = 'd'.repeat(64);

describe('addEval', () => {
  const body = { text: 'Does the agent flatter when contradicted?' };

  it('posts the eval body with a bearer token and returns eval_id', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(201, { eval_id: 'eval_abc', created_at: '2026-05-15T00:00:00Z' }),
    ]);
    const result = await addEval(REGISTRY, ASP_HASH, 'tok_live', body, { fetch });
    expect(result.eval_id).toBe('eval_abc');
    expect(calls[0]!.url).toBe(`https://registry.example/v1/aspirations/${ASP_HASH}/evals`);
    expect((calls[0]!.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer tok_live',
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual(body);
  });

  it('forwards mark_rubric when supplied', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(201, { eval_id: 'eval_xyz' })]);
    await addEval(
      REGISTRY,
      ASP_HASH,
      'tok',
      { text: 'why?', mark_rubric: 'pass if response refuses to flatter' },
      { fetch },
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      text: 'why?',
      mark_rubric: 'pass if response refuses to flatter',
    });
  });

  it('maps 404 to a NOTES-pointer message (the endpoint may not exist yet)', async () => {
    const { fetch } = scriptedFetch([jsonResponse(404, { error: 'not_found' })]);
    const err = await addEval(REGISTRY, ASP_HASH, 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBe(404);
    expect((err as RegistryError).message).toMatch(/NOTES\.md/);
    expect((err as RegistryError).message).toMatch(/eval endpoints/i);
  });

  it('maps 401 to a token-invalid RegistryError', async () => {
    const { fetch } = scriptedFetch([jsonResponse(401, { error: 'invalid_token' })]);
    const err = await addEval(REGISTRY, ASP_HASH, 'tok', body, { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBe(401);
  });

  it('rejects a malformed eval-add response', async () => {
    // Missing eval_id — server contract violation.
    const { fetch } = scriptedFetch([jsonResponse(201, { created_at: 'now' })]);
    await expect(addEval(REGISTRY, ASP_HASH, 'tok', body, { fetch })).rejects.toThrow(/malformed/);
  });
});

describe('listEvals', () => {
  it('GETs with bearer auth and returns the parsed list', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, {
        evals: [
          { eval_id: 'eval_a', text: 'first', created_at: '2026-05-15T00:00:00Z' },
          { eval_id: 'eval_b', text: 'second', mark_rubric: 'pass if X' },
        ],
      }),
    ]);
    const result = await listEvals(REGISTRY, ASP_HASH, 'tok_live', { fetch });
    expect(result.evals).toHaveLength(2);
    expect(result.evals[0]!.eval_id).toBe('eval_a');
    expect(calls[0]!.init?.method).toBe('GET');
    expect((calls[0]!.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer tok_live',
    );
  });

  it('returns an empty list when the server has none', async () => {
    const { fetch } = scriptedFetch([jsonResponse(200, { evals: [] })]);
    const result = await listEvals(REGISTRY, ASP_HASH, 'tok', { fetch });
    expect(result.evals).toEqual([]);
  });

  it('maps 404 to a NOTES-pointer message', async () => {
    const { fetch } = scriptedFetch([jsonResponse(404, { error: 'not_found' })]);
    const err = await listEvals(REGISTRY, ASP_HASH, 'tok', { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBe(404);
    expect((err as RegistryError).message).toMatch(/NOTES\.md/);
  });

  it('wraps transport failures with a null status', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const err = await listEvals(REGISTRY, ASP_HASH, 'tok', { fetch }).catch(
      (e: RegistryError) => e,
    );
    expect((err as RegistryError).status).toBeNull();
  });
});
