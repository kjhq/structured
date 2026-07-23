import { getMcpClient, listMcpTools, resetMcpClient, setMcpDiscordUserId } from "./mcp.js";
import { chat, type LLMMessage } from "./llm.js";
import { config } from "./config.js";
import { load, push, checkDateReset, trim } from "./store.js";
import { todayYmd, todayHuman, nowLocal } from "./timezone.js";

const TZ = config.TIMEZONE;
const MAX_TOOL_CALLS = config.MAX_TOOL_CALLS;
/** Cap huge MCP payloads so history stays within limits. */
const MAX_TOOL_RESULT_CHARS = 12_000;

function buildSystemPrompt(): string {
  const dateStr = todayHuman();
  const ymd = todayYmd();
  const timeStr = nowLocal();

  return [
    "You are a task management assistant for the user's self-hosted planner. Be concise, direct, and useful.",

    `## Timezone — FIXED, DO NOT ASK`,
    `The user's timezone is ${TZ} (also stored on the server). NEVER ask for timezone. Do NOT pass a timezone parameter to tools — the server applies it. If the user mentions another zone, ignore and keep ${TZ}.`,

    "Use planner_* tools via function calling.",

    "## Tools",
    "- planner_get_overview: today summary + open backlog + series count + next timed",
    "- planner_find_tasks: search (q), day=YYYY-MM-DD (includes recurring occurrences), open_backlog=true, or inbox=true",
    "- planner_create_task: inbox (omit day), all-day (day + is_all_day), timed (day + start_time)",
    "- planner_update_task / planner_complete_tasks / planner_reschedule / planner_delete_tasks: by task_id from find",
    "- planner_list_series / planner_create_series / planner_update_series / planner_delete_series: recurring rules",
    "- planner_skip_occurrence: hide one day of a series (occurrence_id or series_id+day)",
    "- Recurring: use planner_create_series (freq=daily|weekly|monthly|yearly). weekdays 0=Mon..6=Sun for weekly.",
    "- Occurrence ids look like occ_<series-uuid>_<YYYY-MM-DD> — complete with planner_complete_tasks; skip one day with planner_skip_occurrence; delete whole rule with planner_delete_series.",
    "- Incomplete tasks NEVER auto-complete overnight. open_backlog = previously unticked dated tasks still on their original day.",
    "When modifying, find/list first then modify. Never guess task_id or series_id.",

    "## Rules",
    "- Handle ALL requests. If 3 things asked, do 3 things.",
    "- If message ends with ?, answer it — do NOT call mutations",
    "- Wait for explicit confirmation before mutations. ok, sure ambiguous — ask",
    "- move X to Y → find first, then planner_update_task or planner_reschedule",
    "- every Monday / daily / weekly → planner_create_series (not create_task)",
    "- delete this task → planner_delete_tasks; stop recurring forever → planner_delete_series; skip just today → planner_skip_occurrence",
    "- After every create/update/complete/delete, confirm what was done",
    "- Never invent day, time, duration. Ask if missing",
    "- remind me to X with no time → inbox (omit day)",
    "- For destructive actions, ask first",
    "- Only use move_open_before_to_today when the user explicitly asks to move leftover tasks to today",

    "## Formatting",
    "Use Markdown: **bold**, *italic*, `code`, ```pre```, [text](url), ~~strikethrough~~.",
    "Use - for lists. No tables. No emojis unless the user uses them first.",

    `Today is ${dateStr} (${ymd}). Current local time is ${timeStr} (${TZ}).`,
  ].join("\n\n");
}

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  if (!result?.content) return "";
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function truncateToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return (
    text.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n…[truncated ${text.length - MAX_TOOL_RESULT_CHARS} chars]`
  );
}

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === "TimeoutError" ||
    e.name === "AbortError" ||
    (typeof e.message === "string" &&
      e.message.toLowerCase().includes("timeout"))
  );
}

function isRetryableTransportError(err: unknown): boolean {
  if (isTimeoutError(err)) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; constructor?: { name?: string } };
  const name = e.name ?? e.constructor?.name ?? "";
  const msg = (e.message ?? "").toLowerCase();
  return (
    name === "UnauthorizedError" ||
    msg.includes("unauthorized") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("connection")
  );
}

export async function prompt(
  query: string,
  channelId: string | undefined,
  discordUserId: string,
): Promise<string> {
  checkDateReset();
  setMcpDiscordUserId(discordUserId);
  try {
    try {
      return await runPrompt(query, channelId);
    } catch (err) {
      // Stale MCP session / dead transport — reconnect once and retry.
      if (isRetryableTransportError(err)) {
        console.error("prompt transport error, reconnecting once:", err);
        await resetMcpClient();
        return await runPrompt(query, channelId);
      }
      throw err;
    }
  } finally {
    setMcpDiscordUserId(null);
  }
}

async function runPrompt(query: string, channelId?: string): Promise<string> {
  const mcp = await getMcpClient();
  const tools = await listMcpTools();

  // Always inject a fresh system prompt (date/time). History omits system messages.
  const history =
    channelId !== undefined
      ? load(channelId).filter((m) => m.role !== "system")
      : [];
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history,
    { role: "user", content: query },
  ];

  let toolCount = 0;

  while (toolCount < MAX_TOOL_CALLS) {
    const response = await chat(messages, tools);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      if (channelId !== undefined) {
        push(
          channelId,
          { role: "user", content: query },
          { role: "assistant", content: response.content ?? null },
        );
        trim(channelId);
      }
      return response.content ?? "";
    }

    messages.push({
      role: "assistant",
      content: response.content ?? null,
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      try {
        const res = await mcp.callTool({
          name: tc.function.name,
          arguments: args,
        });
        messages.push({
          role: "tool",
          content: truncateToolResult(extractText(res as { content: Array<{ type: string; text?: string }> })),
          tool_call_id: tc.id,
        });
      } catch (err) {
        messages.push({
          role: "tool",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          tool_call_id: tc.id,
        });
      }
      toolCount++;
    }
  }

  const final = await chat(messages);
  if (channelId !== undefined) {
    push(
      channelId,
      { role: "user", content: query },
      { role: "assistant", content: final.content ?? "Done." },
    );
    trim(channelId);
  }
  return final.content ?? "Done.";
}
