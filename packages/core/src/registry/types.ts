import { z } from 'zod';

// --- Errors ---------------------------------------------------------------

export class RegistryError extends Error {
  // HTTP status, or null for transport-level failures (DNS, connection reset).
  readonly status: number | null;
  // The `error` field from a structured error body, if the registry sent one.
  readonly code: string | null;

  constructor(
    message: string,
    opts: { status?: number | null; code?: string | null } = {},
  ) {
    super(message);
    this.name = 'RegistryError';
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
  }
}

// --- Device-code auth -----------------------------------------------------

export const DeviceCodeStartSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verify_url: z.string().url(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceCodeStart = z.infer<typeof DeviceCodeStartSchema>;

// The token endpoint returns either a token or a polling-status error.
export const TokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// --- Bind -----------------------------------------------------------------

export interface BindRequest {
  skills_md: string;
  skills_md_sha256: string;
  provenance_head_sha256: string;
  aspiration_sha256s: string[];
}

// Parsed leniently: we only require what the CLI consumes; the registry may
// send more (owner, lineage, etc.) and that's fine.
export const BindResponseSchema = z
  .object({
    skills_md_sha256: z.string().min(1),
    bound_at: z.string().min(1),
  })
  .passthrough();
export type BindResponse = z.infer<typeof BindResponseSchema>;

// --- Aspirations ----------------------------------------------------------

export interface AspirationRequest {
  sha256: string;
  content: string;
}

export const AspirationResponseSchema = z
  .object({
    created_at: z.string().min(1).optional(),
  })
  .passthrough();
export type AspirationResponse = z.infer<typeof AspirationResponseSchema>;

// --- Evals ----------------------------------------------------------------
//
// Provisional contract — the registry side isn't built yet. See NOTES.md.
//   POST /v1/aspirations/{hash}/evals  →  EvalAddResponse
//   GET  /v1/aspirations/{hash}/evals  →  EvalListResponse
// 404 means *either* "no such aspiration" *or* "this registry build doesn't
// expose eval endpoints yet" — the body has no field that distinguishes the
// two cases, so the client message has to mention both possibilities.

export interface EvalAddRequest {
  text: string;
  mark_rubric?: string;
}

export const EvalAddResponseSchema = z
  .object({
    eval_id: z.string().min(1),
    created_at: z.string().min(1).optional(),
  })
  .passthrough();
export type EvalAddResponse = z.infer<typeof EvalAddResponseSchema>;

export const EvalSummarySchema = z
  .object({
    eval_id: z.string().min(1),
    text: z.string(),
    mark_rubric: z.union([z.string(), z.null()]).optional(),
    created_at: z.string().min(1).optional(),
  })
  .passthrough();
export type EvalSummary = z.infer<typeof EvalSummarySchema>;

export const EvalListResponseSchema = z
  .object({
    evals: z.array(EvalSummarySchema),
  })
  .passthrough();
export type EvalListResponse = z.infer<typeof EvalListResponseSchema>;

// --- Eval runs (Phase G) --------------------------------------------------
//
// Provisional. The CLI calls Anthropic locally (see chosen design in
// CHANGELOG / NOTES.md) and POSTs the resulting transcript + mark to the
// registry — the server is a passive recipient that stores outcomes for
// substrate enrichment, not the orchestrator.
//
//   POST /v1/agents/{agent_id}/eval-runs  →  EvalRunResponse
//   GET  /v1/agents/{agent_id}/eval-runs?eval_id=...  →  EvalRunsListResponse

export const MarkPayloadSchema = z
  .object({
    pass: z.boolean(),
    rationale: z.string().min(1).max(2000),
  })
  .passthrough();
export type MarkPayload = z.infer<typeof MarkPayloadSchema>;

export interface EvalRunRequest {
  eval_id: string;
  aspiration_sha256: string;
  agent_skills_md_sha256: string;
  model: string;
  // null when the eval had no mark_rubric — the run still produced a
  // transcript, but no pass/fail decision was made.
  mark: MarkPayload | null;
  // Full agent response if it fits under the cap; truncated with a marker
  // line otherwise. The provenance chain stores transcript_sha256 for the
  // un-truncated bytes.
  transcript_excerpt: string;
}

export const EvalRunResponseSchema = z
  .object({
    run_id: z.string().min(1),
    created_at: z.string().min(1).optional(),
  })
  .passthrough();
export type EvalRunResponse = z.infer<typeof EvalRunResponseSchema>;

export const EvalRunSummarySchema = z
  .object({
    run_id: z.string().min(1),
    eval_id: z.string().min(1),
    mark: z.union([MarkPayloadSchema, z.null()]).optional(),
    transcript_excerpt: z.string().optional(),
    created_at: z.string().min(1).optional(),
  })
  .passthrough();
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalRunsListResponseSchema = z
  .object({
    runs: z.array(EvalRunSummarySchema),
  })
  .passthrough();
export type EvalRunsListResponse = z.infer<typeof EvalRunsListResponseSchema>;

// --- Cite (Phase H) -------------------------------------------------------
//
// Provisional. `cite` registers an invocation of an agent's SKILLS.md at a
// specific bind hash, and returns a session_token the caller uses to prove
// attribution downstream. bind_hash is optional in the request — the server
// defaults to the agent's latest bound snapshot — and is always echoed back
// so the caller knows which snapshot was actually cited.
//
//   POST /v1/agents/{agent_id}/cite  →  CiteResponse

export interface CiteRequest {
  bind_hash?: string;
}

export const CiteResponseSchema = z
  .object({
    session_token: z.string().min(1),
    // The snapshot the citation was registered against. When the client
    // sends no bind_hash this tells us which one the server defaulted to.
    bind_hash: z.string().min(1),
  })
  .passthrough();
export type CiteResponse = z.infer<typeof CiteResponseSchema>;
