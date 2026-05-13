import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildDoc, serialize } from '../src/serialize.js';
import { SkillsDocSchema, type Skill } from '../src/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, 'fixtures/golden.skills.md');

// Intentionally out of order, with unsorted tags, to prove the serializer canonicalizes.
const UNSORTED_INPUT: Skill[] = [
  {
    slug: 'five-whys',
    name: 'Five Whys',
    description:
      'Ask "why" iteratively to walk from a symptom to a root cause; stop when further answers stop changing the remediation.',
    tags: ['root-cause', 'debugging'],
    source: 'book.md',
  },
  {
    slug: 'active-listening',
    name: 'Active Listening',
    description:
      'Reflect back what the speaker said before responding, to confirm understanding and surface mismatches early.',
    tags: ['soft-skills', 'communication', 'conflict-resolution'],
    source: 'book.md',
  },
  {
    slug: 'decompose-by-invariants',
    name: 'Decompose by Invariants',
    description:
      'Identify the properties that must hold across all valid states, then design data structures so that violating them is unrepresentable.',
    tags: ['software-engineering', 'design'],
    source: 'book.md',
  },
];

describe('serialize', () => {
  it('matches the golden fixture byte-for-byte', () => {
    const doc = buildDoc(UNSORTED_INPUT);
    const actual = serialize(doc);
    const expected = readFileSync(GOLDEN_PATH, 'utf8');
    expect(actual).toBe(expected);
  });

  it('is idempotent — running input through twice produces identical bytes', () => {
    const doc = buildDoc(UNSORTED_INPUT);
    const first = serialize(doc);
    const reparsed = SkillsDocSchema.parse({
      schema_version: 0,
      skills: UNSORTED_INPUT,
    });
    const second = serialize(reparsed);
    expect(second).toBe(first);
  });

  it('is order-independent — shuffling input yields identical output', () => {
    const shuffled = [...UNSORTED_INPUT].reverse();
    const a = serialize(buildDoc(UNSORTED_INPUT));
    const b = serialize(buildDoc(shuffled));
    expect(b).toBe(a);
  });

  it('uses LF line endings and ends with exactly one newline', () => {
    const out = serialize(buildDoc(UNSORTED_INPUT));
    expect(out.includes('\r')).toBe(false);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('renders an empty doc as just the frontmatter', () => {
    const out = serialize(buildDoc([]));
    expect(out).toBe('---\nschema_version: 0\n---\n');
  });

  it('renders (none) when a skill has no tags', () => {
    const out = serialize(
      buildDoc([
        {
          slug: 'plain',
          name: 'Plain',
          description: 'A skill with no tags.',
          tags: [],
          source: 'x.md',
        },
      ]),
    );
    expect(out).toContain('**Tags:** (none)');
  });
});
