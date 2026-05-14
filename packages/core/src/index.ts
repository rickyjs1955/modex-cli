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

export {
  readSource,
  isWebUrl,
  SourceError,
  type LoadedSource,
  type SourceKind,
} from './sources/index.js';
export { normalizeUrl } from './sources/web.js';

export { expandPatterns, type ExpandOptions } from './glob.js';

export { MODEL_ID, SYSTEM_PROMPT, EMIT_SKILLS_TOOL } from './prompt.js';

export { parseSkills, ParseSkillsError } from './parseSkills.js';

export { mergeSkills, type MergeResult } from './merge.js';

export { canonicalize, CanonicalJsonError, type CanonicalJson } from './canonicalJson.js';

export {
  withFileLock,
  FileLockError,
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STALE_MS,
  type LockOptions,
} from './fileLock.js';

export {
  runFeed,
  isFeedError,
  runAgentsCreate,
  runAgentsList,
  runLogin,
  runLogout,
  isLoginError,
  runBind,
  isBindError,
  runAspirationsAdd,
  isAspirationsError,
  isUserFacingError,
  type FeedOptions,
  type FeedResult,
  type PerSourceResult,
  type AgentsCreateOptions,
  type AgentsListOptions,
  type LoginOptions,
  type LoginResult,
  type LogoutOptions,
  type BindOptions,
  type BindResult,
  type AspirationsAddOptions,
  type AspirationsAddResult,
} from './operations/index.js';

export { estimateTokens } from './tokenEstimate.js';

export {
  PROVENANCE_SCHEMA_VERSION,
  SOURCE_KINDS,
  KNOWN_ENTRY_KINDS,
  ProvenanceEntrySchema,
  FeedEntrySchema,
  AgentCreatedEntrySchema,
  BoundEntrySchema,
  AspirationAddedEntrySchema,
  ProvenanceError,
  computeEntryHash,
  readChain,
  recordEntry,
  verifyChain,
  type ProvenanceEntry,
  type FeedEntry,
  type AgentCreatedEntry,
  type BoundEntry,
  type AspirationAddedEntry,
  type EntryDraft,
  type RecordEntryOptions,
} from './provenance.js';

export {
  CREDENTIALS_SCHEMA_VERSION,
  DEFAULT_REGISTRY_URL,
  CredentialsSchema,
  CredentialsError,
  configDir,
  credentialsPath,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  type Credentials,
} from './credentials.js';

export {
  REGISTRY_STATE_SCHEMA_VERSION,
  RegistryStateSchema,
  RegistryStateError,
  readRegistryState,
  writeRegistryState,
  type RegistryState,
} from './registryState.js';

export {
  RegistryError,
  startDeviceCode,
  pollForToken,
  bindAgent,
  addAspiration,
  type DeviceCodeStart,
  type TokenResponse,
  type BindRequest,
  type BindResponse,
  type AspirationRequest,
  type AspirationResponse,
  type RegistryDeps,
  type PollDeps,
} from './registry/index.js';

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
