import { z } from 'zod';

export const SCHEMA_VERSION = 0;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SkillSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(SLUG_PATTERN, 'slug must be kebab-case [a-z0-9-]'),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  tags: z
    .array(z.string().regex(SLUG_PATTERN, 'tag must be kebab-case [a-z0-9-]').max(40))
    .max(16),
  source: z.string().min(1).max(255),
});

export type Skill = z.infer<typeof SkillSchema>;

export const SkillsDocSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  skills: z.array(SkillSchema),
});

export type SkillsDoc = z.infer<typeof SkillsDocSchema>;

// What the model emits via the tool call — same shape as Skill but without `source`,
// which the caller attaches from the input file basename.
export const ExtractedSkillSchema = SkillSchema.omit({ source: true });
export type ExtractedSkill = z.infer<typeof ExtractedSkillSchema>;

export const ExtractionResultSchema = z.object({
  skills: z.array(ExtractedSkillSchema),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
