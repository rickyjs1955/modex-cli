import {
  type AspirationRequest,
  type AspirationResponse,
  AspirationResponseSchema,
  type BindRequest,
  type BindResponse,
  BindResponseSchema,
  type DeviceCodeStart,
  DeviceCodeStartSchema,
  type EvalAddRequest,
  type EvalAddResponse,
  EvalAddResponseSchema,
  type EvalListResponse,
  EvalListResponseSchema,
  RegistryError,
  type TokenResponse,
  TokenResponseSchema,
} from './types.js';

// RFC 8628: on `slow_down` the client must lengthen the poll interval by 5s.
const SLOW_DOWN_INCREMENT_S = 5;

export interface RegistryDeps {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface ResolvedDeps {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function resolveDeps(deps: RegistryDeps = {}): ResolvedDeps {
  return {
    fetch: deps.fetch ?? globalThis.fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: deps.now ?? Date.now,
  };
}

function endpoint(registryUrl: string, path: string): string {
  return registryUrl.replace(/\/+$/, '') + path;
}

interface PostResult {
  status: number;
  json: unknown;
}

// POST JSON, parse JSON back. Transport failures become RegistryError with a
// null status; HTTP-level status is returned to the caller to interpret.
async function postJson(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  body: unknown,
  token?: string,
): Promise<PostResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new RegistryError(
      `Could not reach the registry at ${url}: ${(err as Error).message}`,
      { status: null },
    );
  }

  let json: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON body — leave json as null; caller decides based on status.
    }
  }
  return { status: response.status, json };
}

// GET counterpart to postJson, used for read-only registry endpoints (eval
// listing). Transport failures become RegistryError with a null status; HTTP
// status is returned to the caller to interpret. We keep auth optional for
// future-proofing — `listEvals` currently requires it, but a public-read
// endpoint would slot in without a client change.
async function getJson(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  token?: string,
): Promise<PostResult> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers });
  } catch (err) {
    throw new RegistryError(
      `Could not reach the registry at ${url}: ${(err as Error).message}`,
      { status: null },
    );
  }

  let json: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      // Non-JSON body — leave json as null; caller decides based on status.
    }
  }
  return { status: response.status, json };
}

