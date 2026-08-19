import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "./config.js";
import type { LLMMessage } from "./llm.js";

export interface ConversationSnapshot {
  logical_date?: string;
  messages: LLMMessage[];
}

export interface HistoryFile {
  version: 1;
  conversations: Record<string, ConversationSnapshot>;
}

export function historyFilePath(): string {
  return join(config.DATA_DIR, "history.json");
}

export function loadHistoryFile(): HistoryFile {
  const path = historyFilePath();
  try {
    if (!existsSync(path)) {
      return { version: 1, conversations: {} };
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as HistoryFile;
    if (!raw || raw.version !== 1 || typeof raw.conversations !== "object") {
      return { version: 1, conversations: {} };
    }
    return raw;
  } catch (err) {
    console.error("Failed to read history file", err);
    return { version: 1, conversations: {} };
  }
}

export function saveHistoryFile(
  conversations: Map<string, LLMMessage[]>,
  logicalDates: Map<string, string>,
): void {
  mkdirSync(config.DATA_DIR, { recursive: true });
  const out: HistoryFile = { version: 1, conversations: {} };
  for (const [key, messages] of conversations.entries()) {
    out.conversations[key] = {
      messages,
      ...(logicalDates.get(key) ? { logical_date: logicalDates.get(key) } : {}),
    };
  }
  const tmp = `${historyFilePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(out));
  renameSync(tmp, historyFilePath());
}
