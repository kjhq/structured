import "dotenv/config";
import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (value === "" || value === undefined || value === null) return undefined;
  return value;
}

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  /** Comma-separated Discord snowflakes allowed to use the bot. */
  AUTHORIZED_USER_IDS: z.string().min(1),
  TIMEZONE: z.string().default("UTC"),
  LLM_BASE_URL: z.string().url().default("https://api.mistral.ai/v1"),
  LLM_MODEL: z.string().default("mistral-medium-latest"),
  /** Our backend MCP endpoint (default local). */
  MCP_URL: z.string().url().default("http://127.0.0.1:8000/mcp/mcp"),
  /** REST base for /v1/bot/link (no trailing slash). */
  API_BASE_URL: z.string().url().default("http://127.0.0.1:8000"),
  /** Shared with backend BOT_API_SECRET. */
  BOT_API_SECRET: z.string().min(1),
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(20),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_HISTORY_CHARS: z.coerce.number().int().positive().default(256_000),
  /** Conversation JSON directory. */
  DATA_DIR: z.string().min(1).default("/app/data"),
  /** 0 disables the notification worker. Non-zero values are at least 5000ms. */
  NOTIFY_POLL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(20_000)
    .transform((n) => (n === 0 ? 0 : Math.max(n, 5_000))),
  LLM_VISION_MODEL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  TRANSCRIBE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  TRANSCRIBE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export function authorizedUserIds(): string[] {
  return config.AUTHORIZED_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAuthorizedUser(userId: string): boolean {
  return authorizedUserIds().includes(userId);
}
