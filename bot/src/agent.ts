import { getMcpClient, listMcpTools, resetMcpClient, callToolForUser } from "./mcp.js";
import { chat, type LLMMessage } from "./llm.js";
import { config } from "./config.js";
import { load, push, checkDateReset, trim, historyKey } from "./store.js";
import { nowLocal } from "./timezone.js";
import {
  fetchUserContext,
  formatContextForPrompt,
  type UserContext,
} from "./userContext.js";

const MAX_TOOL_CALLS = config.MAX_TOOL_CALLS;
/** Cap huge MCP payloads so history stays within limits. */
const MAX_TOOL_RESULT_CHARS = 12_000;

type ChatFn = typeof chat;
let chatImpl: ChatFn = chat;

/** Test hook — swap LLM client without touching production env. */
export function setChatImplForTest(fn: ChatFn | null): void {
  chatImpl = fn ?? chat;
}

function buildSystemPrompt(ctx: UserContext): string {
  const { timezone, todayYmd: ymd, todayHuman: dateStr } = formatContextForPrompt(ctx);
  const timeStr = nowLocal(undefined, timezone);

  return [
    "You are a task management assistant for the user's self-hosted planner. Be concise, direct, and useful.",

    `## Timezone — FIXED, DO NOT ASK`,
    `The user's timezone is ${timezone} (from their server profile). NEVER ask for timezone. Do NOT pass a timezone parameter to tools — the server applies it. If the user mentions another zone, ignore and keep ${timezone}.`,

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
    "- Handle ALL requests. If 3 things asked, do 3 things — call tools for each.",
    "- Clear create/add/delete/complete requests ARE confirmation — call the mutation tool immediately. Do not ask again.",
    "- Only ask for confirmation when the request is ambiguous (ok/sure with no referent) or destructive and unclear which item.",
    "- NEVER invent that a task or series exists. Before saying something already exists, call planner_list_series or planner_find_tasks.",
    "- NEVER say you added/updated/deleted something unless a planner_* tool just returned success for that item. If you did not call a tool, you did nothing.",
    "- If the user asks for a NEW recurring item, call planner_create_series even if another series already falls on that day. Same day can have multiple series.",
    "- move X to Y → find first, then planner_update_task or planner_reschedule",
    "- finish / done / mark complete / tick / tick off / check off X → find X, then planner_complete_tasks",
    "- every Monday / daily / weekly / Nth of month → planner_create_series (not create_task)",
    "- delete this task → planner_delete_tasks; stop recurring forever → planner_delete_series; skip just today → planner_skip_occurrence",
    "- After every create/update/complete/delete, confirm using the tool result (title + schedule).",
    "- Tool failures are not user-managed sessions. Never tell the user to activate or restart a planner session/service. If an operation still fails, say only that it could not be completed.",
    "- Never invent day, time, duration. Ask if missing",
    "- remind me to X with no time → inbox (omit day)",
    "- Only use move_open_before_to_today when the user explicitly asks to move leftover tasks to today",

    "## Formatting",
    "Use Markdown: **bold**, *italic*, `code`, ```pre```, [text](url), ~~strikethrough~~.",
    "Use - for lists. No tables. No emojis unless the user uses them first.",

    `Today is ${dateStr} (${ymd}). Current local time is ${timeStr} (${timezone}).`,
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

function isStaleMcpSessionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    message?: string;
    code?: number;
  };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === 404 ||
    e.code === -32001 ||
    msg.includes("session not found") ||
    msg.includes("no valid session") ||
    msg.includes("mcp-session-id")
  );
}

function isRetryableTransportError(err: unknown): boolean {
  if (isTimeoutError(err) || isStaleMcpSessionError(err)) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    message?: string;
    constructor?: { name?: string };
  };
  const name = e.name ?? e.constructor?.name ?? "";
  const msg = (e.message ?? "").toLowerCase();
  if (name === "UnauthorizedError" || msg.includes("unauthorized")) {
    return false;
  }
  return (
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("connection")
  );
}

type McpClient = Awaited<ReturnType<typeof getMcpClient>>;

