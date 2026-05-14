import { open, readFile, unlink } from 'node:fs/promises';

// Cross-process advisory lock built on O_EXCL file creation.
//
// `fs.open(path, 'wx')` atomically creates the lockfile or fails with EEXIST —
// that atomicity is the whole mechanism. The holder writes its pid + acquire
// timestamp into the file so a crashed holder's lock can be detected and
// stolen rather than wedging every future writer.

export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_STALE_MS = 30_000;
const RETRY_BACKOFF_MS = 50;

export class FileLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileLockError';
  }
}

export interface LockOptions {
  // Give up acquiring after this long. Default 10s.
  timeoutMs?: number;
  // A lockfile older than this whose holder pid is gone is considered stale
  // and stolen. Default 30s.
  staleMs?: number;
  // Test seam: overrides Date.now for deterministic timeout/staleness tests.
  now?: () => number;
}

interface LockHolder {
  pid: number;
  acquired_at: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Is the process holding the lock still alive? `kill(pid, 0)` sends no signal,
// it just probes: ESRCH means the process is gone. EPERM means it exists but
// is owned by someone else — still alive, so still a valid holder.
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readHolder(lockPath: string): Promise<LockHolder | null> {
  try {
    const raw = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LockHolder>;
    if (typeof parsed.pid === 'number' && typeof parsed.acquired_at === 'number') {
      return { pid: parsed.pid, acquired_at: parsed.acquired_at };
    }
    return null;
  } catch {
    // Missing (released between EEXIST and read) or unparseable — caller retries.
    return null;
  }
}

// Acquire `<lockPath>`, run `fn`, release in a finally. The lockfile is
// `<targetPath>.lock`. Concurrent callers serialize; a stale lock (dead
// holder, or older than staleMs) is stolen.
export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const now = opts.now ?? Date.now;

  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, acquired_at: now() } satisfies LockHolder),
          'utf8',
        );
      } finally {
        await handle.close();
      }
      // Lock held — run the critical section, then always release.
      try {
        return await fn();
      } finally {
        await unlink(lockPath).catch(() => {
          // Already gone (e.g. stolen as stale). Nothing to do.
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      // Someone holds it. Decide whether to wait or steal.
      const holder = await readHolder(lockPath);
      const stale =
        holder !== null &&
        (!pidAlive(holder.pid) || now() - holder.acquired_at > staleMs);
      if (stale) {
        await unlink(lockPath).catch(() => {
          // Lost the steal race — another waiter unlinked first. Just retry.
        });
        continue;
      }

      if (now() >= deadline) {
        throw new FileLockError(
          `Timed out after ${timeoutMs}ms acquiring ${lockPath}` +
            (holder ? ` (held by pid ${holder.pid})` : ''),
        );
      }
      await sleep(RETRY_BACKOFF_MS);
    }
  }
}
