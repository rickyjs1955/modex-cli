import {
  clearCredentials,
  CredentialsError,
  DEFAULT_REGISTRY_URL,
  saveCredentials,
} from '../credentials.js';
import { pollForToken, RegistryError, startDeviceCode } from '../registry/index.js';

export interface LoginOptions {
  registry?: string;
  // Test injection points:
  configDir?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface LoginResult {
  registryUrl: string;
}

export async function runLogin(opts: LoginOptions = {}): Promise<LoginResult> {
  const stdout = opts.stdout ?? process.stdout;
  const registryUrl = opts.registry ?? DEFAULT_REGISTRY_URL;
  const deps = { fetch: opts.fetch, sleep: opts.sleep, now: opts.now };

  const start = await startDeviceCode(registryUrl, deps);
  stdout.write(
    `To authorize this CLI, open:\n  ${start.verify_url}\n` +
      `and enter the code:\n  ${start.user_code}\n\n` +
      `Waiting for approval…\n`,
  );

  const accessToken = await pollForToken(registryUrl, start, {
    ...deps,
    onPending: () => stdout.write('.'),
  });
  stdout.write('\n');

  await saveCredentials(
    { schema_version: 1, access_token: accessToken, registry_url: registryUrl },
    opts.configDir,
  );
  stdout.write(`Logged in to ${registryUrl}.\n`);
  return { registryUrl };
}

export interface LogoutOptions {
  configDir?: string;
  stdout?: NodeJS.WritableStream;
}

export async function runLogout(opts: LogoutOptions = {}): Promise<void> {
  const stdout = opts.stdout ?? process.stdout;
  await clearCredentials(opts.configDir);
  stdout.write('Logged out. Local credentials cleared.\n');
}

export function isLoginError(err: unknown): err is Error {
  return err instanceof RegistryError || err instanceof CredentialsError;
}
