import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

export const CREDENTIALS_SCHEMA_VERSION = 1;
export const DEFAULT_REGISTRY_URL = 'https://registry.modex.md';

export const CredentialsSchema = z.object({
  schema_version: z.literal(CREDENTIALS_SCHEMA_VERSION),
  access_token: z.string().min(1),
  registry_url: z.string().url(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

// ${XDG_CONFIG_HOME:-~/.config}/modex
export function configDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'modex');
}

export function credentialsPath(dir: string = configDir()): string {
  return join(dir, 'credentials.json');
}

// Returns null when the user has not logged in. Throws CredentialsError only
// when the file exists but is unreadable or malformed.
export async function loadCredentials(dir: string = configDir()): Promise<Credentials | null> {
  const path = credentialsPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw new CredentialsError(`Could not read ${path}: ${e.message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CredentialsError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  const result = CredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new CredentialsError(
      `${path} failed validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

// Atomic write at mode 0600. The directory is created 0700. We set the mode at
// open time AND chmod afterwards: writeFile's `mode` only applies on create and
// is still subject to umask, so the explicit chmod guarantees 0600 regardless.
export async function saveCredentials(
  credentials: Credentials,
  dir: string = configDir(),
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = credentialsPath(dir);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const body = JSON.stringify(credentials, null, 2) + '\n';
  await writeFile(tmp, body, { mode: 0o600, encoding: 'utf8' });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
}

// Remove the credentials file. Missing file is not an error — clearing an
// already-absent credential is a no-op (used on the 401 path).
export async function clearCredentials(dir: string = configDir()): Promise<void> {
  try {
    await unlink(credentialsPath(dir));
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return;
    throw new CredentialsError(`Could not clear credentials: ${e.message}`);
  }
}
