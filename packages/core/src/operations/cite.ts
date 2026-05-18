import { createHash } from 'node:crypto';

import { AgentError, loadAgent } from '../agent.js';
import { clearCredentials, CredentialsError, loadCredentials } from '../credentials.js';
import { ProvenanceError, recordEntry } from '../provenance.js';
import { cite, RegistryError } from '../registry/index.js';
import { readRegistryState, RegistryStateError } from '../registryState.js';

// `cite` is the moat-naming verb (see CHANGELOG / brief). It registers an
// invocation of an agent's SKILLS.md at a specific bind hash with the
// registry, returns a session_token the caller uses downstream, and records
// the citation in the local provenance chain.
//
// Bind hash resolution:
//   - --bind-hash <hash> if supplied (we just send it; server validates)
//   - else the agent's last_server_skills_md_sha256 from registry.json
//   - if neither, error: agent isn't bound, so there's no snapshot to cite
//
// Provenance: we hash the session_token before recording so the local chain
// stays non-secret. The raw token only appears on stdout.

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export class CiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CiteError';
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface CiteOptions {
  bindHash?: string;
  baseDir?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  ts?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface CiteResult {
  agentId: string;
  registryUrl: string;
  bindHash: string;
  sessionToken: string;
}

export async function runCite(agentId: string, opts: CiteOptions = {}): Promise<CiteResult> {
  const stdout = opts.stdout ?? process.stdout;

  if (opts.bindHash !== undefined && !SHA256_HEX_RE.test(opts.bindHash)) {
    throw new CiteError(
      `--bind-hash must be a 64-character hex sha256 (got "${opts.bindHash}").`,
    );
  }

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }

  const agent = await loadAgent(agentId, opts.baseDir);

  const registryState = await readRegistryState(agent.paths.registryFile);
  if (registryState === null) {
    throw new AgentError(
      `Agent ${agentId} is not bound to a registry. Run \`modex bind ${agentId}\` first ` +
        `— a citation needs a registered snapshot to attach to.`,
    );
  }

  const registryUrl = registryState.registry_url;

  // Build the request body. Omit bind_hash entirely when the user didn't
  // supply one — the server will default to the agent's latest and echo
  // back the hash it chose, which we then record locally.
  const body = opts.bindHash ? { bind_hash: opts.bindHash } : {};

  let response;
  try {
    response = await cite(
      registryUrl,
      agent.config.id,
      credentials.access_token,
      body,
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

  // The server is the authority on which bind hash was actually cited.
  // Validate the shape before recording — a malformed echo would let a bad
  // hash into the chain.
  if (!SHA256_HEX_RE.test(response.bind_hash)) {
    throw new RegistryError(
      `Registry returned a non-sha256 bind_hash (${response.bind_hash}).`,
      { status: null },
    );
  }
  const sessionTokenSha256 = sha256Hex(response.session_token);

  await recordEntry({
    path: agent.paths.provenanceFile,
    draft: {
      kind: 'cite',
      input: { bind_hash: response.bind_hash },
      output: {
        session_token_sha256: sessionTokenSha256,
        registry_url: registryUrl,
      },
    },
    ts: opts.ts,
  });

  // Output: bind_hash + session_token labelled and aligned, matching the
  // `bind` / `aspirations add` style. The session_token is a secret — it
  // appears in stdout (so users can pipe it) but never anywhere else
  // (provenance stores only its sha256).
  stdout.write(
    `Cited ${agent.config.id} at bind_hash ${response.bind_hash.slice(0, 12)}…\n` +
      `  session_token: ${response.session_token}\n` +
      `  bind_hash:     ${response.bind_hash}\n` +
      `  registry:      ${registryUrl}\n`,
  );

  return {
    agentId: agent.config.id,
    registryUrl,
    bindHash: response.bind_hash,
    sessionToken: response.session_token,
  };
}

export function isCiteError(err: unknown): err is Error {
  return (
    err instanceof CiteError ||
    err instanceof RegistryError ||
    err instanceof CredentialsError ||
    err instanceof AgentError ||
    err instanceof ProvenanceError ||
    err instanceof RegistryStateError
  );
}
