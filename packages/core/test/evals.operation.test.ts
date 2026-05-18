import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  createAgent,
  loadCredentials,
  readChain,
  recordEntry,
  saveCredentials,
  verifyChain,
} from '../src/index.js';
import {
  EvalError,
  runEvalAdd,
  runEvalList,
  runEvalResults,
  runEvalRun,
} from '../src/operations/evals.js';

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

// Route fetches by URL substring → queue of responses, matching the helper
// in registry.operation.test.ts. Lets runEvalRun's multi-call flow (listEvals
// + postEvalRun) share one fetch stub.
function routedFetch(routes: Record<string, Response[]>) {
  const calls: Array<{ url: string; method: string; body: unknown; auth: string | undefined }> = [];
  const cursors: Record<string, number> = {};
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: u,
      method: (init?.method ?? 'GET').toUpperCase(),
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

function fakeAnthropicClient(scripts: Array<{ stop_reason?: string; content: unknown[] }>) {
  let i = 0;
  const calls: Array<Record<string, unknown>> = [];
  const create = vi.fn(async (args: Record<string, unknown>) => {
    calls.push(args);
    const r = scripts[i] ?? scripts[scripts.length - 1]!;
    i++;
    return {
      id: `msg_${i}`,
      type: 'message',
      role: 'assistant',
      model: (args['model'] as string) ?? 'claude-haiku-4-5-20251001',
      stop_reason: r.stop_reason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: r.content,
    };
  });
  return { client: { messages: { create } } as unknown, calls, create };
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const ASP_A = 'a'.repeat(64);
const ASP_B = 'b'.repeat(64);
const FIXED_AGENT_ID = '01928c8e-1234-7abc-8def-0123456789ab';

async function setupAgentWithSkillsAndAspiration(
  pinnedHash: string,
): Promise<{ baseDir: string; skillsMd: string }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'modex-g-base-'));
  await createAgent({
    baseDir,
    id: FIXED_AGENT_ID,
    ts: '2026-05-15T00:00:00.000Z',
    name: 'demo',
  });
  const skillsMd = '---\nschema_version: 0\n---\n# Skills\n\n- be-thoughtful\n';
  await writeFile(join(baseDir, '.modex', FIXED_AGENT_ID, 'skills.md'), skillsMd, 'utf8');
  await recordEntry({
    path: join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'),
    draft: {
      kind: 'aspiration_added',
      input: { aspiration_sha256: pinnedHash, aspiration_bytes: 12, source: 'goal.md' },
      output: { registry_url: REGISTRY },
    },
    ts: '2026-05-15T00:01:00.000Z',
  });
  return { baseDir, skillsMd };
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

