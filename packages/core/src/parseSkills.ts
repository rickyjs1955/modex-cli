import { SCHEMA_VERSION, SkillsDocSchema, type Skill, type SkillsDoc } from './schema.js';

export class ParseSkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseSkillsError';
  }
}

const FIELD_PATTERN = /^\*\*([A-Z][A-Za-z]*):\*\* (.*)$/;

interface RawSkill {
  slug: string;
  name?: string;
  description?: string;
  tags?: string[];
  source?: string;
}

// Parse the canonical SKILLS.md format produced by serialize().
// Format reminder:
//   ---
//   schema_version: 0
//   ---
//   <blank>
//   ## <slug>
//   <blank>
//   **Name:** ...
//   <blank>
//   **Description:** ...
//   <blank>
//   **Tags:** a, b, c
//   <blank>
//   **Source:** ...
//   <blank>
//   ---
//   <blank>
//   ## <next-slug>
//   ...
export function parseSkills(input: string): SkillsDoc {
  if (input.includes('\r')) {
    throw new ParseSkillsError('CR characters are not allowed; expected LF line endings.');
  }

  const lines = input.split('\n');
  if (
    lines[0] !== '---' ||
    lines[1] !== `schema_version: ${SCHEMA_VERSION}` ||
    lines[2] !== '---'
  ) {
    throw new ParseSkillsError(
      `Missing or unrecognized frontmatter (expected schema_version: ${SCHEMA_VERSION}).`,
    );
  }

  const skills: Skill[] = [];
  let i = 3;

  while (i < lines.length) {
    if (lines[i] === '' || lines[i] === undefined) {
      i++;
      continue;
    }
    const heading = lines[i]!;
    const slugMatch = heading.match(/^## (.+)$/);
    if (!slugMatch) {
      throw new ParseSkillsError(`Expected '## <slug>' heading, got: ${JSON.stringify(heading)}`);
    }
    const slug = slugMatch[1]!;
    i++;

    const raw: RawSkill = { slug };
    while (i < lines.length) {
      // skip leading blanks within a skill block
      if (lines[i] === '') {
        i++;
        continue;
      }
      const line = lines[i]!;
      if (line === '---') {
        i++;
        break;
      }
      const fieldMatch = line.match(FIELD_PATTERN);
      if (!fieldMatch) {
        throw new ParseSkillsError(
          `Expected '**Field:** value' or '---' inside skill '${slug}', got: ${JSON.stringify(line)}`,
        );
      }
      const [, field, value] = fieldMatch as unknown as [string, string, string];
      switch (field) {
        case 'Name':
          raw.name = value;
          break;
        case 'Description':
          raw.description = value;
          break;
        case 'Tags':
          raw.tags = value.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
          break;
        case 'Source':
          raw.source = value;
          break;
        default:
          throw new ParseSkillsError(`Unknown field '${field}' inside skill '${slug}'.`);
      }
      i++;
    }

    if (
      raw.name === undefined ||
      raw.description === undefined ||
      raw.tags === undefined ||
      raw.source === undefined
    ) {
      throw new ParseSkillsError(
        `Skill '${slug}' is missing required fields (Name, Description, Tags, Source).`,
      );
    }

    skills.push({
      slug,
      name: raw.name,
      description: raw.description,
      tags: raw.tags,
      source: raw.source,
    });
  }

  // Final validation: schema must accept every parsed skill.
  return SkillsDocSchema.parse({ schema_version: SCHEMA_VERSION, skills });
}
