import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  AgentError,
  bindAgent,
  buildDoc,
  clearCredentials,
  CredentialsError,
  loadAgent,
  loadCredentials,
  ProvenanceError,
  readAgentSkills,
  readChain,
  recordEntry,
  RegistryError,
  RegistryStateError,
  serialize,
  writeRegistryState,
} from '@modex/core';

export interface BindOptions {
  baseDir?: string;
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  ts?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface BindResult {
  agentId: string;
  registryUrl: string;
  skillsMdSha256: string;
  boundAt: string;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Bind a local agent to the registry it was logged into.
 *
 * Ordering: the registry POST happens first; the local `bound` provenance
 * entry and registry.json are written only on a 2xx. This keeps the local
 * chain a subset of registry truth — a crash after a successful POST but
 * before the local write is benign, because a re-run is a same-user re-bind
 * (allowed by the registry) and simply records the entry then.
 */
export async function runBind(agentId: string, opts: BindOptions = {}): Promise<BindResult> {
  const stdout = opts.stdout ?? process.stdout;

  const credentials = await loadCredentials(opts.configDir);
  if (credentials === null) {
    throw new CredentialsError('Not logged in. Run `modex login` first.');
  }

  const agent = await loadAgent(agentId, opts.baseDir);

  // The on-disk skills.md is canonical (feed writes it via writeSkillsAtomic).
  // A never-fed agent has no file — bind the canonical empty doc.
  let skillsMd: string;
  try {
    skillsMd = await readFile(agent.paths.skillsFile, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err;
    skillsMd = serialize(buildDoc(await readAgentSkills(agent.paths.skillsFile)));
  }
  const skillsMdSha256 = sha256Hex(skillsMd);

  const chain = await readChain(agent.paths.provenanceFile);
  if (chain.length === 0) {
    throw new AgentError(
      `Agent ${agentId} has an empty provenance chain — cannot bind. The chain should ` +
        `always contain at least the agent_created entry.`,
    );
  }
  const provenanceHead = chain[chain.length - 1]!.entry_sha256;
  const aspirationSha256s = chain
    .filter((e) => e.kind === 'aspiration_added')
    .map((e) => (e as { input: { aspiration_sha256: string } }).input.aspiration_sha256);

  let response;
  try {
    response = await bindAgent(
      credentials.registry_url,
      agent.config.id,
      credentials.access_token,
      {
        skills_md: skillsMd,
        skills_md_sha256: skillsMdSha256,
        provenance_head_sha256: provenanceHead,
        aspiration_sha256s: aspirationSha256s,
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

  // Registry accepted the bind — now record it locally.
  await recordEntry({
    path: agent.paths.provenanceFile,
    draft: {
      kind: 'bound',
      input: {
        skills_md_sha256: skillsMdSha256,
        aspiration_sha256s: aspirationSha256s,
      },
      output: {
        registry_url: credentials.registry_url,
        bound_at: response.bound_at,
      },
    },
    ts: opts.ts,
  });

  await writeRegistryState(agent.paths.registryFile, {
    schema_version: 1,
    registry_url: credentials.registry_url,
    agent_id: agent.config.id,
    bound_at: response.bound_at,
    last_server_skills_md_sha256: response.skills_md_sha256,
  });

  stdout.write(
    `Bound ${agent.config.id} to ${credentials.registry_url}\n` +
      `  skills.md sha256: ${skillsMdSha256.slice(0, 12)}…\n` +
      `  bound_at:         ${response.bound_at}\n`,
  );

  return {
    agentId: agent.config.id,
    registryUrl: credentials.registry_url,
    skillsMdSha256,
    boundAt: response.bound_at,
  };
}

export function isBindError(err: unknown): err is Error {
  return (
    err instanceof RegistryError ||
    err instanceof CredentialsError ||
    err instanceof AgentError ||
    err instanceof ProvenanceError ||
    err instanceof RegistryStateError
  );
}
