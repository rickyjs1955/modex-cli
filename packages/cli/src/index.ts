import { Command } from 'commander';

import { isUserFacingError, runFeed } from './commands/feed.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('modex')
    .description('Author SKILLS.md from a corpus on your own machine.')
    .version('0.0.0');

  program
    .command('feed')
    .description(
      'Extract candidate skills from one .txt or .md file and write SKILLS.md to stdout.',
    )
    .argument('<file>', 'Path to a .txt or .md file')
    .option('--model <id>', 'Anthropic model id to use (default: Claude Haiku 4.5)')
    .action(async (file: string, opts: { model?: string }) => {
      await runFeed(file, { model: opts.model });
    });

  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err: unknown) {
    if (isUserFacingError(err)) {
      process.stderr.write(`error: ${err.message}\n`);
      return 1;
    }
    // commander's exitOverride throws CommanderError for --help / --version.
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code?: string; exitCode?: number }).code;
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        return 0;
      }
      const exitCode = (err as { exitCode?: number }).exitCode;
      if (typeof exitCode === 'number') {
        if (err instanceof Error && err.message) {
          process.stderr.write(`${err.message}\n`);
        }
        return exitCode;
      }
    }
    process.stderr.write(
      `unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

