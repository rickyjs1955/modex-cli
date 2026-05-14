import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// Inject the package version at build time so DEFAULT_USER_AGENT (and anything
// else that needs it) never drifts from package.json.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  define: {
    __MODEX_VERSION__: JSON.stringify(pkg.version),
  },
});
