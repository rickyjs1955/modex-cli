# @modexagents/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the `modex` authoring verbs as tools to MCP hosts (Claude Code, Cursor,
Claude Desktop, etc.).

The MCP server is a thin wrapper over [`@modexagents/core`](https://www.npmjs.com/package/@modexagents/core) —
business logic and on-disk state (the `.modex/<agent-id>/` directories, the
hash-chained provenance chain, the registry credential file) are identical to
what the CLI uses. Anything you do via MCP shows up identically to a `modex`
command run in the same working directory.

## Install

```sh
npm install -g @modexagents/mcp
```

## Configure in Claude Code

Add to your `claude.json` (or via `claude mcp add`):

```json
{
  "mcpServers": {
    "modex": {
      "command": "modex-mcp"
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `modex_feed` | Extract skills from files, globs, or URLs into the agent's SKILLS.md. |
| `modex_agents_create` | Create a new agent under `.modex/<uuid7>/`. |
| `modex_agents_list` | List all agents in the current working directory. |
| `modex_bind` | Upload SKILLS.md + provenance head to the registry. |
| `modex_aspirations_add` | Append an aspiration (append-only). |
| `modex_aspirations_list` | Show aspirations pinned to an agent (local read of provenance). |
| `modex_eval_add` | Register an eval against an aspiration. |
| `modex_eval_list` | List evals registered on an aspiration. |
| `modex_eval_run` | Run one or more evals against an agent — calls Anthropic, marks, posts outcome. |
| `modex_eval_results` | Read past eval runs for an agent from the registry. |
| `modex_cite` | Register a citation of an agent's SKILLS.md at a specific bind hash. Returns a session token. |

`modex_feed` and `modex_eval_run` need `ANTHROPIC_API_KEY` in the server's
environment.

`modex_bind`, `modex_aspirations_add`, `modex_aspirations_list` (no — local
only), `modex_eval_*`, and `modex_cite` need a credential file at
`~/.config/modex/credentials.json`. The MCP surface deliberately does **not**
expose `login` / `logout` — device-code auth needs an interactive terminal.
Run `modex login` once from a real terminal; the MCP server picks up the same
file.

`modex_cite` returns the raw `session_token` in its tool response — the MCP
host surfaces it to the user so it can be used downstream. The local
provenance entry stores only its sha256; the raw token never lands on disk
via modex.

## License

MIT — see [LICENSE](./LICENSE).
