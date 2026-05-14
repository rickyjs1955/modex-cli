# @modex/core

Core library behind [`modex-cli`](https://github.com/rickyjs1955/modex-cli) — the
shared engine used by the CLI, the MCP server, and the GitHub Action.

It provides:

- **Extraction** — turn `.txt` / `.md` / `.pdf` / `.epub` / web sources into structured skills via the Anthropic API.
- **Canonical `SKILLS.md`** — byte-stable serialization (sorted, LF, fixed field order) so the output is hashable.
- **Hash-chained provenance** — append-only `provenance.jsonl`; each entry hashes the previous one. Appends are serialized by a per-file lock, so concurrent writers (e.g. an MCP server) can't fork the chain.
- **Registry client** — device-code login, `bind`, and append-only `aspirations`.
- **Operations** — high-level `runFeed` / `runBind` / `runAspirationsAdd` / `runAgents*` / `runLogin` orchestrators that every surface calls.

```ts
import { runFeed, createAgent } from '@modex/core';

const agent = await createAgent({ name: 'engineering-handbook' });
await runFeed(agent.config.id, ['./book.md', './papers/*.pdf']);
```

The corpus never leaves the machine — only the Anthropic API call (extraction)
and, if you `bind`, the `SKILLS.md` content + hashes go out.

## License

MIT — see [LICENSE](./LICENSE).
