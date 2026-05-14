import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { parseSkills } from './parseSkills.js';
import { recordEntry } from './provenance.js';

export const AGENT_CONFIG_SCHEMA_VERSION = 0;
export const DEFAULT_TOKEN_CAP_WARN_AT = 32_000;
export const MODEX_DIR_NAME = '.modex';

const UUID7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AgentConfigSchema = z.object({
  schema_version: z.literal(AGENT_CONFIG_SCHEMA_VERSION),
  id: z.string().regex(UUID7_PATTERN, 'agent id must be a UUIDv7'),
  name: z.string(),
  created_at: z.string().min(1),
  token_cap_warn_at: z.number().int().positive(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface AgentPaths {
  dir: string;
  configFile: string;
  skillsFile: string;
  provenanceFile: string;
  // Bound-state cache, written by `modex bind`. Absent until the agent is
  // first bound to a registry.
  registryFile: string;
}

export interface AgentRecord {
  config: AgentConfig;
  paths: AgentPaths;
}

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

function modexDir(baseDir: string): string {
  return join(baseDir, MODEX_DIR_NAME);
}

function agentPaths(baseDir: string, id: string): AgentPaths {
  const dir = join(modexDir(baseDir), id);
  return {
    dir,
    configFile: join(dir, 'config.json'),
    skillsFile: join(dir, 'skills.md'),
    provenanceFile: join(dir, 'provenance.jsonl'),
    registryFile: join(dir, 'registry.json'),
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  // Pretty-print config.json — humans will read and occasionally edit it.
  // (Provenance entries are canonical; configs aren't hashed.)
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

export async function writeSkillsAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

export interface CreateAgentOptions {
  name?: string;
  baseDir?: string;
  // Test-only overrides:
  id?: string;
  ts?: string;
  tokenCapWarnAt?: number;
}

export async function createAgent(opts: CreateAgentOptions = {}): Promise<AgentRecord> {
  const baseDir = opts.baseDir ?? process.cwd();
  const id = opts.id ?? uuidv7();
  const created_at = opts.ts ?? new Date().toISOString();
  const name = opts.name ?? '';
  const token_cap_warn_at = opts.tokenCapWarnAt ?? DEFAULT_TOKEN_CAP_WARN_AT;

  const paths = agentPaths(baseDir, id);

  // mkdir -p .modex/<id>
  await mkdir(paths.dir, { recursive: true });

  const config: AgentConfig = {
    schema_version: AGENT_CONFIG_SCHEMA_VERSION,
    id,
    name,
    created_at,
    token_cap_warn_at,
  };
  await writeJsonAtomic(paths.configFile, config);

  // Genesis provenance entry.
  await recordEntry({
    path: paths.provenanceFile,
    draft: {
      kind: 'agent_created',
      input: { name },
      output: { agent_id: id },
    },
    ts: created_at,
  });

  return { config, paths };
}

export async function loadAgent(id: string, baseDir?: string): Promise<AgentRecord> {
  const root = baseDir ?? process.cwd();
  const paths = agentPaths(root, id);
  let raw: string;
  try {
    raw = await readFile(paths.configFile, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new AgentError(
        `Agent '${id}' not found at ${paths.configFile}. Run 'modex agents create' first, or 'modex agents list' to see existing agents.`,
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AgentError(`Agent '${id}' has invalid config.json: ${(err as Error).message}`);
  }
  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new AgentError(
      `Agent '${id}' config.json failed validation: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return { config: result.data, paths };
}

export async function listAgents(baseDir?: string): Promise<AgentRecord[]> {
  const root = baseDir ?? process.cwd();
  const dir = modexDir(root);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
  const records: AgentRecord[] = [];
  for (const name of entries) {
    if (!UUID7_PATTERN.test(name)) continue;
    const candidate = join(dir, name);
    let s;
    try {
      s = await stat(candidate);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    try {
      records.push(await loadAgent(name, root));
    } catch {
      // Skip directories without a valid config.
      continue;
    }
  }
  records.sort((a, b) => (a.config.created_at < b.config.created_at ? -1 : 1));
  return records;
}

// Read an agent's skills.md and parse it into Skill[]. Returns [] if the file
// doesn't exist yet (i.e. the agent has never been fed).
export async function readAgentSkills(skillsFile: string) {
  let raw: string;
  try {
    raw = await readFile(skillsFile, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
  return parseSkills(raw).skills;
}
