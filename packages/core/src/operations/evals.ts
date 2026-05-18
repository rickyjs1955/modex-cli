import { clearCredentials, CredentialsError, DEFAULT_REGISTRY_URL, loadCredentials } from '../credentials.js';
import { addEval, type EvalSummary, listEvals, RegistryError } from '../registry/index.js';

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalError';
  }
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

export function isEvalError(err: unknown): err is Error {
  return (
    err instanceof EvalError ||
    err instanceof RegistryError ||
    err instanceof CredentialsError
  );
}
