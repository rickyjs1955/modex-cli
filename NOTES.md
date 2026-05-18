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

## Phase G — pre-flight (not yet implemented)

To resolve before starting Phase G:
- `POST /v1/agents/{agent_id}/eval-runs` — exact response shape (`{run_id, mark, transcript_excerpt}` is the brief's sketch; needs concretization).
- Who pays: Phase G's confirmed design is **CLI calls Anthropic locally** using the user's `ANTHROPIC_API_KEY`, then POSTs `{mark, transcript_excerpt}` to the registry. The "server orchestrates against the user's uploaded key" path in the brief is **not** the chosen design.
- Mark format (see above).
- `eval_run` provenance entry shape — likely `input: {agent_id, eval_id, model}`, `output: {run_id, mark, transcript_sha256}`.

## Phase H — pre-flight (not yet implemented)

- `POST /v1/agents/{agent_id}/cite` — body shape (`{bind_hash?}`), response shape (`{session_token, bind_hash}` per brief). Session token semantics: TTL? Single-use? Refreshable?
- Default for `--bind-hash`: client uses the latest from local `registry.json`. Server should accept a missing `bind_hash` and default to the agent's current head for symmetry.
- New provenance kind `cite` (input: `{bind_hash}`, output: `{session_token_sha256}` — hash, not raw token).
