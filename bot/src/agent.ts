import { getMcpClient, listMcpTools, resetMcpClient } from "./mcp.js";
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
    "- planner_get_overview: today summary + open backlog + series count + next timed + overlaps + streaks + settings",
    "- planner_find_tasks: search (q), day=YYYY-MM-DD, day_from+day_to (prefer ≤7 days), open_backlog=true, or inbox=true",
    "- planner_create_task: inbox (omit day), all-day (day + is_all_day), timed (day + start_time). Optional color/symbol/alerts/duration",
    "- planner_update_task / planner_complete_tasks / planner_uncomplete_tasks / planner_reschedule / planner_delete_tasks / planner_restore_tasks",
    "- planner_list_series / planner_create_series / planner_update_series / planner_delete_series: recurring rules",
    "- planner_skip_occurrence: hide one day. planner_override_occurrence: change just that day (this Thursday)",
    "- planner_update_settings: timezone, briefings (HH:MM or off), quiet hours, guild_mode, reminders",
    "- planner_suggest_slots: free times 07:00–21:00. Propose, wait for confirmation before scheduling",
    "- planner_toggle_note_item: check/uncheck a '- [ ]' line in one-off task notes (does not complete the parent)",
    "- Recurring: use planner_create_series (freq=daily|weekly|monthly|yearly). weekdays 0=Mon..6=Sun for weekly.",
    "- Occurrence ids look like occ_<series-uuid>_<YYYY-MM-DD> — complete with planner_complete_tasks; skip one day with planner_skip_occurrence; delete whole rule with planner_delete_series.",
    "- Incomplete tasks NEVER auto-complete overnight. open_backlog = previously unticked dated tasks still on their original day.",
    "When modifying, find/list first then modify. Never guess task_id or series_id.",

    "## Remind vs add",
    "- add/schedule X at 3pm → timed task, NO alerts",
    "- remind me / ping me / alert me at a time → timed + alerts:[{kind:start, offset_minutes:0}] (or -10 if 10 min before)",
    "- remind me in 20 min → timed today at now+20 with offset 0",
    "- remind me to X with no time → inbox, no alert, do not ask for a time",
    "- never say a reminder is set unless the tool result alerts array is non-empty",

    "## Rules",
    "- Handle ALL requests. If 3 things asked, do 3 things — call tools for each.",
    "- Clear create/add/delete/complete requests ARE confirmation — call the mutation tool immediately. Do not ask again.",
    "- Only ask for confirmation when the request is ambiguous (ok/sure with no referent) or destructive and unclear which item.",
    "- NEVER invent that a task or series exists. Before saying something already exists, call planner_list_series or planner_find_tasks.",
    "- NEVER say you added/updated/deleted something unless a planner_* tool just returned success for that item. If you did not call a tool, you did nothing.",
    "- If the user asks for a NEW recurring item, call planner_create_series even if another series already falls on that day. Same day can have multiple series.",
    "- move X to Y → find first, then planner_update_task or planner_reschedule",
    "- finish / done / mark complete / tick / tick off / check off X → find X, then planner_complete_tasks",
    "- uncheck / undo complete → planner_uncomplete_tasks (not restore)",
    "- undo delete / restore → planner_restore_tasks within 5 minutes; do not recreate",
    "- just this Thursday / only that day → planner_override_occurrence, not update_series",
    "- week / this week → planner_find_tasks day_from+day_to, not seven day= calls",
    "- check off milk (checklist in notes) → planner_toggle_note_item; completing the parent task is separate",
    "- plan my week → overview + range find + inbox; never schedule more than 3 inbox items without confirmation",
    "- park / when am I free → planner_suggest_slots, then wait for the user to confirm before create/reschedule",
    "- every Monday / daily / weekly / Nth of month → planner_create_series (not create_task)",
    "- delete this task → planner_delete_tasks; stop recurring forever → planner_delete_series; skip just today → planner_skip_occurrence",
    "- After every create/update/complete/delete, confirm using the tool result (title + schedule + alerts).",
    "- If the tool returns warnings.overlaps, mention a one-line heads-up. Do not undo the create.",
    "- Tool failures are not user-managed sessions. Never tell the user to activate or restart a planner session/service. If an operation still fails, say only that it could not be completed.",
    "- Never invent day, time, duration. Ask if missing (except remind-with-no-time → inbox)",
    "- Only use move_open_before_to_today when the user explicitly asks to move leftover tasks to today",
    "- Do not mention MCP, sessions, or API keys",
    "- Return short Discord markdown. Buttons/embeds are attached by the bot from tool JSON, not invented in prose.",

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
  client: McpClient,
  discordUserId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  client: McpClient;
  result: Awaited<ReturnType<McpClient["callTool"]>>;
}> {
  try {
    return {
      client,
      result: await client.callTool({ name, arguments: args }),
    };
  } catch (err) {
    if (!isStaleMcpSessionError(err)) throw err;
  }

  console.error("stale MCP session, reconnecting before retrying tool call");
  try {
    await resetMcpClient(discordUserId);
    const reconnected = await getMcpClient(discordUserId);
    return {
      client: reconnected,
      result: await reconnected.callTool({ name, arguments: args }),
    };
  } catch (err) {
    if (isRetryableTransportError(err)) {
      throw new ToolCallReconnectFailed(err);
    }
    throw err;
  }
}

