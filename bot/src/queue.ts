/** Serialize async work per user+channel so history/MCP turns never interleave. */

const tails = new Map<string, Promise<unknown>>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEFAULT_IDLE_MS = 5 * 60 * 1000;
let idleMs = DEFAULT_IDLE_MS;

export function queueKey(discordUserId: string, channelId: string): string {
  return `${discordUserId}:${channelId}`;
}

export function setQueueIdleMsForTest(ms: number | null): void {
  idleMs = ms ?? DEFAULT_IDLE_MS;
}

export function queueSizeForTest(): number {
  return tails.size;
}

export function resetQueueForTest(): void {
  for (const timer of idleTimers.values()) clearTimeout(timer);
  idleTimers.clear();
  tails.clear();
  idleMs = DEFAULT_IDLE_MS;
}

export function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive after failures so later messages still run.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, settled);
  const existingTimer = idleTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  void settled.then(() => {
    const timer = setTimeout(() => {
      if (tails.get(key) === settled) tails.delete(key);
      idleTimers.delete(key);
    }, idleMs);
    timer.unref();
    idleTimers.set(key, timer);
  });
  return run;
}
