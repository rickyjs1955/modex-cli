import type { SourceKind } from '../provenance.js';

export type { SourceKind };

// What every source loader returns. The fields land directly on the
// provenance feed entry's `input` block (plus source_sha256 / source_bytes,
// which are computed from `content` by the caller).
export interface LoadedSource {
  source: string;             // basename for files, normalized URL for web
  source_url: string | null;  // null for local files
  source_kind: SourceKind;
  content: string;            // extracted plaintext
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}