const MUTATION_TOOLS = new Set([
  "planner_create_task",
  "planner_create_series",
  "planner_update_task",
  "planner_update_series",
  "planner_complete_tasks",
  "planner_uncomplete_tasks",
  "planner_delete_tasks",
  "planner_delete_series",
  "planner_restore_tasks",
  "planner_reschedule",
  "planner_skip_occurrence",
  "planner_override_occurrence",
  "planner_toggle_note_item",
]);

export type PromptOptions = {
  clientRequestId?: string;
};

export type PlannerMutation = {
  name: string;
  data: Record<string, unknown>;
};

export type PromptResult = {
  content: string;
  mutations: PlannerMutation[];
};

function parseToolJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function injectClientRequestId(
  name: string,
  args: Record<string, unknown>,
  clientRequestId?: string,
): void {
  if (!clientRequestId) return;
  if (name !== "planner_create_task" && name !== "planner_create_series") return;
  if (args.client_request_id == null || args.client_request_id === "") {
    args.client_request_id = clientRequestId;
  }
}

export async function prompt(
  query: string,
  channelId: string | undefined,
  discordUserId: string,
  options?: PromptOptions,
): Promise<string> {
  return (await promptFull(query, channelId, discordUserId, options)).content;
}

export async function promptFull(
  query: string,
  channelId: string | undefined,
  discordUserId: string,
  options?: PromptOptions,
): Promise<PromptResult> {
  const key =
    channelId !== undefined ? historyKey(discordUserId, channelId) : undefined;
  const userCtx = await fetchUserContext(discordUserId);
  if (key !== undefined) checkDateReset(key, userCtx.today);

  try {
    return await runPrompt(query, discordUserId, channelId, userCtx, options);
  } catch (err) {
    // Stale MCP session / dead transport — reconnect this user once and retry.
    if (isRetryableTransportError(err)) {
      console.error("prompt transport error, reconnecting once:", err);
      await resetMcpClient(discordUserId);
      const retryCtx = await fetchUserContext(discordUserId);
      if (key !== undefined) checkDateReset(key, retryCtx.today);
      return await runPrompt(query, discordUserId, channelId, retryCtx, options);
    }
    throw err;
  }
}

async function runPrompt(
  query: string,
  discordUserId: string,
  channelId: string | undefined,
  userCtx: UserContext,
  options?: PromptOptions,
): Promise<PromptResult> {
  let mcp = await getMcpClient(discordUserId);
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
  const mutations: PlannerMutation[] = [];

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
      return { content: response.content ?? "", mutations };
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
      injectClientRequestId(tc.function.name, args, options?.clientRequestId);
      try {
        const call = await callToolWithSessionRecovery(
          mcp,
          discordUserId,
          tc.function.name,
          args,
        );
        mcp = call.client;
        const text = truncateToolResult(
          extractText(
            call.result as { content: Array<{ type: string; text?: string }> },
          ),
        );
        messages.push({
          role: "tool",
          content: text,
          tool_call_id: tc.id,
        });
        if (MUTATION_TOOLS.has(tc.function.name)) {
          const data = parseToolJson(text);
          if (data && data.error !== true) {
            mutations.push({ name: tc.function.name, data });
          }
        }
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
  if (key !== undefined) {
    push(
      key,
      { role: "user", content: query },
      { role: "assistant", content: final.content ?? "Done." },
    );
    trim(key);
  }
  return { content: final.content ?? "Done.", mutations };
}

