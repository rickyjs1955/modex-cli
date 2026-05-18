# Changelog

All notable changes to `modex-cli` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning will follow [SemVer](https://semver.org/) once we cut a release.

## 0.8.0 — Phase I (MCP + GA parity)

> Phase I is the catch-up phase. The MCP server and GitHub Action gain
> coverage for every verb introduced in Phases F, G, and H — no new business
> logic, just additive wiring on top of `@modexagents/core`. The three
> surfaces (CLI, MCP, GA) now expose the same operational language by
> construction.

### Added (MCP)
- `modex_aspirations_list` — Phase F.
- `modex_eval_add`, `modex_eval_list` — Phase F.
- `modex_eval_run`, `modex_eval_results` — Phase G. `modex_eval_run`
  needs `ANTHROPIC_API_KEY` in the MCP server's environment, same as
  `modex_feed` — the CLI-calls-Anthropic design propagates through.
- `modex_cite` — Phase H. Returns the raw `session_token` in the tool
  response (so the MCP host can surface it); local provenance stores only its
  sha256, matching the CLI.
- Wiring test confirms one of the new tools (`modex_aspirations_list`)
  dispatches end-to-end through `createServer()` → InMemoryTransport →
  `runAspirationsList`, and that user-facing errors from `modex_cite` (e.g.
  unbound agent) round-trip as `isError: true` tool replies.

### Added (GitHub Action)
- `README` adds documented examples for `eval run`, `eval results`, and
  pinned to `v0.8.0`. The composite action itself didn't need new inputs
  — `command: eval`, `args: run <agent-id> --aspiration <hash>` already
  works on the generic shape.

### Changed
- All four packages bumped to `0.8.0`: cli, core, mcp, and the GA's docs.
  cli + core are no-op behavioral bumps; mcp jumps `0.4.0 → 0.8.0` to catch
  up with the Phase F/G/H release line. This keeps the monorepo on a single
  version trail going forward.
- MCP server now advertises 11 tools (was 5). `EXPECTED_TOOLS` in
  `test/server.test.ts` updated.

### Vocabulary
The three-verb operational language — **bind** (Phase D), **cite** (Phase H),
**eval** (Phases F + G) — is now uniformly available across all three
surfaces. In code, prompts, tool descriptions, help text, README, and
CHANGELOG, the named things are always `bind` / `cite` / `eval`. Nothing
named "scenario," "test," "evaluation," "use," "call," "load," "channel," or
"invoke" — those would create drift.

## 0.7.0 — Phase H (cite)

> Phase H ships the third canonical verb: `cite`. A citation is the act of
> invoking an agent's SKILLS.md into a session — registered against a
> specific bind hash so the registry can credit the agent author. Attribution
> is the moat; the verb names the moat.

### Added
- `modex cite <agent-id> [--bind-hash <hash>]` registers a citation with the
  registry. `--bind-hash` defaults to the agent's latest from local
  `registry.json` (the cached bound-state file written by `modex bind`); the
  server echoes back the hash it actually cited, which we then record. The
  raw `session_token` prints to stdout (labelled `session_token:` for
  scriptable extraction); the local provenance entry stores only its sha256
  so the chain stays non-secret.
- New `cite` provenance kind (additive — `PROVENANCE_SCHEMA_VERSION` stays
  at 1, matching the Phase D / F / G discipline). Records
  `{bind_hash}` → `{session_token_sha256, registry_url}`.
- `cite()` registry client function (`POST /v1/agents/{id}/cite`). Bearer
  auth, 404 mapped to the same NOTES.md-pointer message family used by the
  eval endpoints. The request body omits `bind_hash` when the caller didn't
  supply one, letting the server default to the agent's latest snapshot and
  echo back what it chose.
- `CiteError` exported from `@modexagents/core` for the invalid-input cases
  (e.g. non-sha256 `--bind-hash`). `isUserFacingError` includes it.

### Changed
- The CLI verifies the server's echoed `bind_hash` is a 64-character hex
  sha256 before writing it to provenance. A malformed echo throws rather
  than letting bad data into the chain.
- `@modexagents/cli` and `@modexagents/core` bumped 0.6.0 → 0.7.0.
  `@modexagents/mcp` stays at 0.4.0 — Phase I is where MCP gains the
  Phase F/G/H tools.

### Server contract (provisional — see NOTES.md)
- `POST /v1/agents/{id}/cite` body: `{bind_hash?: string}`. Response:
  `{session_token: string, bind_hash: string, ...passthrough}`. The server
  must always echo `bind_hash` (so the client knows which snapshot got cited
  when it sent no preference).
- Session token semantics — TTL, single-use vs. refreshable, expected
  downstream usage — are still undefined on the server side. The CLI treats
  the token as opaque and surfaces it to the user without further handling.

## 0.6.0 — Phase G (eval execution)

> Phase G ships the execution half of the eval verb. `modex eval run` calls
> Anthropic locally against the user's own ANTHROPIC_API_KEY, marks the
> response against the eval's rubric, posts the outcome to the registry, and
> records an `eval_run` entry in the local provenance chain. `modex eval
> results` reads back past runs.
>
> Key design choice (locked in before Phase G): **CLI calls Anthropic**,
> not the server. The server is a passive recipient of `{mark,
> transcript_excerpt}`. The initiating user pays in tokens. This matches the
> existing `feed` model — no new credential-custody story.

### Added
- `modex eval run <agent-id> [--eval-id <id> | --aspiration <hash>] [--model <id>]`
  runs one or more evals against an agent. Resolution rules:
  - `--aspiration <hash>` → run every eval registered on that aspiration.
  - `--eval-id <id>` alone → scan the agent's pinned aspirations to find the
    eval (one `listEvals` per pinned aspiration, until a match).
  - both → fast path: `listEvals` on the named aspiration, then filter.
  - neither → error.
  The agent must have the relevant aspiration pinned locally; this is a
  client-side ergonomic check ("don't probe behaviors the agent never agreed
  to") in addition to whatever the server enforces.
- `modex eval results <agent-id> [--eval-id <id>]` reads past runs from the
  registry. TSV output: `run_id\tcreated_at\teval_id\tmark\trationale-preview`
  (mark is `PASS`, `FAIL`, or `NO-MARK` when the eval had no rubric).
- New `eval_run` provenance kind (additive — `PROVENANCE_SCHEMA_VERSION`
  stays at 1, matching the Phase D / F discipline). Records `{eval_id,
  aspiration_sha256, agent_skills_md_sha256, model, run_id, mark_pass,
  mark_rationale_sha256, transcript_sha256, registry_url}`. The chain stores
  hashes; the registry has the bytes.
- `executeEval` in `@modexagents/core` — the two-call model layer:
  1. RUN: `system = agent's SKILLS.md` (with `cache_control: ephemeral`),
     `user = eval.text`. Captures the response transcript.
  2. MARK: if the eval has a `mark_rubric`, a second model call with a forced
     `emit_mark` tool returns `{pass: boolean, rationale: string}`. Skipped
     when no rubric is set; `mark` is recorded as `null`.
- `postEvalRun` / `listEvalRuns` registry client functions
  (`POST` / `GET /v1/agents/{id}/eval-runs`), bearer-auth on both. 404 mapped
  to a message pointing at NOTES.md.
- `MARK_SYSTEM_PROMPT`, `EMIT_MARK_TOOL`, `MarkSchema` exported from
  `@modexagents/core` for surfaces that want to construct marks directly.

### Changed
- Transcript handling: the full agent response is hashed for provenance; only
  the first 8 KB is sent to the registry as `transcript_excerpt` (with a
  truncation marker line). Marker call sees up to 16 KB of the response.
- `isEvalError` now also covers `EvalExecutionError`, `AgentError`, and
  `ProvenanceError` — the Phase G code path can raise any of them.
- `@modexagents/cli` and `@modexagents/core` bumped 0.5.0 → 0.6.0.
  `@modexagents/mcp` stays at 0.4.0 — Phase I is where MCP gains the new
  tools.

### Server contract (provisional — see NOTES.md)
- `POST /v1/agents/{id}/eval-runs` body: `{eval_id, aspiration_sha256,
  agent_skills_md_sha256, model, mark | null, transcript_excerpt}`. Response:
  `{run_id, created_at?}`.
- `GET /v1/agents/{id}/eval-runs[?eval_id=...]` response: `{runs: [{run_id,
  eval_id, mark | null, transcript_excerpt, created_at}]}`.
- A 404 from the eval-run endpoints is again ambiguous (no such agent vs.
  registry doesn't ship eval-run endpoints yet) — same disambiguation ask
  as Phase F.
- Mark format `{pass: boolean, rationale: string}` is locked in. Future
  extensions (numeric scores, multi-axis rubrics) need a `mark_version` or
  similar.

## 0.5.0 — Phase F (eval verb arrives; aspirations get a list view)

> Introduces the `eval` verb. An **eval** is a parent-defined probe of an
> agent's behavior under a stated rubric — it attaches to an aspiration
> (honesty, brevity, refusal-to-flatter, …) and can be shared across every
> agent that pins that aspiration. The vocabulary commitment: in code,
> prompts, help text, and docs the named thing is always "an eval" — not
> "scenario," "test," or "evaluation."
>
> Phase F is the **offline-safe slice** — no provider tokens spent. Eval
> *execution* lands in Phase G.

### Added
- `modex eval add <aspiration-hash> --text <prompt> [--mark-rubric <criteria>]`
  registers an eval against an aspiration on the registry. The eval is
  aspiration-scoped (not agent-scoped); any agent pinning that aspiration can
  be evaled with it later. Requires `modex login`. Returns the server-assigned
  `eval_id`.
- `modex eval list <aspiration-hash>` lists evals registered against an
  aspiration. One tab-separated line per eval (`eval_id`, `created_at`,
  single-line prompt preview).
- `modex aspirations list <agent-id>` prints the aspirations pinned to an
  agent from the local provenance chain — one TSV line per
  `aspiration_added` entry (`sha256`, `source`, `added_at`). Pure local read,
  no network call; gives users a way to discover the aspiration hash they
  need for `eval add`.
- `addEval` / `listEvals` registry client functions in
  `@modexagents/core` (`POST` / `GET /v1/aspirations/{hash}/evals`).
  Bearer-auth on both today; `listEvals` could be relaxed to anonymous
  reads later without a client change.
- `runEvalAdd`, `runEvalList`, `runAspirationsList`, `isEvalError`, `EvalError`
  in `core/operations`. Exported from `@modexagents/core`.
- `NOTES.md` at the repo root tracking API-contract gaps the server side
  hasn't resolved yet (404 ambiguity, mark-rubric format, local persistence
  semantics, Phase G/H pre-flight items).

### Changed
- The Phase F design is **no local provenance** for `eval add` / `eval list`.
  Evals attach to aspirations, not agents; there is no obvious local agent to
  record provenance against. The local chain only gains an entry in Phase G's
  `eval run`, which IS agent-scoped. See NOTES.md.
- `@modexagents/cli` and `@modexagents/core` bumped 0.4.0 → 0.5.0.
  `@modexagents/mcp` stays at 0.4.0 — Phase F adds CLI verbs only; Phase I
  is where MCP gains tools for them.

### Server contract (provisional — see NOTES.md)
- A 404 from the eval endpoints is ambiguous (no such aspiration vs. registry
  doesn't expose eval endpoints yet); the client error names both
  possibilities. The server should disambiguate with a body code before
  Phase G.
- `--mark-rubric` is currently a free-text string — it'll need a schema
  before Phase G can produce structured marks.

## 0.4.0 — Phase E.5 (companion surfaces)

> Bootstraps the two surfaces that Phase E forecast: an MCP server and a
> GitHub Action. Both wrap `@modexagents/core` exactly like `@modexagents/cli`
> does — no business logic in either, so all three surfaces stay in lockstep
> by construction.

### Added
- **`@modexagents/mcp`** (new package). Stdio MCP server exposing one tool per
  existing `run*` op: `modex_feed`, `modex_agents_create`, `modex_agents_list`,
  `modex_bind`, `modex_aspirations_add`. Each tool returns the structured
  result as JSON plus a captured transcript of what the CLI would have printed
  to stdout/stderr. Errors that `isUserFacingError()` recognizes return as
  `isError: true` tool responses; internal errors surface as protocol-level
  failures. Login / logout are deliberately omitted — device-code auth is
  interactive; users authenticate once via `modex login` in a real terminal
  and this server reads the same `~/.config/modex/credentials.json`.
- **`packages/github-action`** (new). Composite action wrapping the published
  CLI. Inputs: `command`, `args`, `cli-version` (default `latest`),
  `working-directory`, `anthropic-api-key`, `modex-token`,
  `modex-registry-url`. The `modex-token` input materializes
  `~/.config/modex/credentials.json` at the schema `modex login` produces, so
  CI can call `bind` / `aspirations add` without the device-code flow.
- Root README and CLI README updated to describe the three surfaces.

### Changed
- `@modexagents/cli` and `@modexagents/core` bumped 0.3.1 → 0.4.0 to keep
  every package in the monorepo on the same release line as the new
  `@modexagents/mcp`. No behavioral changes in either.

## 0.3.1 — Phase E (first published release)

> **npm scope renamed `@mojax` → `@modexagents` (2026-05-15).** The package
> contents are unchanged by the rename itself; `@modexagents/*` is a fresh
> package name carrying the same `0.3.1`. `@mojax/core` and `@mojax/cli` are
> deprecated on npm and point here. `@mojax` was a fallback when the bare
> `@modex` org was unavailable — `@modexagents` keeps the product name
> "Modex" visible with a true descriptive qualifier. The `modex` command,
> the `.modex/` state directory, `MODEX_*` env vars, and every other
> identifier are unchanged.

This is the first version published to npm. `@modexagents/core` and `@modexagents/cli`
go out together under the `@modexagents` scope.

### Added
- **`recordEntry` is now concurrency-safe.** A per-file `O_EXCL` lock
  (`fileLock.ts`) serializes the read-head → append sequence, so concurrent
  callers — e.g. parallel MCP tool invocations — can't race the head read and
  fork the chain. A crashed holder's lock is detected (dead pid, or older than
  30s) and stolen; acquisition times out at 10s.
- **`run*` orchestrators promoted into `@modexagents/core`** (`operations/`):
  `runFeed`, `runAgentsCreate`, `runAgentsList`, `runLogin`, `runLogout`,
  `runBind`, `runAspirationsAdd`, plus `isUserFacingError`. All three surfaces
  (CLI, MCP server, GitHub Action) now share one implementation — wrappers hold
  no business logic.
- Package metadata for npm: `publishConfig.access: public`, `repository`,
  `homepage`, `bugs`, `keywords`, per-package `README.md` + `LICENSE`,
  `prepublishOnly` build+test gate.
- `createAgent` drops a `.modex/.gitignore` (`*.lock`) so the transient
  per-file provenance lock is never committed when a `.modex/` directory is
  checked into git.

### Changed
- `DEFAULT_USER_AGENT` in `sources/web.ts` is now built from `__MODEX_VERSION__`
  (injected at build time by tsup, at test time by vitest) instead of a
  hard-coded `0.2` string — it can no longer drift from the package version.
- `@modexagents/cli` is now a pure commander wrapper over `@modexagents/core`; the
  `src/commands/*` files were removed and their integration tests moved to
  `packages/core/test/` alongside the operations they exercise.

### Fixed
- `bind` no longer uses a structural cast to pull aspiration hashes out of the
  provenance chain — it uses a typed `AspirationAddedEntry` predicate.

## 0.3.0 — Phase D (unreleased)

### Added
- `modex login [--registry <url>]` — device-code flow. Prints the verification URL + user code, polls the token endpoint at the server's interval, honors `slow_down` (interval += 5s) and the `expires_in` deadline. On success writes `~/.config/modex/credentials.json` at mode `0600` (`{ schema_version, access_token, registry_url }`).
- `modex logout` — clears the local credential.
- `modex bind <agent-id>` — uploads SKILLS.md **content + hash** + provenance-head hash + aspiration hashes to the registry, records a `bound` provenance entry, and writes `.modex/<id>/registry.json` (denormalized bound-state cache). `409` → already-bound message; `401` → credential cleared + re-login prompt.
- `modex aspirations add <agent-id> <md-file>` — append-only. Requires a prior `bind` (checked locally). POSTs `{ sha256, content }`, then records an `aspiration_added` provenance entry. There is deliberately no edit/delete command.
- Provenance union gains two kinds: `bound` and `aspiration_added`. Both stay at `schema_version: 1` — see Changed.
- Registry client (`startDeviceCode`, `pollForToken`, `bindAgent`, `addAspiration`) lives in `@modexagents/core` so the Phase E MCP server can reuse it. All network calls take an injectable `fetch`/`sleep`/`now` for testing.
- IPv6 SSRF check now parses hextets (handles compressed/expanded forms and IPv4-mapped addresses) instead of string-prefix matching.

### Changed
- **`PROVENANCE_SCHEMA_VERSION` stays at 1 — deliberate.** The new `bound` / `aspiration_added` kinds are *additive*: no existing entry shape changed, and `schema_version` tracks per-kind entry shape. A v1 `feed` entry written by Phase C and one written by Phase D are byte-identical. `readChain` gains a forward-compat guard: a v1 entry with an unrecognized `kind` produces an "upgrade modex-cli" error instead of an opaque zod failure.
- `AgentPaths` gains `registryFile` (`.modex/<id>/registry.json`).
- Storage model for `bind`: uploads hash **and** full SKILLS.md content (the registry renders it via templates and enforces a token cap — both need the bytes). Aspiration *content* travels via the dedicated aspirations endpoint; the bind body carries aspiration *hashes* only.

### Security
- `credentials.json` is written `0600` in a `0700` directory, never logged, and cleared automatically on any `401`.

## 0.2.0 — Phase C (unreleased)

### Added
- `modex feed <agent-id> <pattern...>` accepts multiple sources per invocation: file paths, globs (via `tinyglobby`), and http(s) URLs. Sources are processed sequentially; each lands one provenance entry.
- PDF source extraction via `unpdf` (wraps Mozilla's pdf.js).
- EPUB source extraction via `epub2`; chapters joined into one document.
- Web source extraction via `fetch` + `@mozilla/readability` + `linkedom`. URL fragments are stripped, host is lowercased, default ports removed.
- SSRF guard on web fetch: rejects IP literals, refuses hostnames that resolve to private/loopback/link-local addresses (incl. EC2 metadata `169.254.169.254`). Reapplied on every redirect hop. 30s timeout, 10MB body cap, manual redirect chain (max 10 hops).
- New provenance fields on `feed` entries: `source_kind` (`text` | `markdown` | `pdf` | `epub` | `web`) and `source_url` (string for web, `null` for files).
- `mergeSkills` now treats tag reorder and duplicate tags as equivalent — neither is logged as `updated`.
- Pinned-hash test (`provenance.test.ts`) asserts the literal sha256 of a known canonical entry. If the canonicalizer or entry shape moves, this test fails loudly rather than silently re-pinning.

### Changed
- **`PROVENANCE_SCHEMA_VERSION` bumped 0 → 1. Breaking.** Phase B chains (`schema_version: 0`) are rejected at load with an actionable message pointing to `@modexagents/cli@0.1.x` for legacy agents. Create a fresh agent under `.modex/` to use Phase C.
- `LoadedSource` shape: `{ basename, content }` → `{ source, source_url, source_kind, content }`. The fields land directly in the provenance entry.
- `readSource` is now a dispatcher in `sources/index.ts` that routes by extension or URL scheme to `text` / `pdf` / `epub` / `web` loaders.
- `agent.ts` uses a static `parseSkills` import (was dynamic).
- `provenance.ts` carries a module-level note that `recordEntry` is single-process serial; an exclusive-lock variant is flagged for Phase E (MCP/parallel scenarios).

## 0.1.0 — Phase B (unreleased)

### Added
- Per-agent state under `.modex/<uuid7>/` containing `config.json`, `skills.md`, and `provenance.jsonl`.
- `modex agents create [--name <name>]` and `modex agents list` commands.
- Hash-chained, append-only provenance log (`provenance.jsonl`); each entry hashes the previous entry's hash, so tampering is detectable.
- Canonical JSON serializer (sorted keys, no whitespace) for stable provenance hashing.
- Token-cap soft warning to stderr when `skills.md` exceeds the per-agent threshold (default 32000, configurable in `config.json`).
- GitHub Actions CI workflow (typecheck + build + test on push and PR).
- `CHANGELOG.md`.

### Changed
- `modex feed` now requires an agent id: `modex feed <agent-id> <file>`. Reads the agent's existing `skills.md`, merges new skills by slug, writes atomically, and appends a provenance entry. Replaces the Phase A stdout-only form.
- Tag-count rule reconciled to 1-6 across `prompt.ts` JSON schema, `schema.ts` zod schema, and tests (was: schema allowed 0-16, prompt said 1-6).
- Bumped `@anthropic-ai/sdk` from 0.39.x to 0.95.x.
- Renamed `Docs/` to `docs/` so the README link works on case-sensitive filesystems.

## 0.0.0 — Phase A (initial)

### Added
- pnpm workspace with `@modexagents/core` and `@modexagents/cli` packages.
- `modex feed <file>` extracts skills from one `.txt` or `.md` file via Claude Haiku 4.5 (tool-forced JSON output, prompt caching on the system block) and writes canonical SKILLS.md to stdout.
- Byte-stable canonical SKILLS.md serializer (LF, slug-sorted via UTF-16 code-unit comparison, fixed field order, no timestamps in the body).
- Vitest coverage: golden fixture, idempotence, order-independence, mocked-Anthropic extract pipeline.
