import { extname } from 'node:path';

import { loadEpubSource } from './epub.js';
import { loadPdfSource } from './pdf.js';
import { loadTextSource } from './text.js';
import type { LoadedSource } from './types.js';
import { SourceError } from './types.js';
import { loadWebSource } from './web.js';

export type { LoadedSource, SourceKind } from './types.js';
export { SourceError } from './types.js';

export function isWebUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://');
}

const EXT_LOADERS: Record<string, (path: string) => Promise<LoadedSource>> = {
  '.txt': loadTextSource,
  '.md': loadTextSource,
  '.pdf': loadPdfSource,
  '.epub': loadEpubSource,
};

// Dispatch a feed target (file path or URL) to the right loader. Returns the
// extracted plaintext along with provenance metadata (source name, URL, kind).
export async function readSource(target: string): Promise<LoadedSource> {
  if (isWebUrl(target)) {
    return loadWebSource(target);
  }
  const ext = extname(target).toLowerCase();
  const loader = EXT_LOADERS[ext];
  if (loader === undefined) {
    const shown = ext || '(no extension)';
    throw new SourceError(
      `Unsupported source type: ${shown}. Supported: .txt, .md, .pdf, .epub, http(s)://… URLs.`,
    );
  }
  return loader(target);
}