function bodyErrorCode(json: unknown): string | null {
  if (json !== null && typeof json === 'object' && 'error' in json) {
    const code = (json as { error: unknown }).error;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

// --- Device-code flow -----------------------------------------------------

export async function startDeviceCode(
  registryUrl: string,
  deps?: RegistryDeps,
): Promise<DeviceCodeStart> {
  const { fetch } = resolveDeps(deps);
  const { status, json } = await postJson(
    fetch,
    endpoint(registryUrl, '/v1/auth/cli/device-code'),
    {},
  );
  if (status !== 200) {
    throw new RegistryError(
      `Registry rejected the device-code request (HTTP ${status}).`,
      { status, code: bodyErrorCode(json) },
    );
  }
  const parsed = DeviceCodeStartSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryError(
      `Registry device-code response was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      { status },
    );
  }
  return parsed.data;
}

export interface PollDeps extends RegistryDeps {
  // Called each time the registry says "still pending" — lets the CLI show
  // progress without this module touching stdout.
  onPending?: () => void;
}

// Poll the token endpoint until the user approves, the device code expires,
// or the registry returns a hard error. Honors `slow_down` (interval += 5s)
// and `expires_in` (overall deadline) from the start payload.
export async function pollForToken(
  registryUrl: string,
  start: DeviceCodeStart,
  deps?: PollDeps,
): Promise<string> {
  const { fetch, sleep, now } = resolveDeps(deps);
  const onPending = deps?.onPending;

  const deadline = now() + start.expires_in * 1000;
  let intervalS = start.interval;
  const url = endpoint(registryUrl, '/v1/auth/cli/token');

  for (;;) {
    if (now() >= deadline) {
      throw new RegistryError(
        'The login code expired before it was approved. Run `modex login` again.',
        { code: 'expired_token' },
      );
    }

    await sleep(intervalS * 1000);

    const { status, json } = await postJson(fetch, url, { device_code: start.device_code });
    const parsed = TokenResponseSchema.safeParse(json);

    if (parsed.success && 'access_token' in parsed.data) {
      return parsed.data.access_token;
    }

    const code = parsed.success && 'error' in parsed.data ? parsed.data.error : bodyErrorCode(json);

    if (code === 'authorization_pending') {
      onPending?.();
      continue;
    }
    if (code === 'slow_down') {
      intervalS += SLOW_DOWN_INCREMENT_S;
      onPending?.();
      continue;
    }

    // Any other outcome is terminal.
    throw new RegistryError(
      code
        ? `Registry refused the login: ${code}.`
        : `Registry token endpoint returned an unexpected response (HTTP ${status}).`,
      { status, code: code ?? null },
    );
  }
}

// --- Bind -----------------------------------------------------------------

export async function bindAgent(
  registryUrl: string,
  agentId: string,
  token: string,
  body: BindRequest,
  deps?: RegistryDeps,
): Promise<BindResponse> {
  const { fetch } = resolveDeps(deps);
  const { status, json } = await postJson(
    fetch,
    endpoint(registryUrl, `/v1/agents/${encodeURIComponent(agentId)}/bind`),
    body,
    token,
  );

  if (status === 401) {
    throw new RegistryError('Your registry token is no longer valid.', { status, code: bodyErrorCode(json) });
  }
  if (status === 409) {
    throw new RegistryError(
      `Agent ${agentId} is already bound to a different user. ` +
        `Re-bind is only allowed by the user who first claimed it.`,
      { status, code: bodyErrorCode(json) },
    );
  }
  if (status < 200 || status >= 300) {
    throw new RegistryError(
      `Registry rejected the bind (HTTP ${status}).`,
      { status, code: bodyErrorCode(json) },
    );
  }

  const parsed = BindResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryError(
      `Registry bind response was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      { status },
    );
  }
  return parsed.data;
}

// --- Aspirations ----------------------------------------------------------

export async function addAspiration(
  registryUrl: string,
  agentId: string,
  token: string,
  body: AspirationRequest,
  deps?: RegistryDeps,
): Promise<AspirationResponse> {
  const { fetch } = resolveDeps(deps);
  const { status, json } = await postJson(
    fetch,
    endpoint(registryUrl, `/v1/agents/${encodeURIComponent(agentId)}/aspirations`),
    body,
    token,
  );

  if (status === 401) {
    throw new RegistryError('Your registry token is no longer valid.', { status, code: bodyErrorCode(json) });
  }
  if (status === 404) {
    throw new RegistryError(
      `Agent ${agentId} is not bound on the registry. Run \`modex bind ${agentId}\` first.`,
      { status, code: bodyErrorCode(json) },
    );
  }
  if (status < 200 || status >= 300) {
    throw new RegistryError(
      `Registry rejected the aspiration (HTTP ${status}).`,
      { status, code: bodyErrorCode(json) },
    );
  }

  const parsed = AspirationResponseSchema.safeParse(json ?? {});
  if (!parsed.success) {
    throw new RegistryError(
      `Registry aspiration response was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      { status },
    );
  }
  return parsed.data;
}

// --- Evals ----------------------------------------------------------------
//
// Provisional — the server endpoints aren't built yet. A 404 here is
// ambiguous: the aspiration genuinely doesn't exist, OR this registry
// build doesn't expose eval endpoints. The response body has no field that
// distinguishes the two, so the error message mentions both possibilities
// and points at NOTES.md for the current API contract status.

const EVAL_404_MESSAGE =
  'Registry returned 404. Either no aspiration exists at this hash, or this ' +
  'registry build does not yet expose the eval endpoints. See NOTES.md ' +
  '(top of repo) for the current API contract status.';

export async function addEval(
  registryUrl: string,
  aspirationHash: string,
  token: string,
  body: EvalAddRequest,
  deps?: RegistryDeps,
): Promise<EvalAddResponse> {
  const { fetch } = resolveDeps(deps);
  const { status, json } = await postJson(
    fetch,
    endpoint(registryUrl, `/v1/aspirations/${encodeURIComponent(aspirationHash)}/evals`),
    body,
    token,
  );

  if (status === 401) {
    throw new RegistryError('Your registry token is no longer valid.', {
      status,
      code: bodyErrorCode(json),
    });
  }
  if (status === 404) {
    throw new RegistryError(EVAL_404_MESSAGE, { status, code: bodyErrorCode(json) });
  }
  if (status < 200 || status >= 300) {
    throw new RegistryError(`Registry rejected the eval (HTTP ${status}).`, {
      status,
      code: bodyErrorCode(json),
    });
  }

  const parsed = EvalAddResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryError(
      `Registry eval-add response was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      { status },
    );
  }
  return parsed.data;
}

export async function listEvals(
  registryUrl: string,
  aspirationHash: string,
  token: string,
  deps?: RegistryDeps,
): Promise<EvalListResponse> {
  const { fetch } = resolveDeps(deps);
  const { status, json } = await getJson(
    fetch,
    endpoint(registryUrl, `/v1/aspirations/${encodeURIComponent(aspirationHash)}/evals`),
    token,
  );

  if (status === 401) {
    throw new RegistryError('Your registry token is no longer valid.', {
      status,
      code: bodyErrorCode(json),
    });
  }
  if (status === 404) {
    throw new RegistryError(EVAL_404_MESSAGE, { status, code: bodyErrorCode(json) });
  }
  if (status < 200 || status >= 300) {
    throw new RegistryError(`Registry rejected the eval list (HTTP ${status}).`, {
      status,
      code: bodyErrorCode(json),
    });
  }

  const parsed = EvalListResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RegistryError(
      `Registry eval-list response was malformed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
      { status },
    );
  }
  return parsed.data;
}

export type { TokenResponse };
