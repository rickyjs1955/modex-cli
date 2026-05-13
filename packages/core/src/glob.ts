import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { glob } from 'tinyglobby';

import { isWebUrl } from './sources/index.js';
import { SourceError } from './sources/types.js';

const GLOB_MAGIC = /[*?[\]{}!]/;

function isGlobLike(pattern: string): boolean {
  return GLOB_MAGIC.test(pattern);
}

export interface ExpandOptions {
  cwd?: string;
}

// Expand a list of CLI patterns into concrete feed targets.
// - URLs pass through unchanged.
// - Globs (containing magic characters) expand via tinyglobby; zero matches
//   is an error (silent zero-matches mask typos).
// - Plain paths must exist and resolve to a regular file.
//
// Order is preserved: results follow the order of the input patterns. Within
// a single glob, results are sorted ascending by path so feed sequencing
// across runs is deterministic.
export async function expandPatterns(
  patterns: readonly string[],
  opts: ExpandOptions = {},
): Promise<string[]> {
  if (patterns.length === 0) {
    throw new SourceError('No patterns supplied.');
  }
  const cwd = opts.cwd ?? process.cwd();
  const out: string[] = [];

  for (const pattern of patterns) {
    if (isWebUrl(pattern)) {
      out.push(pattern);
      continue;
    }

    if (isGlobLike(pattern)) {
      const matches = await glob(pattern, { cwd, onlyFiles: true, absolute: true });
      if (matches.length === 0) {
        throw new SourceError(`Glob pattern matched zero files: ${pattern}`);
      }
      matches.sort();
      out.push(...matches);
      continue;
    }

    const abs = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
    let s;
    try {
      s = await stat(abs);
    } catch (err) {
      throw new SourceError(`Path does not exist: ${pattern} (${(err as Error).message})`);
    }
    if (!s.isFile()) {
      throw new SourceError(`Path is not a regular file: ${pattern}`);
    }
    out.push(abs);
  }

  return out;
}
