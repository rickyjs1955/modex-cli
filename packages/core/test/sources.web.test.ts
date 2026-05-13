import { describe, expect, it, vi } from 'vitest';

import { loadWebSource, normalizeUrl } from '../src/sources/web.js';
import { SourceError } from '../src/sources/types.js';

const PUBLIC_LOOKUP = vi.fn(async () => ({ address: '93.184.216.34', family: 4 as const }));

function htmlPage(body: string): string {
  return `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;
}

function makeFetch(response: Response): typeof globalThis.fetch {
  return vi.fn(async () => response) as unknown as typeof globalThis.fetch;
}

function ok(html: string, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('normalizeUrl', () => {
  it('strips fragments', () => {
    expect(normalizeUrl('https://example.com/p?q=1#section')).toBe('https://example.com/p?q=1');
  });

  it('lowercases the host but preserves path case', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path/Thing')).toBe('https://example.com/Path/Thing');
  });

  it('strips default ports', () => {
    expect(normalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
    expect(normalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
  });

  it('preserves non-default ports', () => {
    expect(normalizeUrl('https://example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow(SourceError);
    expect(() => normalizeUrl('ftp://example.com/foo')).toThrow(SourceError);
  });

  it('rejects malformed input', () => {
    expect(() => normalizeUrl('not a url')).toThrow(SourceError);
  });
});

describe('loadWebSource SSRF guards', () => {
  it('rejects IPv4 literals', async () => {
    await expect(
      loadWebSource('http://10.0.0.1/foo', {
        fetch: makeFetch(ok('<p>x</p>')),
        dnsLookup: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/IP literal/);
  });

  it('rejects IPv6 literals', async () => {
    await expect(
      loadWebSource('http://[::1]/foo', {
        fetch: makeFetch(ok('<p>x</p>')),
        dnsLookup: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/IP literal/);
  });

  it('rejects hostnames that resolve to private IPv4', async () => {
    await expect(
      loadWebSource('http://internal.corp/foo', {
        fetch: makeFetch(ok('<p>x</p>')),
        dnsLookup: vi.fn(async () => ({ address: '10.1.2.3', family: 4 as const })),
      }),
    ).rejects.toThrow(/private\/loopback/);
  });

  it('rejects hostnames that resolve to EC2 metadata link-local', async () => {
    await expect(
      loadWebSource('http://metadata.attacker.com/foo', {
        fetch: makeFetch(ok('<p>x</p>')),
        dnsLookup: vi.fn(async () => ({ address: '169.254.169.254', family: 4 as const })),
      }),
    ).rejects.toThrow(/private\/loopback/);
  });

  it('rejects loopback IPv6', async () => {
    await expect(
      loadWebSource('http://localhost.example/foo', {
        fetch: makeFetch(ok('<p>x</p>')),
        dnsLookup: vi.fn(async () => ({ address: '::1', family: 6 as const })),
      }),
    ).rejects.toThrow(/private\/loopback/);
  });

  it('allows public IPv4', async () => {
    const result = await loadWebSource('https://example.com/article', {
      fetch: makeFetch(ok(htmlPage('<article><h1>Title</h1><p>The body of the article.</p></article>'))),
      dnsLookup: PUBLIC_LOOKUP,
    });
    expect(result.source_kind).toBe('web');
    expect(result.source_url).toBe('https://example.com/article');
    expect(result.content).toContain('body of the article');
  });
});

describe('loadWebSource fetch guards', () => {
  it('rejects unsupported content-types', async () => {
    await expect(
      loadWebSource('https://example.com/x.pdf', {
        fetch: makeFetch(ok('%PDF-1.4', 'application/pdf')),
        dnsLookup: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/unsupported content-type/);
  });

  it('rejects HTTP error statuses', async () => {
    await expect(
      loadWebSource('https://example.com/missing', {
        fetch: makeFetch(new Response('', { status: 404 })),
        dnsLookup: PUBLIC_LOOKUP,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects responses with Content-Length over the cap', async () => {
    await expect(
      loadWebSource('https://example.com/big', {
        fetch: makeFetch(
          new Response('x', {
            status: 200,
            headers: { 'content-type': 'text/html', 'content-length': '99999999' },
          }),
        ),
        dnsLookup: PUBLIC_LOOKUP,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/Content-Length/);
  });

  it('follows redirects up to MAX_REDIRECTS and re-applies SSRF guard', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls++;
      if (calls === 1) {
        return new Response('', {
          status: 301,
          headers: { location: 'https://example.com/final' },
        });
      }
      return ok(htmlPage('<article><p>final content here</p></article>'));
    }) as unknown as typeof globalThis.fetch;

    const result = await loadWebSource('https://example.com/start', {
      fetch: fetcher,
      dnsLookup: PUBLIC_LOOKUP,
    });
    expect(calls).toBe(2);
    expect(result.content).toContain('final content here');
  });

  it('rejects redirect to non-http(s) target', async () => {
    const fetcher = vi.fn(async () =>
      new Response('', {
        status: 301,
        headers: { location: 'file:///etc/passwd' },
      }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      loadWebSource('https://example.com/start', { fetch: fetcher, dnsLookup: PUBLIC_LOOKUP }),
    ).rejects.toThrow(/non-http\(s\) target/);
  });

  it('strips the URL fragment when recording source/source_url', async () => {
    const result = await loadWebSource('https://example.com/article#hello', {
      fetch: makeFetch(ok(htmlPage('<article><p>plenty of content here</p></article>'))),
      dnsLookup: PUBLIC_LOOKUP,
    });
    expect(result.source).toBe('https://example.com/article');
    expect(result.source_url).toBe('https://example.com/article');
  });
});
