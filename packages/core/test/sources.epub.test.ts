import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadEpubSource } from '../src/sources/epub.js';
import { SourceError } from '../src/sources/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/sample.epub');

describe('loadEpubSource', () => {
  it('extracts text from all spine chapters', async () => {
    const result = await loadEpubSource(FIXTURE);
    expect(result.source).toBe('sample.epub');
    expect(result.source_kind).toBe('epub');
    expect(result.source_url).toBeNull();
    expect(result.content).toContain('Chapter One');
    expect(result.content).toContain('slow down before responding');
    expect(result.content).toContain('Chapter Two');
    expect(result.content).toContain('five whys');
    // Tags are stripped
    expect(result.content).not.toContain('<h1>');
    expect(result.content).not.toContain('<p>');
  });

  it('throws SourceError for a non-EPUB file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modex-epub-bad-'));
    const bad = join(dir, 'bad.epub');
    await writeFile(bad, 'not an epub', 'utf8');
    await expect(loadEpubSource(bad)).rejects.toBeInstanceOf(SourceError);
  });
});
