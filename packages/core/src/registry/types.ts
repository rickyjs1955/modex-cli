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
