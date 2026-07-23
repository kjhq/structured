import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "./config.js";

let client: Client | null = null;
let connecting: Promise<Client> | null = null;
let currentDiscordId: string | null = null;

const TOOLS_TTL_MS = 60 * 60 * 1000;
let toolsCache: { tools: McpTool[]; fetchedAt: number } | null = null;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export function setMcpDiscordUserId(id: string | null): void {
  currentDiscordId = id;
}

/**
 * Per-request timeout + bot secret + Discord user for our backend.
 * Do NOT put AbortSignal.timeout() in shared requestInit — that signal
 * fires once from transport creation and aborts every later call.
 */
const fetchWithAuth: FetchLike = (url, init) => {
  const timeoutSignal = AbortSignal.timeout(config.MCP_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  const headers = new Headers(init?.headers);
  headers.set("X-Bot-Secret", config.BOT_API_SECRET);
  if (currentDiscordId) {
    headers.set("X-Discord-Id", currentDiscordId);
  }
  return fetch(url, { ...init, headers, signal });
};

export async function getMcpClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(config.MCP_URL),
        { fetch: fetchWithAuth },
      );
      const next = new Client(
        { name: "structured-bot", version: "0.5.0" },
        { capabilities: {} },
      );
      await next.connect(transport);
      client = next;
      return next;
    } catch (err) {
      client = null;
      throw err;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export function isMcpConnected(): boolean {
  return client !== null;
}

export async function listMcpTools(force = false): Promise<McpTool[]> {
  if (
    !force &&
    toolsCache &&
    Date.now() - toolsCache.fetchedAt < TOOLS_TTL_MS
  ) {
    return toolsCache.tools;
  }
  const mcp = await getMcpClient();
  const toolsResponse = await mcp.listTools();
  const tools: McpTool[] = (toolsResponse.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<
      string,
      unknown
    >,
  }));
  toolsCache = { tools, fetchedAt: Date.now() };
  return tools;
}

export async function resetMcpClient(): Promise<void> {
  const prev = client;
  client = null;
  connecting = null;
  toolsCache = null;
  if (prev) {
    try {
      await prev.close();
    } catch {
      // ignore
    }
  }
}
