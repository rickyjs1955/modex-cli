import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { expandPatterns } from '../src/glob.js';
import { SourceError } from '../src/sources/types.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'modex-glob-'));
}

async function touch(dir: string, name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, 'x', 'utf8');
  return p;
}

describe('expandPatterns', () => {
  it('passes URLs through unchanged', async () => {
    const r = await expandPatterns(['https://example.com/a', 'http://example.com/b']);
    expect(r).toEqual(['https://example.com/a', 'http://example.com/b']);
  });

  it('expands a simple glob and sorts the results', async () => {
    const dir = await tempDir();
    await touch(dir, 'b.md');
    await touch(dir, 'a.md');
    await touch(dir, 'c.txt');
    const r = await expandPatterns(['*.md'], { cwd: dir });
    expect(r.map((p) => p.split('/').pop())).toEqual(['a.md', 'b.md']);
  });

  it('preserves pattern order across multiple inputs', async () => {
    const dir = await tempDir();
    await touch(dir, 'a.md');
    await touch(dir, 'b.md');
    const r = await expandPatterns(
      ['https://example.com/x', '*.md', 'https://example.com/y'],
      { cwd: dir },
    );
    expect(r[0]).toBe('https://example.com/x');
    expect(r[1]?.endsWith('a.md')).toBe(true);
    expect(r[2]?.endsWith('b.md')).toBe(true);
    expect(r[3]).toBe('https://example.com/y');
  });

  it('errors when a glob matches zero files', async () => {
    const dir = await tempDir();
    await expect(expandPatterns(['*.pdf'], { cwd: dir })).rejects.toBeInstanceOf(SourceError);
  });

  it('errors when a literal path does not exist', async () => {
    await expect(expandPatterns(['/tmp/modex-does-not-exist.md'])).rejects.toThrow(/does not exist/);
  });

  it('errors when a literal path is a directory', async () => {
    const dir = await tempDir();
    await expect(expandPatterns([dir])).rejects.toThrow(/not a regular file/);
  });

  it('errors when no patterns are supplied', async () => {
    await expect(expandPatterns([])).rejects.toThrow(/No patterns/);
  });

  it('resolves a relative literal path against cwd', async () => {
    const dir = await tempDir();
    await touch(dir, 'one.md');
    const r = await expandPatterns(['./one.md'], { cwd: dir });
    expect(r[0]?.endsWith('one.md')).toBe(true);
  });
});
