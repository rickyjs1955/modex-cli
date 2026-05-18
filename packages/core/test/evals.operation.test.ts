import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { loadCredentials, saveCredentials } from '../src/index.js';
import { EvalError, runEvalAdd, runEvalList } from '../src/operations/evals.js';

const REGISTRY = 'https://registry.example';
const ASP_HASH = 'd'.repeat(64);

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

async function tempConfigWithCreds(): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), 'modex-f-cfg-'));
  await saveCredentials(
    { schema_version: 1, access_token: 'tok_live', registry_url: REGISTRY },
    configDir,
  );
  return configDir;
}

describe('runEvalAdd', () => {
  it('posts the eval and prints the eval_id', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch, calls } = scriptedFetch([
      jsonResponse(201, { eval_id: 'eval_abc', created_at: '2026-05-15T00:00:00Z' }),
    ]);
    const stdout = captureWritable();

    const result = await runEvalAdd(ASP_HASH, {
      text: 'Does the agent push back when contradicted?',
      configDir,
      fetch,
      stdout: stdout.stream,
    });

    expect(result.evalId).toBe('eval_abc');
    expect(result.registryUrl).toBe(REGISTRY);
    expect(stdout.text()).toContain('eval_abc');
    // No agent provenance is touched — this is a pure registry op (see NOTES.md).
    expect(calls[0]!.url).toContain(`/v1/aspirations/${ASP_HASH}/evals`);
  });

  it('forwards --mark-rubric verbatim', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch, calls } = scriptedFetch([jsonResponse(201, { eval_id: 'eval_x' })]);
    await runEvalAdd(ASP_HASH, {
      text: 'why?',
      markRubric: 'pass if the response refuses to flatter',
      configDir,
      fetch,
      stdout: captureWritable().stream,
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      text: 'why?',
      mark_rubric: 'pass if the response refuses to flatter',
    });
  });

  it('refuses without credentials', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'modex-f-cfg-empty-'));
    await expect(
      runEvalAdd(ASP_HASH, { text: 'x', configDir, stdout: captureWritable().stream }),
    ).rejects.toThrow(/Not logged in/);
  });

  it('refuses a non-sha256 aspiration hash with a helpful message', async () => {
    const configDir = await tempConfigWithCreds();
    const err = (await runEvalAdd('not-a-hash', {
      text: 'x',
      configDir,
      stdout: captureWritable().stream,
    }).catch((e: Error) => e)) as Error;
    expect(err).toBeInstanceOf(EvalError);
    expect(err.message).toMatch(/aspirations list/);
  });

  it('refuses empty text', async () => {
    const configDir = await tempConfigWithCreds();
    await expect(
      runEvalAdd(ASP_HASH, { text: '   ', configDir, stdout: captureWritable().stream }),
    ).rejects.toThrow(/empty/);
  });

  it('clears the credential and re-raises on a 401', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch } = scriptedFetch([jsonResponse(401, { error: 'invalid_token' })]);
    await expect(
      runEvalAdd(ASP_HASH, {
        text: 'x',
        configDir,
        fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/no longer valid/i);
    expect(await loadCredentials(configDir)).toBeNull();
  });

  it('surfaces a 404 with the NOTES.md pointer intact', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch } = scriptedFetch([jsonResponse(404, { error: 'not_found' })]);
    await expect(
      runEvalAdd(ASP_HASH, {
        text: 'x',
        configDir,
        fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/NOTES\.md/);
  });
});

describe('runEvalList', () => {
  it('prints one tab-separated line per eval', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch } = scriptedFetch([
      jsonResponse(200, {
        evals: [
          { eval_id: 'eval_a', text: 'first eval', created_at: '2026-05-15T00:00:00Z' },
          { eval_id: 'eval_b', text: 'multi\nline\neval text', mark_rubric: 'rubric' },
        ],
      }),
    ]);
    const stdout = captureWritable();
    const result = await runEvalList(ASP_HASH, { configDir, fetch, stdout: stdout.stream });

    expect(result.evals).toHaveLength(2);
    const lines = stdout.text().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('eval_a\t2026-05-15T00:00:00Z\tfirst eval');
    // Newlines in the prompt are collapsed for grep-friendly output.
    expect(lines[1]).toContain('eval_b\t\tmulti line eval text');
  });

  it('prints a friendly message when there are no evals', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch } = scriptedFetch([jsonResponse(200, { evals: [] })]);
    const stdout = captureWritable();
    await runEvalList(ASP_HASH, { configDir, fetch, stdout: stdout.stream });
    expect(stdout.text()).toMatch(/no evals/);
  });

  it('refuses without credentials', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'modex-f-cfg-empty-'));
    await expect(
      runEvalList(ASP_HASH, { configDir, stdout: captureWritable().stream }),
    ).rejects.toThrow(/Not logged in/);
  });
});
