export const MODEL_ID = 'claude-haiku-4-5-20251001';

export const EMIT_SKILLS_TOOL = {
  name: 'emit_skills',
  description:
    'Emit the structured set of skills extracted from the user-provided corpus.',
  input_schema: {
    type: 'object' as const,
    properties: {
      skills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
              maxLength: 64,
              description:
                'Kebab-case identifier, unique within this output. No underscores, spaces, or capitals.',
            },
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
              description: 'Short human-readable title (3-8 words).',
            },
            description: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              description:
                'One paragraph (1-4 sentences), self-contained, written so a reader who has not seen the corpus can apply it.',
            },
            tags: {
              type: 'array',
              maxItems: 16,
              items: {
                type: 'string',
                pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
                maxLength: 40,
              },
              description: '1-6 kebab-case topical labels.',
            },
          },
          required: ['slug', 'name', 'description', 'tags'],
          additionalProperties: false,
        },
      },
    },
    required: ['skills'],
    additionalProperties: false,
  },
};

export const SYSTEM_PROMPT = `You are an extraction engine that reads a corpus and produces a structured set of distinct skills.

A "skill" is a transferable, reusable practice or technique that a person could apply across contexts — not a fact, definition, story, or one-off opinion.

For every skill you identify, emit:
- slug: kebab-case identifier matching ^[a-z0-9]+(-[a-z0-9]+)*$, unique within this output
- name: short human-readable title (3-8 words; Title Case acceptable)
- description: one paragraph (1-4 sentences), self-contained, written as a directly applicable instruction
- tags: 1-6 kebab-case topical labels matching ^[a-z0-9]+(-[a-z0-9]+)*$

Quality rules:
- Only emit skills that are clearly supported by the corpus.
- Do not invent skills to pad the list. Returning fewer high-quality skills is preferred to many vague ones.
- Avoid near-duplicates. If two passages describe the same underlying technique, emit one skill.
- Do not include source citations, page numbers, or quotes in the description.
- The description must stand on its own; a reader who has not seen the corpus must be able to apply the skill.

Always respond by calling the emit_skills tool exactly once with the full result. Do not include any text outside the tool call.`;
