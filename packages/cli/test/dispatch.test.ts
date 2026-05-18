import { describe, expect, it } from 'vitest';

import { buildProgram, main } from '../src/index.js';

// The CLI package is a thin commander wrapper — all orchestration lives in
// @modexagents/core and is exercised by core's operation tests. These tests only
// cover the dispatch layer: that the expected commands are wired and that
// main() maps outcomes to exit codes.

describe('buildProgram', () => {
  it('registers the top-level commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual([
      'agents',
      'aspirations',
      'bind',
      'cite',
      'eval',
      'feed',
      'login',
      'logout',
    ]);
  });

  it('wires the agents subcommands', () => {
    const program = buildProgram();
    const agents = program.commands.find((c) => c.name() === 'agents');
    expect(agents?.commands.map((c) => c.name()).sort()).toEqual(['create', 'list']);
  });

  it('wires the aspirations subcommands', () => {
    const program = buildProgram();
    const aspirations = program.commands.find((c) => c.name() === 'aspirations');
    expect(aspirations?.commands.map((c) => c.name()).sort()).toEqual(['add', 'list']);
  });

  it('wires the eval subcommands', () => {
    const program = buildProgram();
    const evalCmd = program.commands.find((c) => c.name() === 'eval');
    expect(evalCmd?.commands.map((c) => c.name()).sort()).toEqual([
      'add',
      'list',
      'results',
      'run',
    ]);
  });
});

describe('main', () => {
  it('returns 0 for --version', async () => {
    expect(await main(['node', 'modex', '--version'])).toBe(0);
  });

  it('returns 0 for --help', async () => {
    expect(await main(['node', 'modex', '--help'])).toBe(0);
  });

  it('returns non-zero for an unknown command', async () => {
    expect(await main(['node', 'modex', 'no-such-command'])).not.toBe(0);
  });
});