class ToolCallReconnectFailed extends Error {
  constructor(readonly original: unknown) {
    super(
      `MCP tool call still failed after reconnect: ${
        original instanceof Error ? original.message : String(original)
      }`,
    );
    this.name = "ToolCallReconnectFailed";
  }
}

async function callToolWithSessionRecovery(
  discordUserId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Awaited<ReturnType<McpClient["callTool"]>>> {
  try {
    return await callToolForUser(discordUserId, name, args);
  } catch (err) {
    if (!isStaleMcpSessionError(err)) throw err;
  }

  console.error("stale MCP session, reconnecting before retrying tool call");
  try {
    await resetMcpClient(discordUserId);
    return await callToolForUser(discordUserId, name, args);
  } catch (err) {
    if (isRetryableTransportError(err)) {
      throw new ToolCallReconnectFailed(err);
    }
    throw err;
  }
}

export async function prompt(
  query: string,
  channelId: string | undefined,
  discordUserId: string,
): Promise<string> {
  const key =
    channelId !== undefined ? historyKey(discordUserId, channelId) : undefined;
  const userCtx = await fetchUserContext(discordUserId);
  if (key !== undefined && userCtx.source !== "fallback") {
    checkDateReset(key, userCtx.today);
  }

  const replay = { toolsStarted: 0 };
  try {
    return await runPrompt(query, discordUserId, channelId, userCtx, replay);
  } catch (err) {
    // Stale MCP / dead transport before any tool call — reconnect once.
    if (isRetryableTransportError(err) && replay.toolsStarted === 0) {
      console.error("prompt transport error, reconnecting once:", err);
      await resetMcpClient(discordUserId);
      const retryCtx = await fetchUserContext(discordUserId);
      if (key !== undefined && retryCtx.source !== "fallback") {
        checkDateReset(key, retryCtx.today);
      }
      return await runPrompt(query, discordUserId, channelId, retryCtx, {
        toolsStarted: 0,
      });
    }
    throw err;
  }
}

async function runPrompt(
  query: string,
  discordUserId: string,
  channelId: string | undefined,
  userCtx: UserContext,
  replay: { toolsStarted: number },
): Promise<string> {
  await getMcpClient(discordUserId);
  const tools = await listMcpTools(discordUserId);

  const key =
    channelId !== undefined ? historyKey(discordUserId, channelId) : undefined;
  const history = key !== undefined ? load(key).filter((m) => m.role !== "system") : [];
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt(userCtx) },
    ...history,
    { role: "user", content: query },
  ];

  let toolCount = 0;

  while (toolCount < MAX_TOOL_CALLS) {
    const response = await chatImpl(messages, tools);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      if (key !== undefined) {
        push(
          key,
          { role: "user", content: query },
          { role: "assistant", content: response.content ?? null },
        );
        trim(key);
      }
      return response.content ?? "";
    }

    messages.push({
      role: "assistant",
      content: response.content ?? null,
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch (err) {
        messages.push({
          role: "tool",
          content: `Error: invalid tool arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
          tool_call_id: tc.id,
        });
        toolCount++;
        continue;
      }
      try {
        replay.toolsStarted++;
        const result = await callToolWithSessionRecovery(
          discordUserId,
          tc.function.name,
          args,
        );
        messages.push({
          role: "tool",
          content: truncateToolResult(
            extractText(
              result as { content: Array<{ type: string; text?: string }> },
            ),
          ),
          tool_call_id: tc.id,
        });
      } catch (err) {
        const toolError =
          err instanceof ToolCallReconnectFailed ? err.original : err;
        messages.push({
          role: "tool",
          content: `Error: ${
            toolError instanceof Error ? toolError.message : String(toolError)
          }`,
          tool_call_id: tc.id,
        });
      }
      toolCount++;
    }
  }

  const final = await chatImpl(messages);
  const note = `\n\n(Stopped after ${MAX_TOOL_CALLS} tool calls — send another message if you need more.)`;
  const content = (final.content ?? "Done.") + note;
  if (key !== undefined) {
    push(
      key,
      { role: "user", content: query },
      { role: "assistant", content },
    );
    trim(key);
  }
  return content;
}
