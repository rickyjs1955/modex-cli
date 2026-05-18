import {
  isUserFacingError,
  runAgentsCreate,
  runAgentsList,
  runAspirationsAdd,
  runAspirationsList,
  runBind,
  runCite,
  runEvalAdd,
  runEvalList,
  runEvalResults,
  runEvalRun,
  runFeed,
  runLogin,
  runLogout,
} from '@modexagents/core';
import { Command } from 'commander';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('modex')
    .description('Author SKILLS.md from a corpus on your own machine.')
    .version('0.8.0');

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

  program
    .command('login')
    .description('Authorize this CLI against a Modex-compatible registry (device-code flow).')
    .option('--registry <url>', 'Registry base URL (default: https://registry.modex.md)')
    .action(async (opts: { registry?: string }) => {
      await runLogin({ registry: opts.registry });
    });

  program
    .command('logout')
    .description('Clear the locally stored registry credentials.')
    .action(async () => {
      await runLogout();
    });

  program
    .command('bind')
    .description('Bind a local agent to the registry: upload SKILLS.md + provenance head.')
    .argument('<agent-id>', 'UUIDv7 of the agent to bind')
    .action(async (agentId: string) => {
      await runBind(agentId);
    });

  const aspirations = program
    .command('aspirations')
    .description('Manage an agent\'s aspirations (append-only).');

  aspirations
    .command('add')
    .description('Append an aspiration to a bound agent from a markdown file.')
    .argument('<agent-id>', 'UUIDv7 of the (already bound) agent')
    .argument('<md-file>', 'Path to a markdown file describing the aspiration')
    .action(async (agentId: string, mdFile: string) => {
      await runAspirationsAdd(agentId, mdFile);
    });

  aspirations
    .command('list')
    .description('List the aspirations attached to an agent (local; reads provenance).')
    .argument('<agent-id>', 'UUIDv7 of the agent')
    .action(async (agentId: string) => {
      await runAspirationsList(agentId);
    });

  const evalCmd = program
    .command('eval')
    .description(
      'Author and inspect evals — parent-defined probes of an agent\'s behavior under a rubric.',
    );

  evalCmd
    .command('add')
    .description(
      'Register an eval against an aspiration. Eval prompts attach to the aspiration (not a single agent) so any agent pinning that aspiration can be evaled with it.',
    )
    .argument(
      '<aspiration-hash>',
      'sha256 of the aspiration (see `modex aspirations list <agent-id>`)',
    )
    .requiredOption('--text <prompt>', 'The eval prompt — what the agent will be asked')
    .option(
      '--mark-rubric <criteria>',
      'Optional rubric the eval-runner uses to mark the response',
    )
    .action(
      async (
        aspirationHash: string,
        opts: { text: string; markRubric?: string },
      ) => {
        await runEvalAdd(aspirationHash, {
          text: opts.text,
          markRubric: opts.markRubric,
        });
      },
    );

  evalCmd
    .command('list')
    .description('List the evals registered against an aspiration.')
    .argument('<aspiration-hash>', 'sha256 of the aspiration')
    .action(async (aspirationHash: string) => {
      await runEvalList(aspirationHash);
    });

  evalCmd
    .command('run')
    .description(
      'Run one or more evals against an agent. Calls the model locally (your ANTHROPIC_API_KEY), then reports the outcome to the registry. Specify --eval-id, --aspiration, or both.',
    )
    .argument('<agent-id>', 'UUIDv7 of the agent to probe')
    .option('--eval-id <id>', 'Run a specific eval by id')
    .option(
      '--aspiration <hash>',
      'Run every eval registered on this aspiration (must be pinned to the agent)',
    )
    .option('--model <id>', 'Anthropic model id to use (default: Claude Haiku 4.5)')
    .action(
      async (
        agentId: string,
        opts: { evalId?: string; aspiration?: string; model?: string },
      ) => {
        await runEvalRun(agentId, {
          evalId: opts.evalId,
          aspirationHash: opts.aspiration,
          model: opts.model,
        });
      },
    );

  evalCmd
    .command('results')
    .description('Show past eval runs for an agent from the registry.')
    .argument('<agent-id>', 'UUIDv7 of the agent')
    .option('--eval-id <id>', 'Filter to runs of a specific eval')
    .action(async (agentId: string, opts: { evalId?: string }) => {
      await runEvalResults(agentId, { evalId: opts.evalId });
    });

  program
    .command('cite')
    .description(
      'Register a citation of an agent\'s SKILLS.md at a specific bind hash. Prints a session_token for downstream attribution; records the citation locally (session_token is stored as sha256 only).',
    )
    .argument('<agent-id>', 'UUIDv7 of the (already bound) agent')
    .option(
      '--bind-hash <hash>',
      'sha256 of a specific bound snapshot (default: the agent\'s latest from registry.json)',
    )
    .action(async (agentId: string, opts: { bindHash?: string }) => {
      await runCite(agentId, { bindHash: opts.bindHash });
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
