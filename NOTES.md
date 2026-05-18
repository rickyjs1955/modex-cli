# Notes — API contract gaps and design questions

Things the client side made decisions about that the server side has not yet
confirmed or implemented. Pruned as the registry catches up.

## Phase F — `eval add` / `eval list`

### Endpoints assumed
- `POST /v1/aspirations/{hash}/evals` — body `{ text: string, mark_rubric?: string }`, returns `{ eval_id: string, created_at?: string }`.
- `GET  /v1/aspirations/{hash}/evals` — returns `{ evals: [{ eval_id, text, mark_rubric?, created_at? }, ...] }`.

Both auth'd with a `Bearer` token in the `authorization` header (same scheme as `bind` / `aspirations add`).

### 404 ambiguity
A bare 404 can mean **either** "this aspiration hash doesn't exist" **or** "this registry build doesn't ship eval endpoints yet." The response body has no field to distinguish them. The client treats the two cases identically and the user-facing error mentions both possibilities.

**Server-side fix:** distinguish with a body like `{"error": "no_such_aspiration"}` vs `{"error": "eval_endpoints_not_supported"}`. Until that lands, the client's 404 message is necessarily vague.

### Local persistence
Phase F intentionally writes **no local provenance** for `eval add`. The reasoning: evals attach to aspirations, not agents. There is no obvious local agent under `.modex/<id>/` to record the entry against — an aspiration may be pinned by zero, one, or many local agents.

If the registry decides evals *should* mirror locally (e.g. to support an `eval add --draft` offline flow), the natural shape is a per-aspiration cache at something like `.modex/aspirations/<hash>/evals.jsonl`, parallel to the per-agent layout. **Not built yet — decide before Phase G.**

### `eval list` auth
Currently requires login. The client could trivially be relaxed to send the bearer only when available, exposing public reads — but the server hasn't declared its policy. **Default to required-auth until the server says otherwise.**

### Mark rubric semantics
`--mark-rubric` is a free-text string. No structure, no required fields. **The mark-rubric format will need a schema before Phase G** (so `eval run` can produce a structured mark, not just a transcript). Open questions:
- Pass/fail vs. numeric score vs. multi-axis?
- Does the rubric itself get its own hash + provenance, or does it ride along with the eval?
- Who interprets the rubric — the model under eval, or a separate marker model?

### Aspiration hash discoverability
`modex aspirations list <agent-id>` (added in Phase F) reads from local provenance only. A future `aspirations list --registry --agent <id>` could pull the server's view (which would surface aspirations attached by *other* users to a shared agent). **Useful but not in Phase F scope.**

## Phase G — `eval run` / `eval results`

### Endpoints assumed
- `POST /v1/agents/{agent_id}/eval-runs` — body `{eval_id, aspiration_sha256, agent_skills_md_sha256, model, mark: {pass, rationale} | null, transcript_excerpt: string}`, returns `{run_id, created_at?}`.
- `GET  /v1/agents/{agent_id}/eval-runs[?eval_id=...]` — returns `{runs: [{run_id, eval_id, mark | null, transcript_excerpt?, created_at?}]}`.

### Locked design choices (so the API side can plan)
- **CLI calls Anthropic locally.** The server never holds the user's `ANTHROPIC_API_KEY` and never originates a model call. It's a passive recipient of `{mark, transcript_excerpt}` plus context. (Per the Q&A confirmed at the top of this branch.)
- Mark shape is `{pass: boolean, rationale: string}`. If the eval had no `mark_rubric`, the CLI skips the marker call entirely and POSTs `mark: null` — the run still records a transcript.
- The full agent response is hashed (`transcript_sha256`) for the local provenance chain. Only an 8 KB excerpt goes up to the registry (truncated with a marker line if larger). NOTES: if the server wants the full transcript, we need a separate upload step or a higher cap.

### Open contract items
- **404 ambiguity, again.** Same problem as Phase F: a bare 404 can mean "no such agent" or "registry doesn't ship eval-run endpoints yet." Body should disambiguate.
- **`transcript_excerpt` size cap.** Server should declare its accepted maximum so the client truncation can match. We picked 8 KB blindly.
- **Mark schema versioning.** If future evals want numeric scores or multi-axis rubrics, the POST body needs a `mark_version` (or similar) so old/new clients can coexist. Not blocking Phase G, but please carve out before deploying anything that diverges from `{pass, rationale}`.
- **Discovering an eval by id alone.** There's no `GET /v1/evals/{eval_id}` endpoint, so when the user passes `--eval-id` without `--aspiration` the client falls back to scanning every pinned aspiration via `listEvals`. Cheap for now, but a direct GET would be a nice ergonomic later.

### Local crash-window
- The order is: model run → POST → recordEntry. If the POST fails after a successful model call, the user has paid in tokens but no `eval_run` entry lands. The next `modex eval run` re-pays.
- Possible fix later: cache the executed result in `.modex/<id>/pending-eval-runs.jsonl` and resume on retry. Out of Phase G scope; flagging for Phase J / debt cleanup.

## Phase H — `cite`

### Endpoint assumed
- `POST /v1/agents/{agent_id}/cite` — body `{bind_hash?: string}`, returns `{session_token: string, bind_hash: string, ...passthrough}`. The server **must** always include `bind_hash` in the response (so the client knows which snapshot got cited when it sent no preference and the server chose).

### Locked design choices (so the API side can plan)
- `--bind-hash` defaults to the agent's latest from local `registry.json` (`last_server_skills_md_sha256`). Server should accept a missing `bind_hash` and default to the same.
- Session token is treated as **opaque** by the client. The CLI prints it to stdout (labelled `session_token:` for scriptable extraction) and hashes it for the local provenance entry. The raw token is never written to disk.
- New provenance kind `cite`: `input: {bind_hash}`, `output: {session_token_sha256, registry_url}`.

### Open contract items
- **Session token semantics.** TTL? Single-use? Refreshable? The CLI doesn't care today — but downstream consumers will. Server should publish this before any host starts relying on the token in production.
- **Citing an unbound agent.** Today the client errors with "run `modex bind` first." Server probably enforces the same. Worth confirming the server's 404 vs. 409 semantics so the error message can name the right thing.
- **Citation volume.** A heavy user could call `cite` hundreds of times per session. Local provenance handles it fine (sequential append-only chain) but if `eval results`-style reporting on citations becomes a thing, a per-agent citation list endpoint would be useful.
