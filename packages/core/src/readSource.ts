import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const ALLOWED_EXTS = new Set(['.txt', '.md']);

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface LoadedSource {
  basename: string;
  content: string;
}

export async function readSource(path: string): Promise<LoadedSource> {
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    const shown = ext || '(no extension)';
    throw new SourceError(
      `Unsupported file type: ${shown}. Phase A only accepts .txt and .md. PDF/EPUB/web arrive in Phase C.`,
    );
  }
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (err) {
    throw new SourceError(`Could not read ${path}: ${(err as Error).message}`);
  }
  return { basename: basename(path), content };
}
