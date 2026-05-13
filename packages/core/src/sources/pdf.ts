import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { LoadedSource } from './types.js';
import { SourceError } from './types.js';

export async function loadPdfSource(path: string): Promise<LoadedSource> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    throw new SourceError(`Could not read ${path}: ${(err as Error).message}`);
  }

  // unpdf is heavy and pulls a WASM-ish runtime; import it lazily so users who
  // never feed a PDF don't pay the startup cost.
  const { extractText } = await import('unpdf');

  let result: { totalPages: number; text: string | string[] };
  try {
    result = await extractText(new Uint8Array(bytes), { mergePages: true });
  } catch (err) {
    throw new SourceError(`Could not parse PDF ${path}: ${(err as Error).message}`);
  }

  const text = Array.isArray(result.text) ? result.text.join('\n') : result.text;
  if (text.trim().length === 0) {
    throw new SourceError(
      `PDF ${path} extracted to empty text (${result.totalPages} pages). Likely an image-only/scanned PDF; OCR is out of scope for Phase C.`,
    );
  }

  return {
    source: basename(path),
    source_url: null,
    source_kind: 'pdf',
    content: text,
  };
}
