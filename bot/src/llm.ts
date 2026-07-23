import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index.js";
import { config } from "./config.js";

const client = new OpenAI({
  apiKey: config.LLM_API_KEY,
  baseURL: config.LLM_BASE_URL,
  timeout: config.LLM_TIMEOUT_MS,
  maxRetries: 3,
});

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

function toOpenAIMessages(msgs: LLMMessage[]): ChatCompletionMessageParam[] {
  return msgs.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.tool_call_id!,
      } satisfies ChatCompletionMessageParam;
    }
    if (m.role === "assistant" && m.tool_calls) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.tool_calls as any,
      } satisfies ChatCompletionMessageParam;
    }
    return {
      role: m.role,
      content: m.content,
    } as ChatCompletionMessageParam;
  });
}

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export async function chat(
  messages: LLMMessage[],
  tools?: ToolInfo[],
): Promise<LLMResponse> {
  const toolDefs: ChatCompletionTool[] | undefined = tools?.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema,
    },
  }));
  const res = await client.chat.completions.create({
    model: config.LLM_MODEL,
    messages: toOpenAIMessages(messages),
    ...(toolDefs ? { tools: toolDefs } : {}),
  });
  const choice = res.choices[0]?.message;
  if (!choice) throw new Error("No LLM response");
  return {
    content: choice.content,
    tool_calls: choice.tool_calls as LLMResponse["tool_calls"],
  };
}
