import type { LLMMessage } from "./llm.js";
import { config } from "./config.js";
import { todayYmd } from "./timezone.js";

const store = new Map<string, LLMMessage[]>();

export function load(channelId: string): LLMMessage[] {
  return store.get(channelId) ?? [];
}

export function push(channelId: string, ...messages: LLMMessage[]): void {
  const existing = store.get(channelId) ?? [];
  existing.push(...messages);
  store.set(channelId, existing);
}

export function clear(channelId: string): void {
  store.delete(channelId);
}

export function historySize(channelId: string): number {
  return store.get(channelId)?.length ?? 0;
}

export function resetAll(): void {
  store.clear();
}

let lastDate = todayYmd();

export function checkDateReset(): boolean {
  const today = todayYmd();
  if (today !== lastDate) {
    lastDate = today;
    resetAll();
    return true;
  }
  return false;
}

/** Keep newest messages within MAX_HISTORY_CHARS (no privileged system slot). */
export function trim(channelId: string): void {
  const messages = store.get(channelId);
  if (!messages || messages.length === 0) return;

  let total = 0;
  const kept: LLMMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const len = JSON.stringify(messages[i]).length;
    if (total + len > config.MAX_HISTORY_CHARS && kept.length > 0) break;
    total += len;
    kept.unshift(messages[i]);
  }

  store.set(channelId, kept);
}
