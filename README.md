# modex-cli

Generate `SKILLS.md` from a corpus, on your own machine.

> **Status:** in development. APIs and CLI surface are not yet stable.

`modex-cli` reads text-based sources — `.txt`, `.md`, PDFs, EPUBs, web pages — and emits structured skill entries to a `SKILLS.md` manifest. The corpus stays on your machine; you supply your own Anthropic API key for extraction.

## Install

Not yet published. Once it ships:

```sh
# create an agent (UUIDv7), then feed it from a mix of sources
modex agents create --name engineering-handbook
modex feed <agent-id> ./book.md ./papers/*.pdf ./essays/*.epub https://example.com/article
modex agents list
```

Sources can be `.txt`, `.md`, `.pdf`, `.epub`, http(s) URLs, or globs over any of those. Each source is processed sequentially and produces one entry in the agent's `provenance.jsonl`.

Per-agent state lives at `.modex/<agent-id>/` (config, skills.md, hash-chained provenance log).

## Registry binding (optional)

Authoring is fully offline and needs no account. To claim a SKILLS.md's lineage on a Modex-compatible registry:

```sh
modex login                              # device-code flow; writes ~/.config/modex/credentials.json (0600)
modex bind <agent-id>                     # uploads SKILLS.md + provenance head, claims the agent
modex aspirations add <agent-id> goal.md  # append an aspiration (append-only — no edit/delete)
modex aspirations list <agent-id>         # see what's pinned (local; reads provenance)
modex logout                             # clear the local credential
```

Only the SKILLS.md content + hashes (and aspiration content) reach the registry — the corpus never leaves your machine.

## Evals

An **eval** is a parent-defined probe of an agent's behavior under a stated
rubric. Evals attach to an aspiration (honesty, brevity, refusal-to-flatter,
…), not to a single agent — any agent pinning that aspiration can be evaled
with it.

```sh
modex aspirations list <agent-id>                                   # find the aspiration hash
modex eval add <aspiration-hash> --text "<prompt>" \
                                 --mark-rubric "<criteria>"          # register a new eval
modex eval list <aspiration-hash>                                   # see all evals on that aspiration

# Execution — calls Anthropic against your own ANTHROPIC_API_KEY, marks the
# response, and reports the outcome to the registry.
modex eval run <agent-id> --aspiration <hash>                       # run every eval on this aspiration
modex eval run <agent-id> --eval-id <id>                            # run one specific eval
modex eval results <agent-id> [--eval-id <id>]                      # read back past runs from the registry
```

`eval run` records an `eval_run` entry in the agent's local provenance chain
(hash of the transcript + the mark rationale; the registry keeps the bytes).

## Citing

A **cite** registers an invocation of an agent's SKILLS.md at a specific
bind hash with the registry. The registry can then credit the agent author
for the use; you get back a session token to pass downstream.

```sh
modex cite <agent-id>                          # default: latest bind hash
modex cite <agent-id> --bind-hash <sha256>     # cite a specific snapshot
```

The session token prints to stdout, labelled `session_token:`. Local
provenance stores only its sha256 — the raw token is never written to disk.

## Companion surfaces

The same authoring flow is available from three surfaces, all built on the
shared `@modexagents/core` engine:

- **`@modexagents/cli`** — the terminal command shown above.
- **`@modexagents/mcp`** — a Model Context Protocol server (`modex-mcp`) that
  exposes the full verb set (`feed`, `agents`, `bind`, `aspirations`, `eval`,
  `cite`) as tools to MCP hosts (Claude Code, Cursor, Claude Desktop). See
  [packages/mcp/](packages/mcp/).
- **GitHub Action** at [packages/github-action/](packages/github-action/) —
  wraps the CLI in a workflow step. Use `modex-token` to bypass the
  interactive login for CI. Supports the eval-on-PR pattern.

## Contributing

```sh
pnpm install
pnpm -r build       # build core first; CLI and MCP consume its .d.ts
pnpm -r test
pnpm --filter @modexagents/cli dev -- agents create --name demo
pnpm --filter @modexagents/mcp dev    # run the MCP server on stdio
```

Requires Node 20+ and pnpm 10. See [docs/roadmap.md](docs/roadmap.md) for current phase.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md).

## SKILLS.md and the wider project

A `SKILLS.md` is a structured, provenance-linked manifest of skills that emerged from a corpus. The schema and this tooling are open (MIT). The [Modex](https://modex.md) registry is one place you can bind a SKILLS.md to claim its history — but binding is optional, and `modex-cli` is useful on its own.

## License

MIT — see [LICENSE](LICENSE).
