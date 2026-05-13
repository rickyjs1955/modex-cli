import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AgentError,
  createAgent,
  DEFAULT_TOKEN_CAP_WARN_AT,
  listAgents,
  loadAgent,
  readAgentSkills,
} from '../src/agent.js';
import { readChain, verifyChain } from '../src/provenance.js';
import { buildDoc, serialize } from '../src/serialize.js';
import { writeSkillsAtomic } from '../src/agent.js';
import type { Skill } from '../src/schema.js';

const FIXED_ID = '01928c8e-1234-7abc-8def-0123456789ab';

async function tempBase(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'modex-agent-'));
}

const sampleSkill: Skill = {
  slug: 'a',
  name: 'A',
  description: 'desc',
  tags: ['x'],
  source: 's.md',
};

describe('createAgent', () => {
  it('creates the directory layout and a valid genesis provenance entry', async () => {
    const base = await tempBase();
    const agent = await createAgent({
      baseDir: base,
      name: 'engineering-handbook',
      id: FIXED_ID,
      ts: '2026-05-13T12:00:00.000Z',
    });

    expect(agent.config.id).toBe(FIXED_ID);
    expect(agent.config.name).toBe('engineering-handbook');
    expect(agent.config.token_cap_warn_at).toBe(DEFAULT_TOKEN_CAP_WARN_AT);

    const config = JSON.parse(await readFile(agent.paths.configFile, 'utf8'));
    expect(config.id).toBe(FIXED_ID);

    const chain = await readChain(agent.paths.provenanceFile);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.kind).toBe('agent_created');
    expect(chain[0]!.seq).toBe(1);
    expect(chain[0]!.prev).toBeNull();
    verifyChain(chain);
  });

  it('generates a UUIDv7 when no id is given', async () => {
    const base = await tempBase();
    const agent = await createAgent({ baseDir: base });
    expect(agent.config.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('loadAgent', () => {
  it('returns the agent record for a created agent', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    const loaded = await loadAgent(FIXED_ID, base);
    expect(loaded.config.id).toBe(FIXED_ID);
  });

  it('throws AgentError for a missing agent', async () => {
    const base = await tempBase();
    await expect(loadAgent(FIXED_ID, base)).rejects.toBeInstanceOf(AgentError);
  });

  it('throws AgentError for malformed config.json', async () => {
    const base = await tempBase();
    const agent = await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    await writeFile(agent.paths.configFile, '{ not json', 'utf8');
    await expect(loadAgent(FIXED_ID, base)).rejects.toBeInstanceOf(AgentError);
  });
});

describe('listAgents', () => {
  it('returns [] when .modex does not exist', async () => {
    const base = await tempBase();
    const r = await listAgents(base);
    expect(r).toEqual([]);
  });

  it('returns agents sorted by created_at ascending', async () => {
    const base = await tempBase();
    await createAgent({
      baseDir: base,
      name: 'b',
      id: '01928c8e-1234-7abc-8def-0123456789ab',
      ts: '2026-05-13T01:00:00.000Z',
    });
    await createAgent({
      baseDir: base,
      name: 'a',
      id: '01928c8e-5678-7abc-8def-0123456789ab',
      ts: '2026-05-13T00:00:00.000Z',
    });
    const r = await listAgents(base);
    expect(r.map((x) => x.config.name)).toEqual(['a', 'b']);
  });

  it('skips non-UUID directories', async () => {
    const base = await tempBase();
    await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    // Create a junk dir under .modex/
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(base, '.modex', 'not-a-uuid'), { recursive: true });
    const r = await listAgents(base);
    expect(r).toHaveLength(1);
  });
});

describe('readAgentSkills', () => {
  it('returns [] when skills.md does not exist', async () => {
    const base = await tempBase();
    const agent = await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    expect(await readAgentSkills(agent.paths.skillsFile)).toEqual([]);
  });

  it('round-trips through writeSkillsAtomic', async () => {
    const base = await tempBase();
    const agent = await createAgent({ baseDir: base, id: FIXED_ID, ts: '2026-05-13T00:00:00.000Z' });
    await writeSkillsAtomic(agent.paths.skillsFile, serialize(buildDoc([sampleSkill])));
    const skills = await readAgentSkills(agent.paths.skillsFile);
    expect(skills).toEqual([sampleSkill]);
  });
});
