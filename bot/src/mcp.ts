import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "./config.js";

type Session = {
  client: Client;
  connecting: Promise<Client> | null;
  inFlight: number;
};

/** One MCP session per Discord user — identity headers are immutable per session. */
const sessions = new Map<string, Session>();

const TOOLS_TTL_MS = 60 * 60 * 1000;
let toolsCache: { tools: McpTool[]; fetchedAt: number } | null = null;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function fetchForUser(discordUserId: string): FetchLike {
  return (url, init) => {
    const timeoutSignal = AbortSignal.timeout(config.MCP_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const headers = new Headers(init?.headers);
    headers.set("X-Bot-Secret", config.BOT_API_SECRET);
    headers.set("X-Discord-Id", discordUserId);
    return fetch(url, { ...init, headers, signal });
  };
}

type ClientFactory = (discordUserId: string) => Promise<Client>;
let clientFactory: ClientFactory | null = null;

/** Test hook — inject mock MCP clients per user. */
export function setMcpClientFactoryForTest(factory: ClientFactory | null): void {
  clientFactory = factory;
}

/** Test hook — authenticated fetch with per-user Discord header. */
export function createAuthenticatedFetch(discordUserId: string): FetchLike {
  return fetchForUser(discordUserId);
}

/** Test hook — reset all sessions and tool cache. */
export async function resetAllMcpSessionsForTest(): Promise<void> {
  const ids = [...sessions.keys()];
  toolsCache = null;
  for (const id of ids) {
    await resetMcpClient(id);
  }
  sessions.clear();
}

/** Test hook — list active session user ids. */
export function listMcpSessionUserIdsForTest(): string[] {
  return [...sessions.keys()];
}

async function connectUser(discordUserId: string): Promise<Client> {
  const existing = sessions.get(discordUserId);
  if (existing?.client) return existing.client;
  if (existing?.connecting) return existing.connecting;

  const slot: Session = {
    client: null as unknown as Client,
    connecting: null,
    inFlight: existing?.inFlight ?? 0,
  };
  sessions.set(discordUserId, slot);

  slot.connecting = (async () => {
    try {
      let next: Client;
      if (clientFactory) {
        next = await clientFactory(discordUserId);
      } else {
        const transport = new StreamableHTTPClientTransport(
          new URL(config.MCP_URL),
          { fetch: fetchForUser(discordUserId) },
        );
        const client = new Client(
          { name: "structured-bot", version: "0.5.0" },
          { capabilities: {} },
        );
        await client.connect(transport);
        next = client;
      }
      slot.client = next;
      return next;
    } catch (err) {
      sessions.delete(discordUserId);
      throw err;
    } finally {
      const current = sessions.get(discordUserId);
      if (current) current.connecting = null;
    }
  })();

  return slot.connecting;
}

export async function getMcpClient(discordUserId: string): Promise<Client> {
  if (!discordUserId) {
    throw new Error("discordUserId required for MCP client");
  }
  return connectUser(discordUserId);
}

export function isMcpConnected(discordUserId?: string): boolean {
  if (discordUserId) {
    const s = sessions.get(discordUserId);
    return Boolean(s?.client && !s.connecting);
  }
  for (const s of sessions.values()) {
    if (s.client && !s.connecting) return true;
  }
  return false;
}

export async function listMcpTools(
  discordUserId: string,
  force = false,
): Promise<McpTool[]> {
  if (
    !force &&
    toolsCache &&
    Date.now() - toolsCache.fetchedAt < TOOLS_TTL_MS
  ) {
    return toolsCache.tools;
  }
  const mcp = await getMcpClient(discordUserId);
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

/** Close only this user's session. Safe under concurrent prompts for other users. */
export async function resetMcpClient(discordUserId: string): Promise<void> {
  const prev = sessions.get(discordUserId);
  sessions.delete(discordUserId);
  toolsCache = null;
  if (prev?.client) {
    try {
      await prev.client.close();
    } catch {
      // ignore
    }
  }
}

/** Probe connectivity at startup using the first authorized user id. */
export async function probeMcp(): Promise<number> {
  const probeId =
    config.AUTHORIZED_USER_IDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? "probe";
  const tools = await listMcpTools(probeId, true);
  return tools.length;
}
