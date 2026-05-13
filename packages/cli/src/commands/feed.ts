import { createHash } from 'node:crypto';

import {
  AgentError,
  buildDoc,
  estimateTokens,
  ExtractionError,
  extractSkills,
  loadAgent,
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
  ts?: string;
  // Stream overrides (defaults: process.stdout / process.stderr):
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface FeedResult {
  agentId: string;
  added: string[];
  updated: string[];
  skillsMdSha256: string;
  skillsMdBytes: number;
  estimatedTokens: number;
  warnedOverCap: boolean;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function runFeed(
  agentId: string,
  file: string,
  opts: FeedOptions = {},
): Promise<FeedResult> {
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;

  const agent = await loadAgent(agentId, opts.baseDir);
  const { content, basename } = await readSource(file);

  const incoming = await extractSkills(content, {
    source: basename,
    model: opts.model,
    apiKey: opts.apiKey,
    // The CLI types `client` as unknown so it can avoid a direct SDK dep;
    // core's extractSkills validates the shape it actually needs.
    client: opts.client as Parameters<typeof extractSkills>[1]['client'],
  });

  const existing = await readAgentSkills(agent.paths.skillsFile);
  const { merged, added, updated } = mergeSkills(existing, incoming);

  const skillsMd = serialize(buildDoc(merged));
  await writeSkillsAtomic(agent.paths.skillsFile, skillsMd);

  const skillsMdSha256 = sha256Hex(skillsMd);
  const skillsMdBytes = Buffer.byteLength(skillsMd, 'utf8');
  const sourceSha256 = sha256Hex(content);
  const sourceBytes = Buffer.byteLength(content, 'utf8');

  await recordEntry({
    path: agent.paths.provenanceFile,
    draft: {
      kind: 'feed',
      input: {
        source: basename,
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
    ts: opts.ts,
  });

  const estimatedTokens = estimateTokens(skillsMd);
  const warnedOverCap = estimatedTokens >= agent.config.token_cap_warn_at;
  if (warnedOverCap) {
    stderr.write(
      `warning: skills.md is ~${estimatedTokens} tokens (cap: ${agent.config.token_cap_warn_at}). Consider splitting into multiple agents.\n`,
    );
  }

  stdout.write(
    `feed ${agent.config.id}: +${added.length} added, ${updated.length} updated, sha256=${skillsMdSha256.slice(0, 12)}\n`,
  );

  return {
    agentId: agent.config.id,
    added,
    updated,
    skillsMdSha256,
    skillsMdBytes,
    estimatedTokens,
    warnedOverCap,
  };
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
