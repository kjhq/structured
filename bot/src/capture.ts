import OpenAI from "openai";
import { config } from "./config.js";
import { postAction } from "./botApi.js";
import type { PlannerItem } from "./embeds.js";

export type CapturedTask = {
  title: string;
  day?: string;
  start_time?: string;
  is_all_day?: boolean;
  notes?: string;
};

type VisionFn = (
  imageUrl: string,
  caption: string,
  timezone: string,
  today: string,
) => Promise<CapturedTask[]>;

let visionImpl: VisionFn | null = null;

export function setVisionImplForTest(fn: VisionFn | null): void {
  visionImpl = fn;
}

export function isImageAttachment(att: { contentType?: string | null }): boolean {
  return Boolean(att.contentType?.startsWith("image/"));
}

export function isVoiceAttachment(att: {
  contentType?: string | null;
  name?: string | null;
  duration?: number | null;
  waveform?: unknown;
}): boolean {
  const type = att.contentType ?? "";
  const name = att.name ?? "";
  if (type.startsWith("audio/")) return true;
  if (type.includes("ogg")) return true;
  if (name.toLowerCase().endsWith(".ogg") || name.toLowerCase().endsWith(".webm")) return true;
  if (att.waveform != null) return true;
  return false;
}

async function fetchAttachmentBytes(
  url: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const tryFetch = async (headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`attachment ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      bytes: buf,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  };
  try {
    return await tryFetch({});
  } catch {
    return await tryFetch({ Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` });
  }
}

async function defaultVision(
  imageUrl: string,
  caption: string,
  timezone: string,
  today: string,
): Promise<CapturedTask[]> {
  const model = config.LLM_VISION_MODEL;
  if (!model) return [];
  const client = new OpenAI({
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: 2,
  });
  const res = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          `Extract planner tasks from the image as JSON {"tasks":[{"title":"...","day":"YYYY-MM-DD?","start_time":"HH:MM?","is_all_day":bool?,"notes":"?"}]} . ` +
          `Timezone ${timezone}. Today is ${today}. 0..N tasks. No markdown. Caption is extra instruction.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: caption || "Extract tasks from this image." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  const text = res.choices[0]?.message?.content ?? "";
  return parseVisionJson(text);
}

export function parseVisionJson(text: string): CapturedTask[] {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { tasks?: unknown };
    if (!Array.isArray(parsed.tasks)) return [];
    return parsed.tasks
      .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
      .map((t) => ({
        title: String(t.title ?? "").trim(),
        day: typeof t.day === "string" ? t.day : undefined,
        start_time: typeof t.start_time === "string" ? t.start_time : undefined,
        is_all_day: Boolean(t.is_all_day),
        notes: typeof t.notes === "string" ? t.notes : undefined,
      }))
      .filter((t) => t.title.length > 0);
  } catch {
    return [];
  }
}

export async function extractTasksFromImage(
  imageUrl: string,
  caption: string,
  timezone: string,
  today: string,
): Promise<CapturedTask[]> {
  const impl = visionImpl ?? defaultVision;
  return impl(imageUrl, caption, timezone, today);
}

export function visionEnabled(): boolean {
  return Boolean(config.LLM_VISION_MODEL);
}

export function transcribeEnabled(): boolean {
  return Boolean(config.TRANSCRIBE_URL);
}

export async function transcribeAudio(url: string, filename: string): Promise<string> {
  if (!config.TRANSCRIBE_URL) {
    throw new Error("Voice capture is off.");
  }
  const { bytes, contentType } = await fetchAttachmentBytes(url);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename || "voice.ogg");
  form.append("model", "whisper-1");
  const res = await fetch(config.TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.TRANSCRIBE_API_KEY ?? config.LLM_API_KEY}`,
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`transcribe ${res.status}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

export function inboxTitle(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Discord message";
  return collapsed.slice(0, 80);
}

export function jumpNotes(
  content: string,
  loc: { guildId?: string | null; channelId: string; messageId: string },
): string {
  const rest = content.replace(/\s+/g, " ").trim().slice(80);
  const link = loc.guildId
    ? `https://discord.com/channels/${loc.guildId}/${loc.channelId}/${loc.messageId}`
    : `channel ${loc.channelId} message ${loc.messageId}`;
  return [rest, link].filter(Boolean).join("\n");
}

export async function createInboxThis(
  discordId: string,
  source: { content: string; guildId?: string | null; channelId: string; id: string },
): Promise<PlannerItem> {
  const title = inboxTitle(source.content);
  const notes = jumpNotes(source.content, {
    guildId: source.guildId,
    channelId: source.channelId,
    messageId: source.id,
  });
  return (await postAction(discordId, "add", {
    title,
    notes,
    client_request_id: `discord:msg:${source.id}:inbox`,
  })) as PlannerItem;
}

export async function createCapturedTasks(
  discordId: string,
  messageId: string,
  tasks: CapturedTask[],
): Promise<PlannerItem[]> {
  const created: PlannerItem[] = [];
  for (const [i, task] of tasks.entries()) {
    const item = (await postAction(discordId, "add", {
      title: task.title,
      day: task.day,
      start_time: task.start_time,
      is_all_day: Boolean(task.is_all_day),
      notes: task.notes,
      client_request_id: `discord:msg:${messageId}:i${i}`,
    })) as PlannerItem;
    created.push(item);
  }
  return created;
}
