/** Serialize async work per chat so history/MCP turns never interleave. */

const tails = new Map<string, Promise<unknown>>();

export function enqueue<T>(channelId: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(channelId) ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive after failures so later messages still run.
  tails.set(
    channelId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}
