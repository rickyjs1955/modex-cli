import { Command } from 'commander';

import { runAgentsCreate, runAgentsList } from './commands/agents.js';
import { isUserFacingError, runFeed } from './commands/feed.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('modex')
    .description('Author SKILLS.md from a corpus on your own machine.')
    .version('0.2.0');

  program
    .command('feed')
    .description(
      'Extract skills from one or more sources (files, globs, or URLs) and merge into the agent\'s skills.md.',
    )
    .argument('<agent-id>', 'UUIDv7 of the target agent (see `modex agents list`)')
    .argument(
      '<patterns...>',
      'File paths, globs, or http(s) URLs. Local files: .txt, .md, .pdf, .epub.',
    )
    .option('--model <id>', 'Anthropic model id to use (default: Claude Haiku 4.5)')
    .action(
      async (agentId: string, patterns: string[], opts: { model?: string }) => {
        await runFeed(agentId, patterns, { model: opts.model });
      },
    );

  const agents = program
    .command('agents')
    .description('Manage local agents stored under .modex/');

  agents
    .command('create')
    .description('Create a new agent under .modex/<uuid7>/.')
    .option('--name <name>', 'Human-readable label for this agent (optional)')
    .action(async (opts: { name?: string }) => {
      await runAgentsCreate({ name: opts.name });
    });

  agents
    .command('list')
    .description('List all agents in this directory.')
    .action(async () => {
      await runAgentsList();
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
