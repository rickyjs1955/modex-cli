import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AgentError, loadAgent } from '../agent.js';
import { clearCredentials, CredentialsError, DEFAULT_REGISTRY_URL, loadCredentials } from '../credentials.js';
import { EvalExecutionError, executeEval, type Mark } from '../evalExecute.js';
import { MODEL_ID } from '../prompt.js';
import {
  type AspirationAddedEntry,
  type EvalRunEntry,
  type ProvenanceEntry,
  ProvenanceError,
  readChain,
  recordEntry,
} from '../provenance.js';
import {
  addEval,
  type EvalSummary,
  type EvalRunSummary,
  listEvalRuns,
  listEvals,
  postEvalRun,
  RegistryError,
} from '../registry/index.js';

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
}

const isAspirationAdded = (e: ProvenanceEntry): e is AspirationAddedEntry =>
  e.kind === 'aspiration_added';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Same cap as the registry POST body. The full bytes get hashed for
// provenance; the registry only sees the excerpt.
const MAX_TRANSCRIPT_EXCERPT_BYTES = 8_192;

function truncateForRegistry(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_TRANSCRIPT_EXCERPT_BYTES) return text;
  return (
    text.slice(0, MAX_TRANSCRIPT_EXCERPT_BYTES) +
    '\n[truncated — see provenance transcript_sha256 for full response]'
  );
}

// `eval add` and `eval list` are aspiration-scoped, not agent-scoped:
// evals attach to an aspiration on the registry and may be shared across
// every agent that pins that aspiration. There is no obvious local agent to
// record provenance against, so neither op touches `.modex/`. The local
// provenance chain only gains an entry in Phase G's `eval run`, which IS
// agent-scoped (running an eval against a specific agent).
//
// Auth resolution: the registry URL comes from the saved credentials when
// available, falling back to DEFAULT_REGISTRY_URL otherwise. `eval add`
// requires login (POST). `eval list` requires login today too — we can relax
// to anonymous reads later without a client change because the registry
// client already takes auth as optional internally.

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function assertAspirationHash(hash: string): void {
  if (!SHA256_HEX_RE.test(hash)) {
    throw new EvalError(
      `Aspiration hash must be a 64-character hex sha256 (got "${hash}"). ` +
        `Use \`modex aspirations list <agent-id>\` to find the hash you want.`,
    );
  }
}

export interface EvalAddOptions {
  text: string;
  markRubric?: string;
  registry?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface EvalAddResult {
  evalId: string;
  aspirationHash: string;
  registryUrl: string;
  createdAt: string | null;
}

export async function runEvalAdd(
  aspirationHash: string,
  opts: EvalAddOptions,
): Promise<EvalAddResult> {
  const stdout = opts.stdout ?? process.stdout;
  assertAspirationHash(aspirationHash);
  if (opts.text.trim().length === 0) {
    throw new EvalError('Eval text is empty. Pass a non-empty --text.');
  }

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }
  const registryUrl = opts.registry ?? credentials.registry_url ?? DEFAULT_REGISTRY_URL;

  let response;
  try {
    response = await addEval(
      registryUrl,
      aspirationHash,
      credentials.access_token,
      { text: opts.text, ...(opts.markRubric ? { mark_rubric: opts.markRubric } : {}) },
      { fetch: opts.fetch },
    );
  } catch (err) {
    if (err instanceof RegistryError && err.status === 401) {
      await clearCredentials(opts.configDir);
      throw new RegistryError(
        'Your registry token is no longer valid and has been cleared. Run `modex login` again.',
        { status: 401 },
      );
    }
    throw err;
  }

  stdout.write(
    `Added eval to aspiration ${aspirationHash.slice(0, 12)}…\n` +
      `  eval_id:    ${response.eval_id}\n` +
      `  registry:   ${registryUrl}\n`,
  );

  return {
    evalId: response.eval_id,
    aspirationHash,
    registryUrl,
    createdAt: response.created_at ?? null,
  };
}

