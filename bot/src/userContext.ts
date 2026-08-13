import { callToolForUser } from "./mcp.js";
import { config } from "./config.js";
import { todayYmd, ymdToHuman } from "./timezone.js";

export interface UserContext {
  timezone: string;
  /** Server logical date YYYY-MM-DD */
  today: string;
  /** profile = MCP overview; fallback = bot default (do not date-reset). */
  source?: "profile" | "fallback";
}

type McpContent = { type: string; text?: string };

function extractMcpJson(result: { content?: McpContent[] }): Record<string, unknown> | null {
  if (!result?.content) return null;
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function fallbackContext(): UserContext {
  const timezone = config.TIMEZONE;
  return { timezone, today: todayYmd(undefined, timezone), source: "fallback" };
}

type FetchContextFn = (discordUserId: string) => Promise<UserContext>;
let fetchContextOverride: FetchContextFn | null = null;

/** Test hook — bypass MCP for user profile. */
export function setFetchUserContextForTest(fn: FetchContextFn | null): void {
  fetchContextOverride = fn;
}

/** Planner profile: timezone + logical today from MCP (planner_get_overview). */
export async function fetchUserContext(discordUserId: string): Promise<UserContext> {
  if (fetchContextOverride) return fetchContextOverride(discordUserId);

  const fallback = fallbackContext();
  try {
    const res = await callToolForUser(discordUserId, "planner_get_overview", {
      response_format: "concise",
      next_n: 1,
    });
    const data = extractMcpJson(res as { content?: McpContent[] });
    if (!data || data.error === true) return fallback;

    const timezone =
      typeof data.timezone === "string" && data.timezone.trim()
        ? data.timezone.trim()
        : fallback.timezone;
    const today =
      typeof data.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.today)
        ? data.today
        : todayYmd(undefined, timezone);
    return { timezone, today, source: "profile" };
  } catch {
    return fallback;
  }
}

export function formatContextForPrompt(ctx: UserContext): {
  timezone: string;
  todayYmd: string;
  todayHuman: string;
} {
  return {
    timezone: ctx.timezone,
    todayYmd: ctx.today,
    todayHuman: ymdToHuman(ctx.today, ctx.timezone),
  };
}
