import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';

// Denormalized "latest bound state" cache, written to .modex/<id>/registry.json
// by `modex bind`. The provenance chain's `bound` entries are authoritative;
// this file just lets the CLI quickly answer "is this agent bound, and is the
// local skills.md ahead of what the registry last saw?" without replaying the
// chain. An agent that has never been bound simply has no registry.json.

export const REGISTRY_STATE_SCHEMA_VERSION = 1;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const RegistryStateSchema = z.object({
  schema_version: z.literal(REGISTRY_STATE_SCHEMA_VERSION),
  registry_url: z.string().url(),
  agent_id: z.string().min(1),
  bound_at: z.string().min(1),
  last_server_skills_md_sha256: z.string().regex(SHA256_HEX),
});

export type RegistryState = z.infer<typeof RegistryStateSchema>;

export class RegistryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryStateError';
  }
}

// Returns null when the agent has never been bound.
export async function readRegistryState(path: string): Promise<RegistryState | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw new RegistryStateError(`Could not read ${path}: ${e.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryStateError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  const result = RegistryStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new RegistryStateError(
      `${path} failed validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

export async function writeRegistryState(path: string, state: RegistryState): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  // Pretty-printed — humans read this file; it isn't hashed.
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}
