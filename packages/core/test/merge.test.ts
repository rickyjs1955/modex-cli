import { describe, expect, it } from 'vitest';

import { mergeSkills } from '../src/merge.js';
import type { Skill } from '../src/schema.js';

function skill(slug: string, overrides: Partial<Skill> = {}): Skill {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    tags: ['x'],
    source: 'src.md',
    ...overrides,
  };
}

describe('mergeSkills', () => {
  it('reports new slugs as added', () => {
    const r = mergeSkills([], [skill('a'), skill('b')]);
    expect(r.added).toEqual(['a', 'b']);
    expect(r.updated).toEqual([]);
    expect(r.merged).toHaveLength(2);
  });

  it('reports changed-content slugs as updated, not added', () => {
    const existing = [skill('a', { description: 'v1' })];
    const incoming = [skill('a', { description: 'v2' })];
    const r = mergeSkills(existing, incoming);
    expect(r.added).toEqual([]);
    expect(r.updated).toEqual(['a']);
    expect(r.merged[0]!.description).toBe('v2');
  });

  it('treats identical-content re-extraction as a no-op', () => {
    const a = skill('a');
    const r = mergeSkills([a], [a]);
    expect(r.added).toEqual([]);
    expect(r.updated).toEqual([]);
  });

  it('treats tag reorder as a no-op (equivalent set, not an update)', () => {
    const r = mergeSkills(
      [skill('a', { tags: ['x', 'y'] })],
      [skill('a', { tags: ['y', 'x'] })],
    );
    expect(r.updated).toEqual([]);
    expect(r.added).toEqual([]);
  });

  it('treats accidental duplicate tags as equivalent (no update)', () => {
    const r = mergeSkills(
      [skill('a', { tags: ['x', 'y'] })],
      [skill('a', { tags: ['x', 'y', 'x'] })],
    );
    expect(r.updated).toEqual([]);
  });

  it('reports an actual tag set change as updated', () => {
    const r = mergeSkills(
      [skill('a', { tags: ['x', 'y'] })],
      [skill('a', { tags: ['x', 'z'] })],
    );
    expect(r.updated).toEqual(['a']);
  });

  it('handles add + update + no-op together', () => {
    const existing = [skill('a', { description: 'v1' }), skill('b')];
    const incoming = [
      skill('a', { description: 'v2' }), // updated
      skill('b'),                          // no-op
      skill('c'),                          // added
    ];
    const r = mergeSkills(existing, incoming);
    expect(r.added).toEqual(['c']);
    expect(r.updated).toEqual(['a']);
    expect(r.merged.map((s) => s.slug).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns added/updated sorted ascending', () => {
    const r = mergeSkills(
      [skill('a', { description: 'v1' })],
      [skill('z'), skill('m'), skill('a', { description: 'v2' })],
    );
    expect(r.added).toEqual(['m', 'z']);
    expect(r.updated).toEqual(['a']);
  });
});
