import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadPdfSource } from '../src/sources/pdf.js';
import { SourceError } from '../src/sources/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/sample.pdf');

describe('loadPdfSource', () => {
  it('extracts text from a valid PDF', async () => {
    const result = await loadPdfSource(FIXTURE);
    expect(result.source).toBe('sample.pdf');
    expect(result.source_kind).toBe('pdf');
    expect(result.source_url).toBeNull();
    expect(result.content).toContain('Hello PDF world');
  });

  it('throws SourceError for a non-existent file', async () => {
    await expect(loadPdfSource('/tmp/does-not-exist-modex.pdf')).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it('throws SourceError for a corrupt PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modex-pdf-bad-'));
    const bad = join(dir, 'bad.pdf');
    await writeFile(bad, 'not a pdf', 'utf8');
    await expect(loadPdfSource(bad)).rejects.toBeInstanceOf(SourceError);
  });
});
