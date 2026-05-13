import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { z } from 'zod';

import { canonicalize, type CanonicalJson } from './canonicalJson.js';

export const PROVENANCE_SCHEMA_VERSION = 0;

const SHA256_HEX = /^[0-9a-f]{64}$/;

const FeedInputSchema = z.object({
  source: z.string().min(1),
  source_sha256: z.string().regex(SHA256_HEX),
  source_bytes: z.number().int().nonnegative(),
  model: z.string().min(1),
});

const FeedOutputSchema = z.object({
  skills_added: z.array(z.string()),
  skills_updated: z.array(z.string()),
  skills_removed: z.array(z.string()),
  skills_md_sha256: z.string().regex(SHA256_HEX),
  skills_md_bytes: z.number().int().nonnegative(),
});

const AgentCreatedInputSchema = z.object({ name: z.string() });
const AgentCreatedOutputSchema = z.object({ agent_id: z.string().min(1) });

const BaseEntryFieldsSchema = {
  schema_version: z.literal(PROVENANCE_SCHEMA_VERSION),
  seq: z.number().int().positive(),
  ts: z.string().min(1),
  prev: z.union([z.string().regex(SHA256_HEX), z.null()]),
  entry_sha256: z.string().regex(SHA256_HEX),
};

export const FeedEntrySchema = z.object({
  ...BaseEntryFieldsSchema,
  kind: z.literal('feed'),
  input: FeedInputSchema,
  output: FeedOutputSchema,
});

export const AgentCreatedEntrySchema = z.object({
  ...BaseEntryFieldsSchema,
  kind: z.literal('agent_created'),
  input: AgentCreatedInputSchema,
  output: AgentCreatedOutputSchema,
});

export const ProvenanceEntrySchema = z.discriminatedUnion('kind', [
  FeedEntrySchema,
  AgentCreatedEntrySchema,
]);

export type FeedEntry = z.infer<typeof FeedEntrySchema>;
export type AgentCreatedEntry = z.infer<typeof AgentCreatedEntrySchema>;
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

export type EntryDraft =
  | {
      kind: 'feed';
      input: z.input<typeof FeedInputSchema>;
      output: z.input<typeof FeedOutputSchema>;
      ts?: string;
    }
  | {
      kind: 'agent_created';
      input: z.input<typeof AgentCreatedInputSchema>;
      output: z.input<typeof AgentCreatedOutputSchema>;
      ts?: string;
    };

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Hash an entry by canonicalizing every field except entry_sha256.
export function computeEntryHash(entry: Omit<ProvenanceEntry, 'entry_sha256'>): string {
  return sha256Hex(canonicalize(entry as unknown as CanonicalJson));
}

// Read all entries from a JSONL file. Missing file returns []. Each line must
// parse as an entry; the chain is NOT verified here — call verifyChain.
export async function readChain(path: string): Promise<ProvenanceEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
  if (raw.length === 0) return [];

  const lines = raw.split('\n').filter((l) => l.length > 0);
  const entries: ProvenanceEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(lines[i]!);
    } catch (err) {
      throw new ProvenanceError(`Line ${i + 1}: invalid JSON (${(err as Error).message})`);
    }
    const result = ProvenanceEntrySchema.safeParse(parsedJson);
    if (!result.success) {
      throw new ProvenanceError(
        `Line ${i + 1}: schema mismatch (${result.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; ')})`,
      );
    }
    entries.push(result.data);
  }
  return entries;
}

// Verify the chain: monotonic seq from 1, prev links match the previous
// entry's entry_sha256, and each entry_sha256 recomputes correctly.
// Throws ProvenanceError on the first violation.
export function verifyChain(entries: readonly ProvenanceEntry[]): void {
  let expectedPrev: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.seq !== i + 1) {
      throw new ProvenanceError(
        `Entry ${i}: expected seq=${i + 1}, got seq=${e.seq}`,
      );
    }
    if (e.prev !== expectedPrev) {
      throw new ProvenanceError(
        `Entry ${i} (seq=${e.seq}): prev=${e.prev ?? 'null'} does not match previous entry_sha256=${expectedPrev ?? 'null'}`,
      );
    }
    const { entry_sha256, ...rest } = e;
    const recomputed = computeEntryHash(rest as Omit<ProvenanceEntry, 'entry_sha256'>);
    if (recomputed !== entry_sha256) {
      throw new ProvenanceError(
        `Entry ${i} (seq=${e.seq}): entry_sha256 mismatch (stored=${entry_sha256}, recomputed=${recomputed})`,
      );
    }
    expectedPrev = entry_sha256;
  }
}

export interface RecordEntryOptions {
  path: string;
  draft: EntryDraft;
  // If supplied, used as the entry timestamp. Otherwise new Date().toISOString().
  ts?: string;
  // If supplied, used as the previous-entry hash and seq. Otherwise read from disk.
  prev?: string | null;
  seq?: number;
}

// Append a new entry to the chain. Reads the head from disk to determine
// seq + prev (unless provided), computes entry_sha256, then writes a single
// canonical JSON line.
//
// On disk we write the canonical form (sorted keys, no whitespace) so that
// the line bytes are byte-identical for any reader and re-canonicalization
// after parse is a no-op.
export async function recordEntry(opts: RecordEntryOptions): Promise<ProvenanceEntry> {
  let seq = opts.seq;
  let prev = opts.prev;
  if (seq === undefined || prev === undefined) {
    const existing = await readChain(opts.path);
    seq = seq ?? existing.length + 1;
    prev = prev ?? (existing.length === 0 ? null : existing[existing.length - 1]!.entry_sha256);
  }

  const ts = opts.ts ?? opts.draft.ts ?? new Date().toISOString();

  const skeleton = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    seq,
    ts,
    kind: opts.draft.kind,
    input: opts.draft.input,
    output: opts.draft.output,
    prev,
  };

  // Validate skeleton against the schema (without entry_sha256) by attaching
  // a placeholder hash, so we surface bad inputs before hashing.
  const validation = ProvenanceEntrySchema.safeParse({
    ...skeleton,
    entry_sha256: '0'.repeat(64),
  });
  if (!validation.success) {
    throw new ProvenanceError(
      `Invalid entry: ${validation.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  const entry_sha256 = computeEntryHash(skeleton as Omit<ProvenanceEntry, 'entry_sha256'>);
  const full = { ...skeleton, entry_sha256 } as ProvenanceEntry;
  const line = canonicalize(full as unknown as CanonicalJson) + '\n';
  await appendFile(opts.path, line, 'utf8');
  return full;
}
