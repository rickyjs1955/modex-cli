# @modexagents/cli

Author a `SKILLS.md` from a corpus, on your own machine.

```sh
npm install -g @modexagents/cli

# create an agent, then feed it from a mix of sources
modex agents create --name engineering-handbook
modex feed <agent-id> ./book.md ./papers/*.pdf https://example.com/article
modex agents list
```

Sources can be `.txt`, `.md`, `.pdf`, `.epub`, http(s) URLs, or globs over any of
those. Each source is processed sequentially and produces one entry in the
agent's hash-chained `provenance.jsonl`. Per-agent state lives under
`.modex/<agent-id>/`.

## Registry binding (optional)

Authoring is fully offline and needs no account. To claim a `SKILLS.md`'s
lineage on a Modex-compatible registry:

```sh
modex login                              # device-code flow; writes ~/.config/modex/credentials.json (0600)
modex bind <agent-id>                     # uploads SKILLS.md + provenance head
modex aspirations add <agent-id> goal.md  # append an aspiration (append-only)
modex logout
```

Only `SKILLS.md` content + hashes (and aspiration content) reach the registry —
the corpus never leaves your machine.

All orchestration lives in [`@modexagents/core`](https://www.npmjs.com/package/@modexagents/core);
this package is the terminal surface over it.

## License

MIT — see [LICENSE](./LICENSE).
