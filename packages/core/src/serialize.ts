import { SCHEMA_VERSION, type Skill, type SkillsDoc } from './schema.js';

// Lexicographic by UTF-16 code unit. Stable across Node versions and locales,
// unlike localeCompare. Hashing in later phases depends on this being stable.
function compareCodepoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeSkill(skill: Skill): Skill {
  return {
    slug: skill.slug,
    name: skill.name.trim(),
    description: skill.description.trim(),
    tags: [...skill.tags].sort(compareCodepoints),
    source: skill.source,
  };
}

function renderSkill(skill: Skill): string {
  return [
    `## ${skill.slug}`,
    '',
    `**Name:** ${skill.name}`,
    '',
    `**Description:** ${skill.description}`,
    '',
    `**Tags:** ${skill.tags.join(', ')}`,
    '',
    `**Source:** ${skill.source}`,
    '',
    '---',
  ].join('\n');
}

/**
 * Serialize a SkillsDoc to canonical SKILLS.md.
 *
 * Stability rules (load-bearing — later phases hash this output):
 * - LF line endings, single trailing newline
 * - Skills sorted ascending by slug (UTF-16 code units)
 * - Tags sorted ascending, joined by ", "
 * - Field order fixed: Name, Description, Tags, Source
 * - Frontmatter limited to schema_version
 */
export function serialize(doc: SkillsDoc): string {
  const skills = doc.skills.map(normalizeSkill).sort((a, b) => compareCodepoints(a.slug, b.slug));

  const frontmatter = ['---', `schema_version: ${SCHEMA_VERSION}`, '---'].join('\n');

  if (skills.length === 0) {
    return `${frontmatter}\n`;
  }

  const body = skills.map(renderSkill).join('\n\n');
  return `${frontmatter}\n\n${body}\n`;
}

export function buildDoc(skills: Skill[]): SkillsDoc {
  return { schema_version: SCHEMA_VERSION, skills };
}
