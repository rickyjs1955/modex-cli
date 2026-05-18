import { runStdio } from './index.js';

runStdio().catch((err) => {
  process.stderr.write(
    `modex-mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
