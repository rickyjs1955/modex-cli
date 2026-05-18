# Modex GitHub Action

Run [`@modexagents/cli`](https://www.npmjs.com/package/@modexagents/cli) inside
a GitHub workflow. The action installs the CLI, materializes credentials from
a secret, and runs one `modex` subcommand.

## Quick examples

### Extract new skills from a PR's changed docs

```yaml
- uses: rickyjs1955/modex-cli/packages/github-action@v0.8.0
  with:
    command: feed
    args: 0190f8c2-7c00-7c00-8000-000000000000 ./docs/*.md
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Bind a SKILLS.md to the registry on every push to `main`

```yaml
- uses: rickyjs1955/modex-cli/packages/github-action@v0.8.0
  with:
    command: bind
    args: 0190f8c2-7c00-7c00-8000-000000000000
    modex-token: ${{ secrets.MODEX_TOKEN }}
```

### Run evals against an agent on every PR (the eval-on-PR pattern)

```yaml
- uses: rickyjs1955/modex-cli/packages/github-action@v0.8.0
  with:
    command: eval
    # Run every eval registered on the named aspiration. Use --eval-id <id>
    # to scope to one.
    args: run 0190f8c2-7c00-7c00-8000-000000000000 --aspiration <aspiration-sha256>
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    modex-token: ${{ secrets.MODEX_TOKEN }}
```

`eval run` calls Anthropic on the runner (your `ANTHROPIC_API_KEY`), marks
the response, posts the outcome back to the registry, and appends an
`eval_run` entry to the agent's local provenance chain. Use the action's
exit code to fail the PR check when a run fails.

### Read past eval results

```yaml
- uses: rickyjs1955/modex-cli/packages/github-action@v0.8.0
  with:
    command: eval
    args: results 0190f8c2-7c00-7c00-8000-000000000000
    modex-token: ${{ secrets.MODEX_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `command` | yes | — | Modex subcommand (e.g. `feed`, `bind`, `aspirations add`). |
| `args` | no | `''` | Extra args for the subcommand, as one shell-quoted string. |
| `cli-version` | no | `latest` | `@modexagents/cli` version. Pin for reproducible runs. |
| `working-directory` | no | `${{ github.workspace }}` | Where `.modex/<agent-id>/` lives. |
| `anthropic-api-key` | no | — | Required for `feed`. Use a repo secret. |
| `modex-token` | no | — | Pre-issued registry token. Required for `bind` and `aspirations add` — device-code login is interactive and can't run in CI. Issue a token from the registry web UI. |
| `modex-registry-url` | no | `https://registry.modex.md` | Override the registry URL. |

## How `modex-token` works

`modex login` runs an OAuth-style device-code flow that needs a human to open
a browser and approve a code. That doesn't work in CI. Instead, generate a
long-lived token from your registry account settings and store it as a repo
secret. The action writes it into `~/.config/modex/credentials.json` (mode
`0600`, matching the schema the CLI's own login produces) before running the
subcommand.

If you don't supply `modex-token`, only offline commands (`feed`, `agents
create`, `agents list`) will work.

## License

MIT — see [LICENSE](./LICENSE).