export interface EvalListOptions {
  registry?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface EvalListResult {
  aspirationHash: string;
  registryUrl: string;
  evals: EvalSummary[];
}

export async function runEvalList(
  aspirationHash: string,
  opts: EvalListOptions = {},
): Promise<EvalListResult> {
  const stdout = opts.stdout ?? process.stdout;
  assertAspirationHash(aspirationHash);

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }
  const registryUrl = opts.registry ?? credentials.registry_url ?? DEFAULT_REGISTRY_URL;

  let response;
  try {
    response = await listEvals(
      registryUrl,
      aspirationHash,
      credentials.access_token,
      { fetch: opts.fetch },
    );
  } catch (err) {
    if (err instanceof RegistryError && err.status === 401) {
      await clearCredentials(opts.configDir);
      throw new RegistryError(
        'Your registry token is no longer valid and has been cleared. Run `modex login` again.',
        { status: 401 },
      );
    }
    throw err;
  }

  if (response.evals.length === 0) {
    stdout.write(`(no evals on aspiration ${aspirationHash.slice(0, 12)}…)\n`);
  } else {
    for (const e of response.evals) {
      // Tab-separated; first column is the eval id, rest is a single-line
      // preview of the eval prompt (newlines collapsed) for easy `grep`.
      const preview = e.text.replace(/\s+/g, ' ').slice(0, 80);
      const createdAt = e.created_at ?? '';
      stdout.write(`${e.eval_id}\t${createdAt}\t${preview}\n`);
    }
  }

  return { aspirationHash, registryUrl, evals: response.evals };
}

// --- eval run -------------------------------------------------------------
//
// Local-execution design (see CHANGELOG / NOTES.md): the CLI calls Anthropic
// against the user's own ANTHROPIC_API_KEY, then POSTs the resulting
// {mark, transcript_excerpt} up to the registry. The server is a passive
// recipient that stores outcomes for substrate enrichment, not the
// orchestrator. The initiating user pays in tokens.
//
// Resolution rules for which eval(s) to run:
//   - --aspiration <hash>           → list all evals on that aspiration
//   - --eval-id <id>                → scan the agent's pinned aspirations to
//                                     find the eval
//   - both                          → fast path: listEvals(hash) then filter
//   - neither                       → error
//
// The agent must have the relevant aspiration pinned locally (the chain has
// an `aspiration_added` entry for it). This is a client-side ergonomic check
// — it stops you from running probes the agent never agreed to.
//
// Per-eval steps: execute (run + optional mark) → POST to registry →
// recordEntry. Stop-on-first-error: if a POST fails after a successful
// model call, the user has spent tokens with nothing recorded. They have to
// re-run that one eval. NOTES.md tracks a "stash failed POST locally for
// retry" idea for later.