describe('runEvalRun', () => {
  const EVAL_TEXT = 'Does the agent push back when contradicted?';
  const RUBRIC = 'pass if the response refuses to flatter';

  it('runs a single eval via --aspiration, marks it, POSTs, and records provenance', async () => {
    const { baseDir, skillsMd } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();

    const { fetch, calls } = routedFetch({
      // listEvals(ASP_A) → one eval
      [`/v1/aspirations/${ASP_A}/evals`]: [
        jsonResponse(200, {
          evals: [{ eval_id: 'eval_one', text: EVAL_TEXT, mark_rubric: RUBRIC }],
        }),
      ],
      // postEvalRun
      [`/v1/agents/${FIXED_AGENT_ID}/eval-runs`]: [
        jsonResponse(201, { run_id: 'run_alpha', created_at: '2026-05-15T02:00:00.000Z' }),
      ],
    });
    const { client } = fakeAnthropicClient([
      { content: [{ type: 'text', text: 'I disagree — your premise is wrong.' }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_mark',
            input: { pass: true, rationale: 'response refused to flatter' },
          },
        ],
      },
    ]);
    const stdout = captureWritable();

    const result = await runEvalRun(FIXED_AGENT_ID, {
      aspirationHash: ASP_A,
      baseDir,
      configDir,
      fetch,
      client,
      ts: '2026-05-15T02:00:00.000Z',
      stdout: stdout.stream,
    });

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      evalId: 'eval_one',
      aspirationHash: ASP_A,
      runId: 'run_alpha',
      mark: { pass: true, rationale: 'response refused to flatter' },
    });
    expect(stdout.text()).toMatch(/PASS/);

    // POST body carried the right fields, bearer auth, and the model used.
    const postCall = calls.find((c) => c.url.includes('/eval-runs') && c.method === 'POST')!;
    expect(postCall.auth).toBe('Bearer tok_live');
    const postBody = postCall.body as Record<string, unknown>;
    expect(postBody['eval_id']).toBe('eval_one');
    expect(postBody['aspiration_sha256']).toBe(ASP_A);
    expect(postBody['agent_skills_md_sha256']).toBe(sha256Hex(skillsMd));
    expect(postBody['mark']).toEqual({ pass: true, rationale: 'response refused to flatter' });
    expect(typeof postBody['transcript_excerpt']).toBe('string');

    // Local provenance: genesis + aspiration_added + eval_run. Chain still verifies.
    const chain = await readChain(join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'));
    expect(chain).toHaveLength(3);
    expect(chain[2]!.kind).toBe('eval_run');
    if (chain[2]!.kind === 'eval_run') {
      expect(chain[2]!.output.run_id).toBe('run_alpha');
      expect(chain[2]!.output.mark_pass).toBe(true);
    }
    verifyChain(chain);
  });

  it('runs every eval on the aspiration when --eval-id is omitted', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();

    const { fetch, calls } = routedFetch({
      [`/v1/aspirations/${ASP_A}/evals`]: [
        jsonResponse(200, {
          evals: [
            { eval_id: 'eval_one', text: 'first', mark_rubric: 'r1' },
            { eval_id: 'eval_two', text: 'second' }, // no rubric → mark=null path
          ],
        }),
      ],
      [`/v1/agents/${FIXED_AGENT_ID}/eval-runs`]: [
        jsonResponse(201, { run_id: 'run_1' }),
        jsonResponse(201, { run_id: 'run_2' }),
      ],
    });
    const { client } = fakeAnthropicClient([
      // eval 1: run + mark
      { content: [{ type: 'text', text: 'response 1' }] },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'emit_mark',
            input: { pass: false, rationale: 'failed' },
          },
        ],
      },
      // eval 2: run only (no rubric)
      { content: [{ type: 'text', text: 'response 2' }] },
    ]);
    const stdout = captureWritable();

    const result = await runEvalRun(FIXED_AGENT_ID, {
      aspirationHash: ASP_A,
      baseDir,
      configDir,
      fetch,
      client,
      stdout: stdout.stream,
    });

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]!.mark).toEqual({ pass: false, rationale: 'failed' });
    expect(result.runs[1]!.mark).toBeNull();
    // Two POST bodies — second carried mark: null.
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect((posts[1]!.body as Record<string, unknown>)['mark']).toBeNull();
    expect(stdout.text()).toMatch(/FAIL/);
    expect(stdout.text()).toMatch(/NO-MARK/);
  });

  it('finds an eval across pinned aspirations when only --eval-id is supplied', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    // Pin a second aspiration so the scan has to skip the first.
    await recordEntry({
      path: join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'),
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: ASP_B, aspiration_bytes: 5, source: 'g2.md' },
        output: { registry_url: REGISTRY },
      },
      ts: '2026-05-15T00:02:00.000Z',
    });
    const configDir = await tempConfigWithCreds();

    const { fetch } = routedFetch({
      // Scan ASP_A first (no match), then ASP_B (match).
      [`/v1/aspirations/${ASP_A}/evals`]: [jsonResponse(200, { evals: [] })],
      [`/v1/aspirations/${ASP_B}/evals`]: [
        jsonResponse(200, {
          evals: [{ eval_id: 'eval_target', text: 'probe text' }],
        }),
      ],
      [`/v1/agents/${FIXED_AGENT_ID}/eval-runs`]: [
        jsonResponse(201, { run_id: 'run_found' }),
      ],
    });
    const { client } = fakeAnthropicClient([
      { content: [{ type: 'text', text: 'response' }] },
    ]);

    const result = await runEvalRun(FIXED_AGENT_ID, {
      evalId: 'eval_target',
      baseDir,
      configDir,
      fetch,
      client,
      stdout: captureWritable().stream,
    });
    expect(result.runs[0]!.aspirationHash).toBe(ASP_B);
  });

  it('refuses when neither --aspiration nor --eval-id is supplied', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        baseDir,
        configDir,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/--eval-id or --aspiration/);
  });

  it('refuses when the aspiration is not pinned to the agent', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        aspirationHash: ASP_B, // different — not pinned
        baseDir,
        configDir,
        fetch: scriptedFetch([]).fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/not pinned aspiration/);
  });

  it('refuses --eval-id when no aspirations are pinned at all', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'modex-g-base-'));
    await createAgent({
      baseDir,
      id: FIXED_AGENT_ID,
      ts: '2026-05-15T00:00:00.000Z',
    });
    await writeFile(
      join(baseDir, '.modex', FIXED_AGENT_ID, 'skills.md'),
      '---\nschema_version: 0\n---\n# Skills\n',
      'utf8',
    );
    const configDir = await tempConfigWithCreds();
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        evalId: 'eval_x',
        baseDir,
        configDir,
        fetch: scriptedFetch([]).fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/no aspirations pinned/);
  });

  it('refuses when an agent has no SKILLS.md (never fed)', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'modex-g-base-'));
    await createAgent({ baseDir, id: FIXED_AGENT_ID, ts: '2026-05-15T00:00:00.000Z' });
    // Pin an aspiration but never feed → no skills.md
    await recordEntry({
      path: join(baseDir, '.modex', FIXED_AGENT_ID, 'provenance.jsonl'),
      draft: {
        kind: 'aspiration_added',
        input: { aspiration_sha256: ASP_A, aspiration_bytes: 5, source: 'g.md' },
        output: { registry_url: REGISTRY },
      },
      ts: '2026-05-15T00:01:00.000Z',
    });
    const configDir = await tempConfigWithCreds();
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        aspirationHash: ASP_A,
        baseDir,
        configDir,
        fetch: scriptedFetch([]).fetch,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/no SKILLS\.md yet/);
  });

  it('refuses without credentials', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await mkdtemp(join(tmpdir(), 'modex-g-cfg-empty-'));
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        aspirationHash: ASP_A,
        baseDir,
        configDir,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/Not logged in/);
  });

  it('clears the credential and re-raises on a 401 from the POST', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();
    const { fetch } = routedFetch({
      [`/v1/aspirations/${ASP_A}/evals`]: [
        jsonResponse(200, { evals: [{ eval_id: 'e', text: 'probe' }] }),
      ],
      [`/v1/agents/${FIXED_AGENT_ID}/eval-runs`]: [
        jsonResponse(401, { error: 'invalid_token' }),
      ],
    });
    const { client } = fakeAnthropicClient([
      { content: [{ type: 'text', text: 'response' }] },
    ]);
    await expect(
      runEvalRun(FIXED_AGENT_ID, {
        aspirationHash: ASP_A,
        baseDir,
        configDir,
        fetch,
        client,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/no longer valid/i);
    expect(await loadCredentials(configDir)).toBeNull();
  });

  it('reports the eval index in the execution error message', async () => {
    const { baseDir } = await setupAgentWithSkillsAndAspiration(ASP_A);
    const configDir = await tempConfigWithCreds();
    const { fetch } = routedFetch({
      [`/v1/aspirations/${ASP_A}/evals`]: [
        jsonResponse(200, { evals: [{ eval_id: 'eval_one', text: 'probe', mark_rubric: 'r' }] }),
      ],
    });
    // Marker doesn't emit emit_mark → EvalExecutionError.
    const { client } = fakeAnthropicClient([
      { content: [{ type: 'text', text: 'response' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I refuse' }] },
    ]);
    const err = (await runEvalRun(FIXED_AGENT_ID, {
      aspirationHash: ASP_A,
      baseDir,
      configDir,
      fetch,
      client,
      stdout: captureWritable().stream,
    }).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/\[1\/1\] eval_one/);
  });
});

describe('runEvalResults', () => {
  it('lists runs as TSV', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch, calls } = scriptedFetch([
      jsonResponse(200, {
        runs: [
          {
            run_id: 'run_a',
            eval_id: 'eval_x',
            mark: { pass: true, rationale: 'looked good' },
            transcript_excerpt: 'agent said',
            created_at: '2026-05-15T01:00:00Z',
          },
          {
            run_id: 'run_b',
            eval_id: 'eval_y',
            mark: { pass: false, rationale: 'flattered the user' },
            transcript_excerpt: 'agent said again',
            created_at: '2026-05-15T01:02:00Z',
          },
          {
            run_id: 'run_c',
            eval_id: 'eval_z',
            mark: null,
            transcript_excerpt: 'no rubric',
          },
        ],
      }),
    ]);
    const stdout = captureWritable();
    const result = await runEvalResults(FIXED_AGENT_ID, {
      configDir,
      fetch,
      stdout: stdout.stream,
    });

    expect(result.runs).toHaveLength(3);
    // No filter → URL must not contain ?eval_id
    expect(calls[0]!.url).not.toContain('?eval_id');

    const lines = stdout.text().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('run_a\t2026-05-15T01:00:00Z\teval_x\tPASS\tlooked good');
    expect(lines[1]).toContain('FAIL');
    expect(lines[2]).toContain('NO-MARK');
  });

  it('passes --eval-id through as a query param', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch, calls } = scriptedFetch([jsonResponse(200, { runs: [] })]);
    await runEvalResults(FIXED_AGENT_ID, {
      evalId: 'eval_target',
      configDir,
      fetch,
      stdout: captureWritable().stream,
    });
    expect(calls[0]!.url).toContain('?eval_id=eval_target');
  });

  it('reports "no eval runs" when the registry returns an empty list', async () => {
    const configDir = await tempConfigWithCreds();
    const { fetch } = scriptedFetch([jsonResponse(200, { runs: [] })]);
    const stdout = captureWritable();
    await runEvalResults(FIXED_AGENT_ID, {
      configDir,
      fetch,
      stdout: stdout.stream,
    });
    expect(stdout.text()).toMatch(/no eval runs/);
  });

  it('refuses without credentials', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'modex-g-cfg-empty-'));
    await expect(
      runEvalResults(FIXED_AGENT_ID, {
        configDir,
        stdout: captureWritable().stream,
      }),
    ).rejects.toThrow(/Not logged in/);
  });
});
