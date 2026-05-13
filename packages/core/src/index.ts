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

export { parseSkills, ParseSkillsError } from './parseSkills.js';

export { mergeSkills, type MergeResult } from './merge.js';

export { canonicalize, CanonicalJsonError, type CanonicalJson } from './canonicalJson.js';

export { estimateTokens } from './tokenEstimate.js';

export {
  PROVENANCE_SCHEMA_VERSION,
  ProvenanceEntrySchema,
  FeedEntrySchema,
  AgentCreatedEntrySchema,
  ProvenanceError,
  computeEntryHash,
  readChain,
  recordEntry,
  verifyChain,
  type ProvenanceEntry,
  type FeedEntry,
  type AgentCreatedEntry,
  type EntryDraft,
  type RecordEntryOptions,
} from './provenance.js';

export {
  AGENT_CONFIG_SCHEMA_VERSION,
  DEFAULT_TOKEN_CAP_WARN_AT,
  MODEX_DIR_NAME,
  AgentConfigSchema,
  AgentError,
  createAgent,
  listAgents,
  loadAgent,
  readAgentSkills,
  writeSkillsAtomic,
  type AgentConfig,
  type AgentRecord,
  type AgentPaths,
  type CreateAgentOptions,
} from './agent.js';
