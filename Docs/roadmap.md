# Roadmap

`modex-cli` ships in five phases. Phases A–C are useful as a standalone offline tool — you can author `SKILLS.md` without ever talking to a registry.

## A — Scaffold + offline extraction

- pnpm workspace, TypeScript, bin entry
- `feed` parses one `.txt`/`.md` file, calls the Anthropic API with a structured extraction prompt, emits candidate skills to stdout
- Define the canonical SKILLS.md schema (stable ordering — hashing depends on it)

**Exit criterion:** `npx @modex/cli feed ./book.md` produces stable SKILLS.md output.

## B — Local state + provenance

- `.modex/<agent-id>/` per-agent directory: `skills.md`, `provenance.jsonl`, `config.json`
- `agents create` / `agents list` against local state
- Hash-chained provenance entries
- Token-cap warning per the schema spec

**Exit criterion:** end-to-end offline flow — create an agent, feed sources, write SKILLS.md with provenance.

## C — More source types

- PDF, EPUB, and web-page extractors
- Glob patterns for batch feeding

**Exit criterion:** real reading lists work without manual conversion.

## D — Registry binding

- `login` against a Modex-compatible registry
- `bind` — hash SKILLS.md + aspiration hashes, POST to the registry
- `aspirations add` — append-only

**Exit criterion:** users can bind a SKILLS.md to a registry and see its lineage.

## E — Companion surfaces

- `modex-mcp` — MCP server exposing `feed` / `aspirations add` / `bind` as tools to Claude Code, Cursor, and other MCP hosts
- `modex-github-action` — wrap the CLI in a GitHub workflow step

**Exit criterion:** the same authoring flow works from a terminal, an MCP host, and CI.