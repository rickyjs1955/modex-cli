import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { AgentError, loadAgent } from '../agent.js';
import { clearCredentials, CredentialsError, loadCredentials } from '../credentials.js';
import { ProvenanceError, recordEntry } from '../provenance.js';
import { addAspiration, RegistryError } from '../registry/index.js';
import { readRegistryState, RegistryStateError } from '../registryState.js';

export interface AspirationsAddOptions {
  baseDir?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  ts?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface AspirationsAddResult {
  agentId: string;
  registryUrl: string;
  aspirationSha256: string;
  source: string;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Append an aspiration to a bound agent.
 *
 * Append-only: there is deliberately no edit or delete operation — the
 * registry rejects mutation and so does this surface by omission.
 *
 * Requires a prior bind: we check the local registry.json and fail fast with
 * guidance rather than letting the registry return a 404.
 *
 * Ordering matches bind — POST first, record the `aspiration_added`
 * provenance entry only on a 2xx.
 */
export async function runAspirationsAdd(
  agentId: string,
  mdFile: string,
  opts: AspirationsAddOptions = {},
): Promise<AspirationsAddResult> {
  const stdout = opts.stdout ?? process.stdout;

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }

  const agent = await loadAgent(agentId, opts.baseDir);

  const registryState = await readRegistryState(agent.paths.registryFile);
  if (registryState === null) {
    throw new AgentError(
      `Agent ${agentId} is not bound to a registry. Run \`modex bind ${agentId}\` first.`,
    );
  }

  let content: string;
  try {
    content = await readFile(mdFile, 'utf8');
  } catch (err) {
    throw new AgentError(`Could not read aspiration file ${mdFile}: ${(err as Error).message}`);
  }
  if (content.trim().length === 0) {
    throw new AgentError(`Aspiration file ${mdFile} is empty.`);
  }

  const aspirationSha256 = sha256Hex(content);
  const source = basename(mdFile);

  try {
    await addAspiration(
      registryState.registry_url,
      agent.config.id,
      credentials.access_token,
      { sha256: aspirationSha256, content },
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
      kind: 'aspiration_added',
      input: {
        aspiration_sha256: aspirationSha256,
        aspiration_bytes: Buffer.byteLength(content, 'utf8'),
        source,
      },
      output: {
        registry_url: registryState.registry_url,
      },
    },
    ts: opts.ts,
  });

  stdout.write(
    `Added aspiration to ${agent.config.id}\n` +
      `  source: ${source}\n` +
      `  sha256: ${aspirationSha256.slice(0, 12)}…\n`,
  );

  return {
    agentId: agent.config.id,
    registryUrl: registryState.registry_url,
    aspirationSha256,
    source,
  };
}

export function isAspirationsError(err: unknown): err is Error {
  return (
    err instanceof RegistryError ||
    err instanceof CredentialsError ||
    err instanceof AgentError ||
    err instanceof ProvenanceError ||
    err instanceof RegistryStateError
  );
}
