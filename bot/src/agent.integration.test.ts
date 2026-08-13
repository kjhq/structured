import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { prompt, promptFull, setChatImplForTest } from "./agent.js";
import {
  setMcpClientFactoryForTest,
  resetAllMcpSessionsForTest,
} from "./mcp.js";
import { load, resetAll, resetDateTracking, historyKey } from "./store.js";
import { setFetchUserContextForTest } from "./userContext.js";
import type { LLMMessage } from "./llm.js";
import {
  FIXTURE_CHANNEL,
  FIXTURE_USERS,
  installTestEnv,
  restoreTestEnv,
} from "./test/fixtures.js";

function overviewClient(userId: string, timezone: string, today: string): Client {
  const toolCalls: string[] = [];
  return {
    connect: async () => {},
    close: async () => {},
    listTools: async () => ({
      tools: [{ name: "planner_get_overview", inputSchema: { type: "object" } }],
    }),
    callTool: async ({ name }: { name: string }) => {
      toolCalls.push(`${userId}:${name}`);
      if (name === "planner_get_overview") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ timezone, today, today_count: 0 }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: "{}" }] };
    },
    __toolCalls: toolCalls,
  } as unknown as Client & { __toolCalls: string[] };
}

describe("agent integration", () => {
  before(() => installTestEnv());
  after(() => restoreTestEnv());

  beforeEach(async () => {
    resetAll();
    resetDateTracking();
    setChatImplForTest(null);
    setFetchUserContextForTest(null);
    await resetAllMcpSessionsForTest();
    setMcpClientFactoryForTest(null);
  });

  it("parallel users cannot cross history in shared channel", async () => {
    const clients = new Map<string, Client>();
    setMcpClientFactoryForTest(async (userId) => {
      const tz = userId === FIXTURE_USERS.alice ? "America/New_York" : "Asia/Tokyo";
      const today = userId === FIXTURE_USERS.alice ? "2026-07-01" : "2026-07-02";
      const c = overviewClient(userId, tz, today);
      clients.set(userId, c);
      return c;
    });

    let call = 0;
    setChatImplForTest(async (messages) => {
      call++;
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      if (call === 1) {
        assert.match(system, /America\/New_York/);
        assert.match(system, /2026-07-01/);
        return { content: "alice reply" };
      }
      assert.match(system, /Asia\/Tokyo/);
      assert.match(system, /2026-07-02/);
      return { content: "bob reply" };
    });

    const [ra, rb] = await Promise.all([
      prompt("hello", FIXTURE_CHANNEL, FIXTURE_USERS.alice),
      prompt("hello", FIXTURE_CHANNEL, FIXTURE_USERS.bob),
    ]);
    assert.equal(ra, "alice reply");
    assert.equal(rb, "bob reply");

    const keyA = historyKey(FIXTURE_USERS.alice, FIXTURE_CHANNEL);
    const keyB = historyKey(FIXTURE_USERS.bob, FIXTURE_CHANNEL);
    assert.equal(load(keyA).length, 2);
    assert.equal(load(keyB).length, 2);
    assert.equal(load(keyA)[1].content, "alice reply");
    assert.equal(load(keyB)[1].content, "bob reply");
  });

  it("uses server-derived timezone in system prompt", async () => {
    setMcpClientFactoryForTest(async (userId) =>
      overviewClient(userId, "Europe/London", "2026-03-15"),
    );

    let capturedSystem = "";
    setChatImplForTest(async (messages) => {
      capturedSystem = messages.find((m) => m.role === "system")?.content ?? "";
      return { content: "ok" };
    });

    await prompt("status?", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.match(capturedSystem, /Europe\/London/);
    assert.match(capturedSystem, /2026-03-15/);
    assert.match(capturedSystem, /tick off.*planner_complete_tasks/i);
    assert.match(capturedSystem, /Never tell the user to.*session/i);
    assert.match(capturedSystem, /Remind vs add/i);
    assert.match(capturedSystem, /NO alerts/);
    assert.doesNotMatch(capturedSystem, /UTC.*from their server profile/);
  });

  it("handles malformed tool arguments without throwing", async () => {
    setMcpClientFactoryForTest(async (userId) => overviewClient(userId, "UTC", "2026-01-01"));

    let round = 0;
    setChatImplForTest(async (messages) => {
      round++;
      if (round === 1) {
        return {
          content: null,
          tool_calls: [
            {
              id: "tc1",
              type: "function",
              function: { name: "planner_find_tasks", arguments: "{not-json" },
            },
          ],
        };
      }
      const toolMsg = messages.find((m) => m.role === "tool");
      assert.ok(toolMsg);
      assert.match(String(toolMsg?.content), /invalid tool arguments JSON/i);
      return { content: "recovered" };
    });

    const out = await prompt("find tasks", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(out, "recovered");
  });

  it("reconnects and retries when a tool call reports a stale MCP session", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));

    let connections = 0;
    setMcpClientFactoryForTest(async () => {
      connections++;
      const stale = connections === 1;
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [{ name: "planner_find_tasks", inputSchema: { type: "object" } }],
        }),
        callTool: async () => {
          if (stale) {
            throw new Error("MCP error -32001: Session not found");
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  tasks: [{ task_id: "task-1", title: "Fix up the prompt" }],
                }),
              },
            ],
          };
        },
      } as unknown as Client;
    });

    setChatImplForTest(async (messages) => {
      const toolMessage = messages.find((message) => message.role === "tool");
      if (toolMessage) {
        assert.match(String(toolMessage.content), /Fix up the prompt/);
        return { content: "Completed **Fix up the prompt**." };
      }
      return {
        content: null,
        tool_calls: [
          {
            id: "find-task",
            type: "function",
            function: {
              name: "planner_find_tasks",
              arguments: JSON.stringify({ q: "fix up the prompt" }),
            },
          },
        ],
      };
    });

    const out = await prompt(
      "tick off fix up the prompt",
      FIXTURE_CHANNEL,
      FIXTURE_USERS.alice,
    );

    assert.equal(out, "Completed **Fix up the prompt**.");
    assert.equal(connections, 2);
  });

  it("retries only the failed tool call after a stale MCP session", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));

    let connections = 0;
    let completedCalls = 0;
    setMcpClientFactoryForTest(async () => {
      connections++;
      const stale = connections === 1;
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [
            { name: "planner_complete_tasks", inputSchema: { type: "object" } },
            { name: "planner_find_tasks", inputSchema: { type: "object" } },
          ],
        }),
        callTool: async ({ name }: { name: string }) => {
          if (name === "planner_complete_tasks") {
            completedCalls++;
            return { content: [{ type: "text", text: '{"completed":["task-1"]}' }] };
          }
          if (stale) {
            const error = new Error("Streamable HTTP error");
            Object.assign(error, { code: 404 });
            throw error;
          }
          return { content: [{ type: "text", text: '{"tasks":[]}' }] };
        },
      } as unknown as Client;
    });

    setChatImplForTest(async (messages) => {
      const toolMessages = messages.filter((message) => message.role === "tool");
      if (toolMessages.length === 2) return { content: "Done." };
      return {
        content: null,
        tool_calls: [
          {
            id: "complete-task",
            type: "function",
            function: {
              name: "planner_complete_tasks",
              arguments: '{"task_ids":["task-1"]}',
            },
          },
          {
            id: "refresh-tasks",
            type: "function",
            function: { name: "planner_find_tasks", arguments: '{"inbox":true}' },
          },
        ],
      };
    });

    const out = await prompt("complete and refresh", FIXTURE_CHANNEL, FIXTURE_USERS.alice);

    assert.equal(out, "Done.");
    assert.equal(connections, 2);
    assert.equal(completedCalls, 1);
  });

  it("reports a tool error without replaying mutations when reconnect stays stale", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));

    let connections = 0;
    let completedCalls = 0;
    setMcpClientFactoryForTest(async () => {
      connections++;
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [
            { name: "planner_complete_tasks", inputSchema: { type: "object" } },
            { name: "planner_find_tasks", inputSchema: { type: "object" } },
          ],
        }),
        callTool: async ({ name }: { name: string }) => {
          if (name === "planner_complete_tasks") {
            completedCalls++;
            return { content: [{ type: "text", text: '{"completed":["task-1"]}' }] };
          }
          const error = new Error("Streamable HTTP error: Session not found");
          Object.assign(error, { code: 404 });
          throw error;
        },
      } as unknown as Client;
    });

    setChatImplForTest(async (messages) => {
      const toolMessages = messages.filter((message) => message.role === "tool");
      if (toolMessages.length === 2) {
        assert.match(String(toolMessages[1]?.content), /Session not found/);
        return { content: "Completed the task, but could not refresh the list." };
      }
      return {
        content: null,
        tool_calls: [
          {
            id: "complete-task",
            type: "function",
            function: {
              name: "planner_complete_tasks",
              arguments: '{"task_ids":["task-1"]}',
            },
          },
          {
            id: "refresh-tasks",
            type: "function",
            function: { name: "planner_find_tasks", arguments: '{"inbox":true}' },
          },
        ],
      };
    });

    const out = await prompt("complete and refresh", FIXTURE_CHANNEL, FIXTURE_USERS.alice);

    assert.equal(out, "Completed the task, but could not refresh the list.");
    assert.equal(connections, 2);
    assert.equal(completedCalls, 1);
  });

  it("injects client_request_id on create tools", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));
    const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
    setMcpClientFactoryForTest(async () => {
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [{ name: "planner_create_task", inputSchema: { type: "object" } }],
        }),
        callTool: async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
          seen.push({ name, args });
          return { content: [{ type: "text", text: JSON.stringify({ task_id: "t1", title: "X" }) }] };
        },
      } as unknown as Client;
    });
    setChatImplForTest(async (messages) => {
      if (messages.some((m) => m.role === "tool")) return { content: "created" };
      return {
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "planner_create_task",
              arguments: JSON.stringify({ title: "X" }),
            },
          },
        ],
      };
    });
    const out = await prompt("add X", FIXTURE_CHANNEL, FIXTURE_USERS.alice, {
      clientRequestId: "discord:msg:99",
    });
    assert.equal(out, "created");
    assert.equal(seen[0]?.args.client_request_id, "discord:msg:99");
  });

  it("omits mutations when last mutation tool result is not JSON", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));
    setMcpClientFactoryForTest(async () => {
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [{ name: "planner_create_task", inputSchema: { type: "object" } }],
        }),
        callTool: async () => ({
          content: [{ type: "text", text: "not-json" }],
        }),
      } as unknown as Client;
    });
    setChatImplForTest(async (messages) => {
      if (messages.some((m) => m.role === "tool")) return { content: "created" };
      return {
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "planner_create_task",
              arguments: JSON.stringify({ title: "X" }),
            },
          },
        ],
      };
    });
    const out = await promptFull("add X", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(out.content, "created");
    assert.deepEqual(out.mutations, []);
  });

  it("does not replay mutating tools when the LLM times out after a successful tool call", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));

    let completedCalls = 0;
    setMcpClientFactoryForTest(async () => {
      return {
        connect: async () => {},
        close: async () => {},
        listTools: async () => ({
          tools: [
            { name: "planner_complete_tasks", inputSchema: { type: "object" } },
          ],
        }),
        callTool: async ({ name }: { name: string }) => {
          if (name === "planner_complete_tasks") {
            completedCalls++;
            return {
              content: [{ type: "text", text: '{"completed":["task-1"]}' }],
            };
          }
          return { content: [{ type: "text", text: "{}" }] };
        },
      } as unknown as Client;
    });

    setChatImplForTest(async (messages) => {
      const toolMessage = messages.find((message) => message.role === "tool");
      if (toolMessage) {
        const err = new Error("Request timed out");
        err.name = "TimeoutError";
        throw err;
      }
      return {
        content: null,
        tool_calls: [
          {
            id: "complete-task",
            type: "function",
            function: {
              name: "planner_complete_tasks",
              arguments: '{"task_ids":["task-1"]}',
            },
          },
        ],
      };
    });

    await assert.rejects(
      () => prompt("tick off task", FIXTURE_CHANNEL, FIXTURE_USERS.alice),
      (err: unknown) =>
        err instanceof Error &&
        (err.name === "TimeoutError" || /timeout/i.test(err.message)),
    );
    assert.equal(completedCalls, 1);
  });

  it("does not retry the whole prompt on unauthorized errors", async () => {
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today: "2026-01-01" }));

    let connects = 0;
    setMcpClientFactoryForTest(async () => {
      connects++;
      const err = new Error("unauthorized");
      err.name = "UnauthorizedError";
      throw err;
    });

    await assert.rejects(
      () => prompt("hi", FIXTURE_CHANNEL, FIXTURE_USERS.alice),
      (err: unknown) =>
        err instanceof Error && /unauthorized/i.test(err.message + err.name),
    );
    assert.equal(connects, 1);
  });

  it("clears history when server logical day changes", async () => {
    let today = "2026-05-01";
    setFetchUserContextForTest(async () => ({ timezone: "UTC", today }));

    setMcpClientFactoryForTest(async (userId) => overviewClient(userId, "UTC", today));
    setChatImplForTest(async () => ({ content: "day-one" }));

    const key = historyKey(FIXTURE_USERS.alice, FIXTURE_CHANNEL);
    await prompt("first", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(load(key).length, 2);

    today = "2026-05-02";
    setChatImplForTest(async () => ({ content: "day-two" }));
    await prompt("second", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    const history = load(key);
    assert.equal(history.length, 2);
    assert.equal(history[0].content, "second");
    assert.equal(history[1].content, "day-two");
  });

  it("does not date-reset history when user context is a fallback", async () => {
    setFetchUserContextForTest(async () => ({
      timezone: "UTC",
      today: "2026-05-01",
      source: "profile" as const,
    }));
    setMcpClientFactoryForTest(async (userId) =>
      overviewClient(userId, "UTC", "2026-05-01"),
    );
    setChatImplForTest(async () => ({ content: "day-one" }));

    const key = historyKey(FIXTURE_USERS.alice, FIXTURE_CHANNEL);
    await prompt("first", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    assert.equal(load(key).length, 2);

    setFetchUserContextForTest(async () => ({
      timezone: "UTC",
      today: "2026-05-02",
      source: "fallback" as const,
    }));
    setChatImplForTest(async () => ({ content: "fallback-day" }));
    await prompt("second", FIXTURE_CHANNEL, FIXTURE_USERS.alice);
    const history = load(key);
    assert.equal(history.length, 4);
    assert.equal(history[0].content, "first");
    assert.equal(history[3].content, "fallback-day");
  });
});
