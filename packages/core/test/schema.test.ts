import { describe, expect, it } from 'vitest';

import { SkillSchema } from '../src/schema.js';

describe('SkillSchema', () => {
  const valid = {
    slug: 'active-listening',
    name: 'Active Listening',
    description: 'Reflect back to confirm understanding.',
    tags: ['communication', 'soft-skills'],
    source: 'book.md',
  };

  it('accepts a well-formed skill', () => {
    expect(() => SkillSchema.parse(valid)).not.toThrow();
  });

  it.each([
    'Active-Listening', // uppercase
    'active_listening', // underscore
    '-leading-dash',
    'trailing-dash-',
    'double--dash',
    '',
  ])('rejects bad slug: %s', (slug) => {
    expect(() => SkillSchema.parse({ ...valid, slug })).toThrow();
  });

  it.each([
    'Mixed-Case',
    'has space',
    'snake_case',
  ])('rejects bad tag: %s', (tag) => {
    expect(() => SkillSchema.parse({ ...valid, tags: [tag] })).toThrow();
  });

  it('rejects more than 16 tags', () => {
    const tags = Array.from({ length: 17 }, (_, i) => `tag-${i}`);
    expect(() => SkillSchema.parse({ ...valid, tags })).toThrow();
  });

  it('rejects empty name and description', () => {
    expect(() => SkillSchema.parse({ ...valid, name: '' })).toThrow();
    expect(() => SkillSchema.parse({ ...valid, description: '' })).toThrow();
  });
});
