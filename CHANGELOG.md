# Changelog

All notable changes to `modex-cli` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning will follow [SemVer](https://semver.org/) once we cut a release.

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