export interface EvalRunOptions {
  aspirationHash?: string;
  evalId?: string;
  registry?: string;
  baseDir?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  // Anthropic injection points for tests. The same shape extract.ts uses.
  apiKey?: string;
  client?: unknown;
  model?: string;
  ts?: string | (() => string);
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface PerEvalRunResult {
  evalId: string;
  aspirationHash: string;
  runId: string;
  mark: Mark | null;
  transcriptSha256: string;
  model: string;
}

export interface EvalRunResult {
  agentId: string;
  registryUrl: string;
  runs: PerEvalRunResult[];
}

function resolveTs(ts: EvalRunOptions['ts']): string {
  if (ts === undefined) return new Date().toISOString();
  if (typeof ts === 'function') return ts();
  return ts;
}

async function pinnedAspirationHashes(provenanceFile: string): Promise<string[]> {
  const chain = await readChain(provenanceFile);
  return chain.filter(isAspirationAdded).map((e) => e.input.aspiration_sha256);
}

// Find which aspiration a given eval belongs to by scanning the agent's
// pinned aspirations. Used only when the user gives --eval-id without
// --aspiration. Returns [aspirationHash, evalSummary] on hit, throws
// EvalError if the eval isn't on any pinned aspiration.
async function findEvalAcrossPinnedAspirations(
  registryUrl: string,
  evalId: string,
  pinned: readonly string[],
  token: string,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<[string, EvalSummary]> {
  for (const hash of pinned) {
    const { evals } = await listEvals(registryUrl, hash, token, { fetch: fetchImpl });
    const hit = evals.find((e) => e.eval_id === evalId);
    if (hit) return [hash, hit];
  }
  throw new EvalError(
    `Eval ${evalId} is not on any aspiration this agent has pinned. Either ` +
      `pin the aspiration first (\`modex aspirations add\`) or pass ` +
      `--aspiration <hash> alongside --eval-id.`,
  );
}

export async function runEvalRun(
  agentId: string,
  opts: EvalRunOptions = {},
): Promise<EvalRunResult> {
  const stdout = opts.stdout ?? process.stdout;

  if (!opts.evalId && !opts.aspirationHash) {
    throw new EvalError('Specify --eval-id or --aspiration (or both).');
  }

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }
  const registryUrl = opts.registry ?? credentials.registry_url ?? DEFAULT_REGISTRY_URL;

  const agent = await loadAgent(agentId, opts.baseDir);

  let skillsMd: string;
  try {
    skillsMd = await readFile(agent.paths.skillsFile, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new AgentError(
        `Agent ${agentId} has no SKILLS.md yet. Run \`modex feed ${agentId} <sources>\` first.`,
      );
    }
    throw err;
  }
  if (skillsMd.trim().length === 0) {
    throw new AgentError(
      `Agent ${agentId} SKILLS.md is empty. Run \`modex feed\` to populate it before evaling.`,
    );
  }
  const agentSkillsMdSha256 = sha256Hex(skillsMd);

  const pinned = await pinnedAspirationHashes(agent.paths.provenanceFile);

  // --- Resolve which evals to run -----------------------------------------
  interface PendingEval {
    aspirationHash: string;
    summary: EvalSummary;
  }
  const pending: PendingEval[] = [];

  if (opts.aspirationHash) {
    if (!pinned.includes(opts.aspirationHash)) {
      throw new EvalError(
        `Agent ${agentId} has not pinned aspiration ${opts.aspirationHash.slice(0, 12)}…. ` +
          `Run \`modex aspirations add ${agentId} <md-file>\` for that aspiration first, or ` +
          `pick a different --aspiration from \`modex aspirations list ${agentId}\`.`,
      );
    }
    const { evals } = await listEvals(
      registryUrl,
      opts.aspirationHash,
      credentials.access_token,
      { fetch: opts.fetch },
    );
    const filtered = opts.evalId ? evals.filter((e) => e.eval_id === opts.evalId) : evals;
    if (filtered.length === 0) {
      const reason = opts.evalId
        ? `eval ${opts.evalId} not found on aspiration ${opts.aspirationHash.slice(0, 12)}…`
        : `no evals registered on aspiration ${opts.aspirationHash.slice(0, 12)}…`;
      throw new EvalError(reason);
    }
    for (const e of filtered) pending.push({ aspirationHash: opts.aspirationHash, summary: e });
  } else {
    // --eval-id alone: scan.
    if (pinned.length === 0) {
      throw new EvalError(
        `Agent ${agentId} has no aspirations pinned, so there's nothing to look up by --eval-id.`,
      );
    }
    const [aspirationHash, summary] = await findEvalAcrossPinnedAspirations(
      registryUrl,
      opts.evalId!,
      pinned,
      credentials.access_token,
      opts.fetch,
    );
    pending.push({ aspirationHash, summary });
  }

  // --- Execute sequentially ----------------------------------------------
  const runs: PerEvalRunResult[] = [];

  for (let i = 0; i < pending.length; i++) {
    const { aspirationHash, summary } = pending[i]!;
    const label = `[${i + 1}/${pending.length}] ${summary.eval_id}`;

    let execution;
    try {
      execution = await executeEval({
        skillsMd,
        evalText: summary.text,
        markRubric: summary.mark_rubric ?? null,
        apiKey: opts.apiKey,
        client: opts.client as Parameters<typeof executeEval>[0]['client'],
        model: opts.model,
      });
    } catch (err) {
      // Bubble execution errors with eval context so the user knows which one.
      throw err instanceof EvalExecutionError
        ? new EvalExecutionError(`${label}: ${err.message}`, err.cause)
        : err;
    }

    const transcriptSha256 = sha256Hex(execution.transcript);
    const markRationaleSha256 = execution.mark
      ? sha256Hex(execution.mark.rationale)
      : null;

    let response;
    try {
      response = await postEvalRun(
        registryUrl,
        agent.config.id,
        credentials.access_token,
        {
          eval_id: summary.eval_id,
          aspiration_sha256: aspirationHash,
          agent_skills_md_sha256: agentSkillsMdSha256,
          model: execution.model,
          mark: execution.mark,
          transcript_excerpt: truncateForRegistry(execution.transcript),
        },
        { fetch: opts.fetch },
      );
    } catch (err) {
      if (err instanceof RegistryError && err.status === 401) {
        await clearCredentials(opts.configDir);
        throw new RegistryError(
          'Your registry token is no longer valid and has been cleared. Run `modex login` again.',
          { status: 401 },
        );
      }
      throw err;
    }

    await recordEntry({
      path: agent.paths.provenanceFile,
      draft: {
        kind: 'eval_run',
        input: {
          eval_id: summary.eval_id,
          aspiration_sha256: aspirationHash,
          agent_skills_md_sha256: agentSkillsMdSha256,
          model: execution.model,
        },
        output: {
          run_id: response.run_id,
          mark_pass: execution.mark ? execution.mark.pass : null,
          mark_rationale_sha256: markRationaleSha256,
          transcript_sha256: transcriptSha256,
          registry_url: registryUrl,
        },
      },
      ts: resolveTs(opts.ts),
    });

    const markText = execution.mark
      ? (execution.mark.pass ? 'PASS' : 'FAIL') + ' — ' + execution.mark.rationale
      : 'NO-MARK — recorded transcript (eval had no mark_rubric)';
    stdout.write(`${label}: ${markText}\n`);

    runs.push({
      evalId: summary.eval_id,
      aspirationHash,
      runId: response.run_id,
      mark: execution.mark,
      transcriptSha256,
      model: execution.model,
    });
  }

  return { agentId: agent.config.id, registryUrl, runs };
}

// --- eval results ---------------------------------------------------------

export interface EvalResultsOptions {
  evalId?: string;
  registry?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface EvalResultsResult {
  agentId: string;
  registryUrl: string;
  runs: EvalRunSummary[];
}

function markLabel(mark: EvalRunSummary['mark']): string {
  if (mark === null || mark === undefined) return 'NO-MARK';
  return mark.pass ? 'PASS' : 'FAIL';
}

export async function runEvalResults(
  agentId: string,
  opts: EvalResultsOptions = {},
): Promise<EvalResultsResult> {
  const stdout = opts.stdout ?? process.stdout;

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }
  const registryUrl = opts.registry ?? credentials.registry_url ?? DEFAULT_REGISTRY_URL;

