import type { LLMMessage } from "./llm.js";
import { config } from "./config.js";
import { loadHistoryFile, saveHistoryFile } from "./historyFile.js";

const store = new Map<string, LLMMessage[]>();
const recentKeys: string[] = [];
const lastDateByKey = new Map<string, string>();
const DEFAULT_MAX_HISTORY_KEYS = 256;
let maxHistoryKeys = DEFAULT_MAX_HISTORY_KEYS;

function persist(): void {
  try {
    saveHistoryFile(store, lastDateByKey);
  } catch (err) {
    console.error("Failed to persist conversation history", err);
  }
}

function hydrate(): void {
  const file = loadHistoryFile();
  store.clear();
  lastDateByKey.clear();
  recentKeys.length = 0;
  for (const [key, conv] of Object.entries(file.conversations)) {
    store.set(key, conv.messages ?? []);
    if (conv.logical_date) lastDateByKey.set(key, conv.logical_date);
    recentKeys.push(key);
  }
}

hydrate();

/** Isolate history per Discord user within a channel. */
export function historyKey(discordUserId: string, channelId: string): string {
  return `${discordUserId}:${channelId}`;
}

export function setMaxHistoryKeysForTest(n: number | null): void {
  maxHistoryKeys = n ?? DEFAULT_MAX_HISTORY_KEYS;
}

function touchKey(key: string): void {
  const i = recentKeys.indexOf(key);
  if (i >= 0) recentKeys.splice(i, 1);
  recentKeys.push(key);
  while (recentKeys.length > maxHistoryKeys) {
    const drop = recentKeys.shift();
    if (!drop) break;
    store.delete(drop);
    lastDateByKey.delete(drop);
  }
}

export function load(key: string): LLMMessage[] {
  const msgs = store.get(key);
  if (msgs) touchKey(key);
  return msgs ?? [];
}

export function push(key: string, ...messages: LLMMessage[]): void {
  const existing = store.get(key) ?? [];
  existing.push(...messages);
  store.set(key, existing);
  touchKey(key);
  persist();
}

export function clear(key: string): void {
  store.delete(key);
  const i = recentKeys.indexOf(key);
  if (i >= 0) recentKeys.splice(i, 1);
  persist();
}

export function historySize(key: string): number {
  return store.get(key)?.length ?? 0;
}

export function resetAll(): void {
  store.clear();
  recentKeys.length = 0;
  lastDateByKey.clear();
  persist();
}

/** Clear in-memory history without touching the JSON file (simulates process exit). */
export function resetMemory(): void {
  store.clear();
}

/** Keep newest messages within MAX_HISTORY_CHARS (no privileged system slot). */
export function trim(key: string): void {
  const messages = store.get(key);
  if (!messages || messages.length === 0) return;

  let total = 0;
  const kept: LLMMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const len = JSON.stringify(messages[i]).length;
    if (total + len > config.MAX_HISTORY_CHARS && kept.length > 0) break;
    total += len;
    kept.unshift(messages[i]);
  }

  store.set(key, kept);
  persist();
}

/** Clear one conversation when the user's server logical day rolls over. */
export function checkDateReset(key?: string, serverToday?: string): boolean {
  if (!key || !serverToday) return false;
  const prev = lastDateByKey.get(key);
  if (prev && prev !== serverToday) {
    clear(key);
    lastDateByKey.set(key, serverToday);
    persist();
    return true;
  }
  if (!prev) {
    lastDateByKey.set(key, serverToday);
    persist();
  }
  return false;
}

export function resetDateTracking(): void {
  lastDateByKey.clear();
}

/** Reload Map from disk (simulated process restart). */
export function reloadFromDisk(): void {
  hydrate();
}
