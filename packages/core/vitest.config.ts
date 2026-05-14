import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirror tsup's build-time define so __MODEX_VERSION__ resolves under vitest.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

export default defineConfig({
  define: {
    __MODEX_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
