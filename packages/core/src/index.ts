export {
  SCHEMA_VERSION,
  SkillSchema,
  SkillsDocSchema,
  ExtractedSkillSchema,
  ExtractionResultSchema,
  type Skill,
  type SkillsDoc,
  type ExtractedSkill,
  type ExtractionResult,
} from './schema.js';

export { buildDoc, serialize } from './serialize.js';

export { extractSkills, ExtractionError, type ExtractOptions } from './extract.js';

export { readSource, SourceError, type LoadedSource } from './readSource.js';

export { MODEL_ID, SYSTEM_PROMPT, EMIT_SKILLS_TOOL } from './prompt.js';
