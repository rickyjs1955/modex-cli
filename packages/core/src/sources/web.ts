import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { LoadedSource } from './types.js';
import { SourceError } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_USER_AGENT = 'modex-cli/0.2 (+https://modex.md)';
const MAX_REDIRECTS = 10;
const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
];

export interface WebOptions {
  fetch?: typeof globalThis.fetch;
  dnsLookup?: (hostname: string) => Promise<{ address: string; family: 4 | 6 }>;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
}

// --- URL normalization ----------------------------------------------------

// Strip the fragment (server returns the same bytes regardless), lowercase
// the host, and strip default ports. Preserve query and path case — they can
// be load-bearing on case-sensitive servers.
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new SourceError(`Invalid URL: ${input}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SourceError(`Unsupported URL scheme: ${u.protocol} (only http and https are allowed).`);
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
    u.port = '';
  }
  return u.toString();
}

// --- SSRF guard -----------------------------------------------------------

// Returns true if an IPv4 address sits in a range we never want to fetch from.
// Includes loopback, RFC1918 private, link-local (incl. EC2 metadata
// 169.254.169.254), CGNAT, and the "current network" 0/8.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// IPv6: loopback, link-local fe80::/10, unique-local fc00::/7, unspecified ::,
// and IPv4-mapped (delegated to v4 check).
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // ::ffff:a.b.c.d (IPv4-mapped)
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]!);
  return false;
}

function isPrivateIP(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

async function assertPublicHost(
  hostname: string,
  lookup: (host: string) => Promise<{ address: string; family: 4 | 6 }>,
): Promise<void> {
  // Reject IP literals in the URL host outright. They bypass DNS and are the
  // obvious SSRF vector (e.g. http://169.254.169.254/metadata). URL parses
  // IPv6 hosts in bracketed form (`[::1]`); strip the brackets before
  // delegating to isIP.
  const unbracketed = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(unbracketed) !== 0) {
    throw new SourceError(
      `Refusing to fetch from an IP literal (${hostname}). Use a hostname.`,
    );
  }
  let result;
  try {
    result = await lookup(hostname);
  } catch (err) {
    throw new SourceError(`Could not resolve hostname ${hostname}: ${(err as Error).message}`);
  }
  if (isPrivateIP(result.address, result.family)) {
    throw new SourceError(
      `Refusing to fetch ${hostname}: resolves to a private/loopback address (${result.address}).`,
    );
  }
  // Note: this has a TOCTOU race against DNS rebinding (the address that fetch
  // ultimately connects to may differ from what we resolved). Acceptable for
  // Phase C; a fully ip-locked socket variant can land when web fetching
  // becomes an MCP-exposed tool.
}

// --- Body read with cap ---------------------------------------------------

async function readCappedBody(
  response: Response,
  maxBytes: number,
): Promise<{ buffer: Buffer; charset: string }> {
  const ct = response.headers.get('content-type') ?? '';
  const charset = (/charset=([^;]+)/i.exec(ct)?.[1] ?? 'utf-8').trim().toLowerCase();
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new SourceError(
      `Response is ${lengthHeader} bytes (Content-Length); exceeds limit of ${maxBytes}.`,
    );
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new SourceError(`Response body exceeded ${maxBytes} bytes.`);
    }
    return { buffer: Buffer.from(text, 'utf8'), charset };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Manual stream read so we abort the moment we cross the cap.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SourceError(`Response body exceeded ${maxBytes} bytes (streamed).`);
    }
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks), charset };
}

// --- Fetch with manual redirect chain -------------------------------------

async function fetchWithGuards(
  url: string,
  opts: Required<Pick<WebOptions, 'timeoutMs' | 'maxBytes' | 'userAgent'>> & {
    fetch: typeof globalThis.fetch;
    lookup: (host: string) => Promise<{ address: string; family: 4 | 6 }>;
  },
): Promise<{ finalUrl: string; html: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    await assertPublicHost(u.hostname, opts.lookup);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let response: Response;
    try {
      response = await opts.fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.5',
        },
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new SourceError(`Fetch timed out after ${opts.timeoutMs}ms: ${current}`);
      }
      throw new SourceError(`Fetch failed for ${current}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new SourceError(`Redirect from ${current} without a Location header.`);
      }
      const next = new URL(location, current).toString();
      const nextProto = new URL(next).protocol;
      if (nextProto !== 'http:' && nextProto !== 'https:') {
        throw new SourceError(`Redirect from ${current} to non-http(s) target ${next}.`);
      }
      current = next;
      continue;
    }

    if (!response.ok) {
      throw new SourceError(`Fetch ${current} returned HTTP ${response.status}.`);
    }

    const ctype = (response.headers.get('content-type') ?? '').toLowerCase();
    const allowed = ALLOWED_CONTENT_TYPES.some((t) => ctype.startsWith(t));
    if (!allowed) {
      throw new SourceError(
        `Fetch ${current} returned unsupported content-type: ${ctype || '(none)'}. ` +
          `Phase C web fetching accepts ${ALLOWED_CONTENT_TYPES.join(', ')}.`,
      );
    }

    const { buffer, charset } = await readCappedBody(response, opts.maxBytes);
    let html: string;
    try {
      html = new TextDecoder(charset).decode(buffer);
    } catch {
      // Unknown charset → fall back to utf-8.
      html = new TextDecoder('utf-8').decode(buffer);
    }
    return { finalUrl: current, html };
  }

  throw new SourceError(`Exceeded ${MAX_REDIRECTS} redirects starting from ${url}.`);
}

// --- Readability extraction -----------------------------------------------

async function htmlToArticleText(html: string, url: string): Promise<string> {
  const { Readability } = await import('@mozilla/readability');
  const { parseHTML } = await import('linkedom');
  const dom = parseHTML(html);
  const doc = dom.document as unknown as {
    documentURI?: string;
    querySelector(s: string): { textContent?: string | null } | null;
  };
  // Readability needs a base URL to resolve relative links it strips later.
  // linkedom doesn't set this from the fragment, so we set it manually.
  try {
    (doc as { documentURI?: string }).documentURI = url;
  } catch {
    // Some DOM impls reject assignment; safe to skip.
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const article = new Readability(doc as any).parse();
  if (article && article.textContent && article.textContent.trim().length > 0) {
    return article.textContent.trim();
  }
  // Fall back: dump body text.
  const body = doc.querySelector('body');
  const fallback = (body?.textContent ?? '').trim();
  if (fallback.length === 0) {
    throw new SourceError(`Readability and body fallback both extracted empty text for ${url}.`);
  }
  return fallback;
}

// --- Public entrypoint ----------------------------------------------------

export async function loadWebSource(target: string, opts: WebOptions = {}): Promise<LoadedSource> {
  const url = normalizeUrl(target);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const lookup =
    opts.dnsLookup ??
    (async (host: string) => {
      const r = await dnsLookup(host);
      return { address: r.address, family: (r.family === 6 ? 6 : 4) as 4 | 6 };
    });
  const { html } = await fetchWithGuards(url, {
    fetch: fetchImpl,
    lookup,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
    userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
  });
  const text = await htmlToArticleText(html, url);
  return {
    source: url,
    source_url: url,
    source_kind: 'web',
    content: text,
  };
}
