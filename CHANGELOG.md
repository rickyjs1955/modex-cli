# Changelog

All notable changes to `modex-cli` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning will follow [SemVer](https://semver.org/) once we cut a release.

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
- **`PROVENANCE_SCHEMA_VERSION` bumped 0 → 1. Breaking.** Phase B chains (`schema_version: 0`) are rejected at load with an actionable message pointing to `@modex/cli@0.1.x` for legacy agents. Create a fresh agent under `.modex/` to use Phase C.
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
- pnpm workspace with `@modex/core` and `@modex/cli` packages.
- `modex feed <file>` extracts skills from one `.txt` or `.md` file via Claude Haiku 4.5 (tool-forced JSON output, prompt caching on the system block) and writes canonical SKILLS.md to stdout.
- Byte-stable canonical SKILLS.md serializer (LF, slug-sorted via UTF-16 code-unit comparison, fixed field order, no timestamps in the body).
- Vitest coverage: golden fixture, idempotence, order-independence, mocked-Anthropic extract pipeline.
