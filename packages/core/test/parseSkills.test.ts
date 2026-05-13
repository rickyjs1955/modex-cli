import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSkills, ParseSkillsError } from '../src/parseSkills.js';
import { buildDoc, serialize } from '../src/serialize.js';
import type { Skill } from '../src/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = readFileSync(resolve(HERE, 'fixtures/golden.skills.md'), 'utf8');

const SAMPLE: Skill[] = [
  {
    slug: 'a-skill',
    name: 'A Skill',
    description: 'Single sentence description.',
    tags: ['alpha', 'beta'],
    source: 'src.md',
  },
  {
    slug: 'b-skill',
    name: 'B Skill',
    description: 'Another, with a comma in it.',
    tags: ['gamma'],
    source: 'src.md',
  },
];

describe('parseSkills', () => {
  it('parses the golden fixture into 3 skills', () => {
    const doc = parseSkills(GOLDEN);
    expect(doc.skills).toHaveLength(3);
    expect(doc.skills.map((s) => s.slug)).toEqual([
      'active-listening',
      'decompose-by-invariants',
      'five-whys',
    ]);
  });

  it('round-trips: serialize → parse → serialize is a fixed point', () => {
    const first = serialize(buildDoc(SAMPLE));
    const parsed = parseSkills(first);
    const second = serialize(parsed);
    expect(second).toBe(first);
  });

  it('round-trips the golden fixture', () => {
    const parsed = parseSkills(GOLDEN);
    const reserialized = serialize(parsed);
    expect(reserialized).toBe(GOLDEN);
  });

  it('parses a doc with zero skills', () => {
    const empty = '---\nschema_version: 0\n---\n';
    const doc = parseSkills(empty);
    expect(doc.skills).toEqual([]);
  });

  it('rejects CR line endings', () => {
    expect(() => parseSkills('---\r\nschema_version: 0\r\n---\r\n')).toThrow(ParseSkillsError);
  });

  it('rejects unknown schema_version', () => {
    expect(() => parseSkills('---\nschema_version: 99\n---\n')).toThrow(ParseSkillsError);
  });

  it('rejects a skill missing a required field', () => {
    const bad = `---
schema_version: 0
---

## a-skill

**Name:** A Skill

**Description:** desc

**Tags:** alpha

---
`;
    expect(() => parseSkills(bad)).toThrow(/missing required fields/);
  });

  it('rejects an unknown field name', () => {
    const bad = `---
schema_version: 0
---

## a-skill

**Name:** A Skill

**Description:** desc

**Tags:** alpha

**Source:** s.md

**Bogus:** nope

---
`;
    expect(() => parseSkills(bad)).toThrow(/Unknown field 'Bogus'/);
  });
});
