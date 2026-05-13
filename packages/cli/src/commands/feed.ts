import { createHash } from 'node:crypto';

import {
  AgentError,
  buildDoc,
  estimateTokens,
  expandPatterns,
  ExtractionError,
  extractSkills,
  loadAgent,
  type LoadedSource,
  MODEL_ID,
  mergeSkills,
  ParseSkillsError,
  ProvenanceError,
  readAgentSkills,
  readSource,
  recordEntry,
  serialize,
  SourceError,
  writeSkillsAtomic,
} from '@modex/core';

export interface FeedOptions {
  model?: string;
  baseDir?: string;
  // Test-only injection points. `client` is typed loosely here so the CLI
  // package doesn't have to take a direct dep on @anthropic-ai/sdk; tests
  // pass a hand-rolled stub and core's extractSkills validates the call.
  client?: unknown;
  apiKey?: string;
  ts?: string | (() => string);
  // Optional source loader override for tests (PDF/EPUB/web tests use the real
  // loaders; this lets feed-level tests skip those entirely).
  loadSource?: (target: string) => Promise<LoadedSource>;
  // Stream overrides (defaults: process.stdout / process.stderr):
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface PerSourceResult {
  target: string;
  source: string;
  added: string[];
  updated: string[];
  skillsMdSha256: string;
  skillsMdBytes: number;
  estimatedTokens: number;
  warnedOverCap: boolean;
}

export interface FeedResult {
  agentId: string;
  perSource: PerSourceResult[];
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveTs(ts: FeedOptions['ts']): string {
  if (ts === undefined) return new Date().toISOString();
  if (typeof ts === 'function') return ts();
  return ts;
}

/**
 * Run a batch of feeds: expand patterns, then for each resolved source
 * sequentially read → extract → merge → write skills.md → append a feed
 * entry to provenance.jsonl.
 *
 * Sequential is load-bearing: the provenance chain depends on a single
 * writer per agent (see provenance.ts). Stop-on-first-error is fine
 * because each source's provenance entry lands before the next runs, so
 * partial progress is always durable.
 *
 * Crash-window note: writeSkillsAtomic happens before recordEntry. A crash
 * (or kill -9) between the two leaves skills.md ahead of the chain by one
 * feed. Recovery is benign — the next feed of the same source produces an
 * identical-content merge (no-op) and a new chain entry, or, if the source
 * differs, an "updated" entry. The chain stays valid; the on-disk skills.md
 * is just slightly more current than the chain's last feed entry claims.
 */
export async function runFeed(
  agentId: string,
  patterns: readonly string[],
  opts: FeedOptions = {},
): Promise<FeedResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  const agent = await loadAgent(agentId, opts.baseDir);
  const targets = await expandPatterns(patterns, { cwd: opts.baseDir });
  const loader = opts.loadSource ?? readSource;
  const perSource: PerSourceResult[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    const loaded = await loader(target);

    const incoming = await extractSkills(loaded.content, {
      source: loaded.source,
      model: opts.model,
      apiKey: opts.apiKey,
      client: opts.client as Parameters<typeof extractSkills>[1]['client'],
    });

    const existing = await readAgentSkills(agent.paths.skillsFile);
    const { merged, added, updated } = mergeSkills(existing, incoming);

    const skillsMd = serialize(buildDoc(merged));
    await writeSkillsAtomic(agent.paths.skillsFile, skillsMd);

    const skillsMdSha256 = sha256Hex(skillsMd);
    const skillsMdBytes = Buffer.byteLength(skillsMd, 'utf8');
    const sourceSha256 = sha256Hex(loaded.content);
    const sourceBytes = Buffer.byteLength(loaded.content, 'utf8');

    await recordEntry({
      path: agent.paths.provenanceFile,
      draft: {
        kind: 'feed',
        input: {
          source: loaded.source,
          source_url: loaded.source_url,
          source_kind: loaded.source_kind,
          source_sha256: sourceSha256,
          source_bytes: sourceBytes,
          model: opts.model ?? MODEL_ID,
        },
        output: {
          skills_added: added,
          skills_updated: updated,
          skills_removed: [],
          skills_md_sha256: skillsMdSha256,
          skills_md_bytes: skillsMdBytes,
        },
      },
      ts: resolveTs(opts.ts),
    });

    const estimatedTokens = estimateTokens(skillsMd);
    const warnedOverCap = estimatedTokens >= agent.config.token_cap_warn_at;
    if (warnedOverCap) {
      stderr.write(
        `warning: skills.md is ~${estimatedTokens} tokens (cap: ${agent.config.token_cap_warn_at}). ` +
          `Consider splitting into multiple agents.\n`,
      );
    }

    stdout.write(
      `[${i + 1}/${targets.length}] ${loaded.source}: ` +
        `+${added.length} added, ${updated.length} updated, sha256=${skillsMdSha256.slice(0, 12)}\n`,
    );

    perSource.push({
      target,
      source: loaded.source,
      added,
      updated,
      skillsMdSha256,
      skillsMdBytes,
      estimatedTokens,
      warnedOverCap,
    });
  }

  const totalAdded = perSource.reduce((n, r) => n + r.added.length, 0);
  const totalUpdated = perSource.reduce((n, r) => n + r.updated.length, 0);
  stdout.write(
    `done: ${perSource.length} source${perSource.length === 1 ? '' : 's'}, ` +
      `${totalAdded} added, ${totalUpdated} updated total\n`,
  );

  return { agentId: agent.config.id, perSource };
}

export function isUserFacingError(err: unknown): err is Error {
  return (
    err instanceof ExtractionError ||
    err instanceof SourceError ||
    err instanceof AgentError ||
    err instanceof ParseSkillsError ||
    err instanceof ProvenanceError
  );
}
