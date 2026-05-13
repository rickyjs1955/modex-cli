import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { LoadedSource, SourceKind } from './types.js';
import { SourceError } from './types.js';

const KIND_BY_EXT: Record<string, SourceKind> = {
  '.txt': 'text',
  '.md': 'markdown',
};

export const TEXT_EXTENSIONS = Object.keys(KIND_BY_EXT);

export function isTextPath(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(KIND_BY_EXT, extname(path).toLowerCase());
}

export async function loadTextSource(path: string): Promise<LoadedSource> {
  const ext = extname(path).toLowerCase();
  const kind = KIND_BY_EXT[ext];
  if (kind === undefined) {
    throw new SourceError(
      `Not a text source: ${path} (extension ${ext || '(none)'} is not .txt or .md).`,
    );
  }
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (err) {
    throw new SourceError(`Could not read ${path}: ${(err as Error).message}`);
  }
  return {
    source: basename(path),
    source_url: null,
    source_kind: kind,
    content,
  };
}
