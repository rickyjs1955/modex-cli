import { CredentialsError } from '@modexagents/core';
import { describe, expect, it } from 'vitest';

import { captureStreams, mapToolError, okResult } from '../src/tools/util.js';

describe('captureStreams', () => {
  it('captures stdout and stderr into one transcript', () => {
    const c = captureStreams();
    c.stdout.write('hello ');
    c.stdout.write('world\n');
    c.stderr.write('warning: low fuel\n');
    const text = c.text();
    expect(text).toContain('hello world');
    expect(text).toContain('warning: low fuel');
  });

  it('returns just stdout when stderr is silent', () => {
    const c = captureStreams();
    c.stdout.write('only stdout');
    expect(c.text()).toBe('only stdout');
  });

  it('returns just stderr when stdout is silent', () => {
    const c = captureStreams();
    c.stderr.write('only stderr');
    expect(c.text()).toBe('only stderr');
  });

  it('returns empty string when neither stream wrote', () => {
    const c = captureStreams();
    expect(c.text()).toBe('');
  });

  it('handles Uint8Array writes (some op paths use Buffer)', () => {
    const c = captureStreams();
    c.stdout.write(Buffer.from('binary input\n', 'utf8'));
    expect(c.text()).toBe('binary input\n');
  });
});

describe('okResult', () => {
  it('emits JSON content then transcript when both are present', () => {
    const result = okResult({ agentId: 'abc' }, 'wrote skills.md\n');
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect((result.content[0] as { text: string }).text).toContain('"agentId"');
    expect((result.content[1] as { text: string }).text).toBe('wrote skills.md\n');
  });

  it('omits the transcript block when nothing was captured', () => {
    const result = okResult({ ok: true }, '');
    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toContain('"ok"');
  });
});

describe('mapToolError', () => {
  it('returns isError with a message for user-facing errors', () => {
    const err = new CredentialsError('Not logged in. Run `modex login` first.');
    const result = mapToolError(err);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe('error: Not logged in. Run `modex login` first.');
  });

  it('rethrows for internal errors so they surface as protocol failures', () => {
    const internal = new TypeError('oops');
    expect(() => mapToolError(internal)).toThrow(internal);
  });
});
