/** Serialize async work per user+channel so history/MCP turns never interleave. */

const tails = new Map<string, Promise<unknown>>();

export function queueKey(discordUserId: string, channelId: string): string {
  return `${discordUserId}:${channelId}`;
}

export function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive after failures so later messages still run.
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
