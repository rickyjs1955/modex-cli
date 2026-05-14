# Publishing

`@modex/core` and `@modex/cli` are published to npm under the `@modex` scope,
in lockstep (same version). Pre-1.0 — currently the `0.3.x` line.

## Prerequisites

- npm account with publish rights on the `@modex` scope.
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
   pnpm --filter @modex/core publish
   pnpm --filter @modex/cli publish
   ```

   Each runs `prepublishOnly` (build + test) first. `publishConfig.access` is
   `public`, so no `--access` flag is needed.

4. **Tag the release:**

   ```sh
   git tag v<version>
   git push origin v<version>
   ```

5. **Smoke-test the published CLI** in a throwaway directory:

   ```sh
   npx @modex/cli@<version> --version
   npx @modex/cli@<version> agents create --name smoke-test
   ```

## Notes

- `files` allowlists keep the tarballs minimal: `dist/`, `README.md`, `LICENSE`
  (plus `bin/` for the CLI). `src/` and tests are not published.
- The two companion repos (`modex-mcp`, `modex-github-action`) depend on the
  **published** `@modex/core`. Publish here first, then bump their dependency
  ranges.
