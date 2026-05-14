import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FileLockError, withFileLock } from '../src/fileLock.js';

async function tempTarget(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'modex-lock-'));
  return join(dir, 'data.jsonl');
}

describe('withFileLock', () => {
  it('runs the critical section and removes the lockfile afterward', async () => {
    const target = await tempTarget();
    const result = await withFileLock(target, async () => 42);
    expect(result).toBe(42);
    await expect(readFile(`${target}.lock`, 'utf8')).rejects.toThrow();
  });

  it('serializes concurrent callers — no interleaving', async () => {
    const target = await tempTarget();
    const log: string[] = [];
    const critical = (id: string) => async () => {
      log.push(`${id}:start`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`${id}:end`);
    };
    await Promise.all([
      withFileLock(target, critical('a')),
      withFileLock(target, critical('b')),
      withFileLock(target, critical('c')),
    ]);
    // Each start must be immediately followed by its own end.
    for (let i = 0; i < log.length; i += 2) {
      const id = log[i]!.split(':')[0];
      expect(log[i]).toBe(`${id}:start`);
      expect(log[i + 1]).toBe(`${id}:end`);
    }
  });

  it('releases the lock even when the critical section throws', async () => {
    const target = await tempTarget();
    await expect(
      withFileLock(target, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Lock released → a subsequent acquire succeeds.
    await expect(withFileLock(target, async () => 'ok')).resolves.toBe('ok');
  });

  it('steals a lock whose holder pid is dead', async () => {
    const target = await tempTarget();
    // Pid 1 is init/launchd — never "us" and effectively always present, so
    // use a pid that cannot be alive: write a clearly-dead holder by using a
    // huge pid value that process.kill will report as ESRCH.
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: 2_147_483_646, acquired_at: Date.now() }),
      'utf8',
    );
    const result = await withFileLock(target, async () => 'stolen', { timeoutMs: 2000 });
    expect(result).toBe('stolen');
  });

  it('steals a lock older than staleMs even if the pid looks alive', async () => {
    const target = await tempTarget();
    // Holder is THIS process (definitely alive) but acquired long ago.
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now() - 60_000 }),
      'utf8',
    );
    const result = await withFileLock(target, async () => 'stolen-stale', {
      staleMs: 30_000,
      timeoutMs: 2000,
    });
    expect(result).toBe('stolen-stale');
  });

  it('times out when a live, fresh holder never releases', async () => {
    const target = await tempTarget();
    await writeFile(
      `${target}.lock`,
      JSON.stringify({ pid: process.pid, acquired_at: Date.now() }),
      'utf8',
    );
    await expect(
      withFileLock(target, async () => 'never', { timeoutMs: 150, staleMs: 30_000 }),
    ).rejects.toBeInstanceOf(FileLockError);
  });
});
