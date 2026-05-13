import type { Skill } from './schema.js';

export interface MergeResult {
  merged: Skill[];
  added: string[];
  updated: string[];
}

function tagsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function skillsEqual(a: Skill, b: Skill): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.source === b.source &&
    tagsEqual(a.tags, b.tags)
  );
}

// Merge `incoming` into `existing` keyed by slug.
// - new slug → `added`
// - existing slug, content changed → `updated`
// - existing slug, content identical → no-op (not in either list)
// `merged` is the resulting union; the canonical serializer will sort it.
// Both `added` and `updated` are returned sorted ascending for stable
// provenance output.
export function mergeSkills(existing: readonly Skill[], incoming: readonly Skill[]): MergeResult {
  const bySlug = new Map<string, Skill>();
  for (const s of existing) bySlug.set(s.slug, s);

  const added: string[] = [];
  const updated: string[] = [];

  for (const s of incoming) {
    const prev = bySlug.get(s.slug);
    if (prev === undefined) {
      added.push(s.slug);
    } else if (!skillsEqual(prev, s)) {
      updated.push(s.slug);
    }
    bySlug.set(s.slug, s);
  }

  added.sort();
  updated.sort();

  return {
    merged: [...bySlug.values()],
    added,
    updated,
  };
}