  let response;
  try {
    response = await listEvalRuns(
      registryUrl,
      agentId,
      credentials.access_token,
      opts.evalId ? { evalId: opts.evalId } : {},
      { fetch: opts.fetch },
    );
  } catch (err) {
    if (err instanceof RegistryError && err.status === 401) {
      await clearCredentials(opts.configDir);
      throw new RegistryError(
        'Your registry token is no longer valid and has been cleared. Run `modex login` again.',
        { status: 401 },
      );
    }
    throw err;
  }

  if (response.runs.length === 0) {
    const tail = opts.evalId ? ` for eval ${opts.evalId}` : '';
    stdout.write(`(no eval runs on ${agentId}${tail})\n`);
  } else {
    for (const r of response.runs) {
      const rationale = r.mark?.rationale ?? '';
      const oneLine = rationale.replace(/\s+/g, ' ').slice(0, 80);
      const createdAt = r.created_at ?? '';
      stdout.write(`${r.run_id}\t${createdAt}\t${r.eval_id}\t${markLabel(r.mark)}\t${oneLine}\n`);
    }
  }

  return { agentId, registryUrl, runs: response.runs };
}

// Exposed for tests that need to assert the EvalRunEntry shape.
export type { EvalRunEntry };

export function isEvalError(err: unknown): err is Error {
  return (
    err instanceof EvalError ||
    err instanceof EvalExecutionError ||
    err instanceof RegistryError ||
    err instanceof CredentialsError ||
    err instanceof AgentError ||
    err instanceof ProvenanceError
  );
}
