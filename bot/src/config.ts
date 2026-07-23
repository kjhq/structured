import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  AUTHORIZED_USER_ID: z.string().min(1),
  TIMEZONE: z.string().default("UTC"),
  LLM_BASE_URL: z.string().url().default("https://api.mistral.ai/v1"),
  LLM_MODEL: z.string().default("mistral-small-latest"),
  /** Our backend MCP endpoint (default local). */
  MCP_URL: z.string().url().default("http://127.0.0.1:8000/mcp/mcp"),
  /** API key from `backend/scripts/create_user.py`. */
  STRUCTURED_API_KEY: z.string().min(1),
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(20),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_HISTORY_CHARS: z.coerce.number().int().positive().default(256_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
