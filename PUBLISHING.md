# Publishing

`@modexagents/core` and `@modexagents/cli` are published to npm under the `@modexagents` scope,
in lockstep (same version). Pre-1.0 — currently the `0.3.x` line.

> **Scope history.** These packages were briefly published under the `@mojax`
> scope (the bare `@modex` org was unavailable). They moved to `@modexagents`
> at `0.3.1`; the old `@mojax/*@0.3.1` versions are deprecated and point here.

## Prerequisites

- The `modexagents` npm organization exists, with your account holding publish rights.
- `npm login` completed locally (2FA prompts will appear at publish time).
- A clean working tree on `main`.

## Steps

1. **Verify green.** From the repo root:

   ```sh
   pnpm install
   pnpm -r build
   pnpm -r typecheck
   pnpm -r test
   ```

2. **Bump the version** in both `packages/core/package.json` and
   `packages/cli/package.json` (keep them equal), update `CHANGELOG.md`, and
   bump the `.version()` string in `packages/cli/src/index.ts`. Commit.

3. **Publish core first**, then the CLI — the CLI depends on core, and pnpm
   rewrites its `workspace:^` dependency to the concrete `^<version>` at pack
   time, so core must already be on the registry:

   ```sh
   pnpm --filter @modexagents/core publish
   pnpm --filter @modexagents/cli publish
   ```

   Each runs `prepublishOnly` (build + test) first. `publishConfig.access` is
   `public`, so no `--access` flag is needed.

4. **Deprecate the superseded `@mojax` packages** (one-time, only relevant
   for the `@mojax` → `@modexagents` move at `0.3.1`):

   ```sh
   npm deprecate @mojax/core@0.3.1 "Renamed to @modexagents/core"
   npm deprecate @mojax/cli@0.3.1 "Renamed to @modexagents/cli"
   ```

5. **Tag the release:**

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

6. **Smoke-test the published CLI** in a throwaway directory:

   ```sh
   npx @modexagents/cli@<version> --version
   npx @modexagents/cli@<version> agents create --name smoke-test
   ```

7. **Refresh the companion repos.** In `modex-mcp` and `modex-github-action`,
   run a real `npm install` (now resolves `@modexagents/core` from npm) and
   commit the regenerated `package-lock.json`. For `modex-github-action`,
   confirm CI's `dist/` staleness check still passes.

## Notes

- `files` allowlists keep the tarballs minimal: `dist/`, `README.md`, `LICENSE`
  (plus `bin/` for the CLI). `src/` and tests are not published.
- The two companion repos (`modex-mcp`, `modex-github-action`) depend on the
  **published** `@modexagents/core`. Publish here first, then bump their dependency
  ranges.
