/** Explicit test env — never read production .env secrets in tests. */
export const TEST_ENV: Record<string, string> = {
  DISCORD_BOT_TOKEN: "test-discord-token",
  LLM_API_KEY: "test-llm-key",
  AUTHORIZED_USER_IDS: "111111111111111111,222222222222222222",
  BOT_API_SECRET: "test-bot-secret",
  API_BASE_URL: "http://127.0.0.1:8000",
  MCP_URL: "http://127.0.0.1:8000/mcp/mcp",
  TIMEZONE: "UTC",
  LLM_BASE_URL: "https://api.example.com/v1",
  LLM_MODEL: "test-model",
  BOT_READY_PATH: "/tmp/structured-bot-ready-test",
};

const savedEnv = new Map<string, string | undefined>();

export function installTestEnv(overrides: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...overrides })) {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
}

export function restoreTestEnv(): void {
  for (const [key, value] of savedEnv.entries()) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
}

export const FIXTURE_USERS = {
  alice: "111111111111111111",
  bob: "222222222222222222",
  stranger: "999999999999999999",
} as const;

export const FIXTURE_CHANNEL = "channel-shared-001";
