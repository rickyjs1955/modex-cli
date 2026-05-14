// Hash-chained, append-only provenance log.
//
// Concurrency: recordEntry reads the chain head, then appends. It is NOT safe
// against concurrent writers — two parallel recordEntry calls on the same path
// can race the head read and produce two entries that both claim the same
// `prev`, breaking verifyChain. modex-cli is single-process serial today and
// this assumption is fine; the MCP and parallel-batch surfaces (Phase E)
// will need an exclusive-lock variant.
// TODO(phase-e): exclusive-lock variant for parallel/MCP scenarios.

import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { z } from 'zod';

import { canonicalize, type CanonicalJson } from './canonicalJson.js';

export const PROVENANCE_SCHEMA_VERSION = 1;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const SOURCE_KINDS = ['text', 'markdown', 'pdf', 'epub', 'web'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const FeedInputSchema = z.object({
  source: z.string().min(1),
  source_url: z.union([z.string().url(), z.null()]),
  source_kind: z.enum(SOURCE_KINDS),
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

// Phase D — registry binding. Both new kinds stay at schema_version 1: they
// are *additive* (no existing entry shape changed), so the version, which
// tracks per-kind entry shape, does not move. A v1 `feed` entry written by
// Phase C and one written by Phase D are byte-identical.
const BoundInputSchema = z.object({
  skills_md_sha256: z.string().regex(SHA256_HEX),
  aspiration_sha256s: z.array(z.string().regex(SHA256_HEX)),
});
const BoundOutputSchema = z.object({
  registry_url: z.string().url(),
  bound_at: z.string().min(1),
});

const AspirationAddedInputSchema = z.object({
  aspiration_sha256: z.string().regex(SHA256_HEX),
  aspiration_bytes: z.number().int().nonnegative(),
  source: z.string().min(1),
});
const AspirationAddedOutputSchema = z.object({
  registry_url: z.string().url(),
});

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

export const BoundEntrySchema = z.object({
  ...BaseEntryFieldsSchema,
  kind: z.literal('bound'),
  input: BoundInputSchema,
  output: BoundOutputSchema,
});

export const AspirationAddedEntrySchema = z.object({
  ...BaseEntryFieldsSchema,
  kind: z.literal('aspiration_added'),
  input: AspirationAddedInputSchema,
  output: AspirationAddedOutputSchema,
});

export const ProvenanceEntrySchema = z.discriminatedUnion('kind', [
  FeedEntrySchema,
  AgentCreatedEntrySchema,
  BoundEntrySchema,
  AspirationAddedEntrySchema,
]);

// The set of `kind` values this build understands. Used by readChain to give
// a friendly "upgrade modex-cli" error when a newer build wrote a kind we
// don't recognize, instead of zod's cryptic discriminated-union failure.
export const KNOWN_ENTRY_KINDS = [
  'feed',
  'agent_created',
  'bound',
  'aspiration_added',
] as const;

export type FeedEntry = z.infer<typeof FeedEntrySchema>;
export type AgentCreatedEntry = z.infer<typeof AgentCreatedEntrySchema>;
export type BoundEntry = z.infer<typeof BoundEntrySchema>;
export type AspirationAddedEntry = z.infer<typeof AspirationAddedEntrySchema>;
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
    }
  | {
      kind: 'bound';
      input: z.input<typeof BoundInputSchema>;
      output: z.input<typeof BoundOutputSchema>;
      ts?: string;
    }
  | {
      kind: 'aspiration_added';
      input: z.input<typeof AspirationAddedInputSchema>;
      output: z.input<typeof AspirationAddedOutputSchema>;
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
    // Detect v0 chains explicitly so the user gets actionable guidance instead
    // of a generic discriminated-union schema failure.
    if (
      parsedJson !== null &&
      typeof parsedJson === 'object' &&
      'schema_version' in parsedJson &&
      (parsedJson as { schema_version: unknown }).schema_version === 0
    ) {
      throw new ProvenanceError(
        `Line ${i + 1}: provenance entry has schema_version=0 (modex-cli@0.1.x, Phase B). ` +
          `v1 (Phase C) is not backward-compatible: the feed entry shape gained source_kind and source_url. ` +
          `Create a fresh agent under .modex/, or pin to @modex/cli@0.1.x for legacy agents.`,
      );
    }
    // Forward-compat: a v1 entry with a `kind` this build doesn't know was
    // almost certainly written by a newer modex-cli. Say so plainly rather
    // than letting zod emit an opaque discriminator error.
    if (
      parsedJson !== null &&
      typeof parsedJson === 'object' &&
      'kind' in parsedJson &&
      typeof (parsedJson as { kind: unknown }).kind === 'string' &&
      !(KNOWN_ENTRY_KINDS as readonly string[]).includes((parsedJson as { kind: string }).kind)
    ) {
      throw new ProvenanceError(
        `Line ${i + 1}: provenance entry kind '${(parsedJson as { kind: string }).kind}' ` +
          `is not recognized by this build of modex-cli. It was likely written by a newer ` +
          `version — upgrade modex-cli to read this chain.`,
      );
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
