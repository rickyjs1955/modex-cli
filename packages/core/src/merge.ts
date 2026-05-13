import type { Skill } from './schema.js';

export interface MergeResult {
  merged: Skill[];
  added: string[];
  updated: string[];
}

// Compare tag sets order- and duplicate-insensitive. The serializer sorts and
// the schema rejects empty tag arrays, but a model can legitimately re-emit
// the same set in a different order or with accidental duplicates — neither
// should count as an "update".
function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags)].sort();
}

function tagsEquivalent(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeTags(a);
  const nb = normalizeTags(b);
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) return false;
  return true;
}

function skillsEqual(a: Skill, b: Skill): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.source === b.source &&
    tagsEquivalent(a.tags, b.tags)
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
