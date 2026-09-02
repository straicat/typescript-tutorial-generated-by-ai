/**
 * 真实的 OpenAI 实现 —— 全项目**只有这个文件** import openai。
 *
 * 想换成 DeepSeek / Kimi / Qwen / vLLM / Ollama？只改三个环境变量，
 * 一行代码都不用动（它们都实现了 OpenAI 的 /chat/completions 协议）：
 *   OPENAI_BASE_URL=https://api.deepseek.com   OPENAI_API_KEY=sk-xxx  MODEL=deepseek-chat
 *   OPENAI_BASE_URL=http://localhost:11434/v1  OPENAI_API_KEY=ollama  MODEL=qwen3
 *
 * 核实过的 openai@7.8.0 API：
 *   import OpenAI, { APIError, RateLimitError, ... } from 'openai'
 *   client.chat.completions.create({ model, messages, tools, tool_choice, ... })
 *   流式：create({ ..., stream: true }) 返回 Stream<ChatCompletionChunk>，可 for await
 *   Stream 有 .controller: AbortController
 */

import OpenAI, { APIError } from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { ChatClient, ChatMessage, ChatRequest, ChatResult, FinishReason } from './types.js';

export interface OpenAiClientOptions {
  apiKey: string;
  baseURL?: string | undefined;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export function createOpenAiClient(options: OpenAiClientOptions): ChatClient {
  const { apiKey, baseURL, model, timeoutMs = 60_000, maxRetries = 2 } = options;

  const sdk = new OpenAI({
    apiKey, // ❌ 永远不要把 key 写死在代码里，从环境变量读
    ...(baseURL != null ? { baseURL } : {}),
    timeout: timeoutMs, // 默认 10 分钟，对 CLI 太长了
    maxRetries, // SDK 自带指数退避，只重试 408/409/429/5xx 和连接错误
  });

  return {
    label: `openai(${baseURL ?? 'https://api.openai.com/v1'}, ${model})`,

    async chat(request: ChatRequest): Promise<ChatResult> {
      const body = {
        model: request.model ?? model,
        messages: request.messages.map(toSdkMessage),
        ...(request.tools != null && request.tools.length > 0
          ? { tools: request.tools as ChatCompletionTool[], tool_choice: 'auto' as const }
          : {}),
        temperature: 0.2, // 工具调用场景要低温度，别让它"发挥创意"
      };

      try {
        if (request.onTextDelta == null) {
          const res = await sdk.chat.completions.create(body, { signal: request.signal });
          const choice = res.choices[0];
          if (choice == null) throw new Error('模型没有返回任何 choice');
          return {
            message: fromSdkMessage(choice.message),
            finishReason: (choice.finish_reason ?? 'stop') as FinishReason,
            ...(res.usage != null
              ? {
                  usage: {
                    prompt_tokens: res.usage.prompt_tokens,
                    completion_tokens: res.usage.completion_tokens,
                    total_tokens: res.usage.total_tokens,
                  },
                }
              : {}),
          };
        }

        // ---- 流式：边收边打印，最后把碎片合并成完整消息 ----
        const stream = await sdk.chat.completions.create(
          { ...body, stream: true, stream_options: { include_usage: true } },
          { signal: request.signal },
        );
        const chunks: ChatCompletionChunk[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
          const delta = chunk.choices[0]?.delta.content;
          if (delta != null && delta !== '') request.onTextDelta(delta);
        }
        return accumulate(chunks);
      } catch (err) {
        // 把 SDK 错误翻译成人话再抛。注意 err.name 是 'Error' 而不是类名，
        // 要判类型只能用 instanceof（或 err.constructor.name）。
        if (err instanceof APIError) {
          throw new Error(
            `模型调用失败 [${err.constructor.name}] status=${String(err.status)} code=${String(err.code)} requestID=${String(err.requestID)}: ${err.message}`,
            { cause: err },
          );
        }
        throw err;
      }
    },
  };
}

/* ---------------- 我们的最小消息类型 <-> SDK 类型 ---------------- */

/** 联合类型穷尽性检查：漏了分支编译期就报错（比 Java 的 enum switch 更强）。 */
function exhaustiveCheck(value: never): never {
  throw new Error(`未处理的分支: ${JSON.stringify(value)}`);
}

function toSdkMessage(m: ChatMessage): ChatCompletionMessageParam {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content ?? '' };
    case 'user':
      return { role: 'user', content: m.content ?? '' };
    case 'tool':
      return { role: 'tool', tool_call_id: m.tool_call_id ?? '', content: m.content ?? '' };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.tool_calls != null && m.tool_calls.length > 0 ? { tool_calls: m.tool_calls } : {}),
      };
    default:
      // 传的是 m.role 而不是 m：ChatMessage 是「一个 interface + role 联合」，
      // switch 收窄的是那个属性，对象本身不会变成 never。
      return exhaustiveCheck(m.role);
  }
}

function fromSdkMessage(m: {
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function?: { name: string; arguments: string } }>;
}): ChatMessage {
  const calls = (m.tool_calls ?? [])
    .filter((c) => c.type === 'function' && c.function != null)
    .map((c) => ({
      id: c.id,
      type: 'function' as const,
      function: { name: c.function?.name ?? '', arguments: c.function?.arguments ?? '' },
    }));
  return {
    role: 'assistant',
    content: m.content,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
}

/**
 * 合并流式碎片。一次 tool call 的 arguments 会被切成几十片，
 * id / name 只在第一片出现，靠 index 关联 —— 这是流式最容易写错的地方。
 */
function accumulate(chunks: readonly ChatCompletionChunk[]): ChatResult {
  const parts: string[] = [];
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: FinishReason = 'stop';
  let usage: ChatResult['usage'];

  for (const chunk of chunks) {
    const choice = chunk.choices[0];
    if (choice != null) {
      if (choice.delta.content != null) parts.push(choice.delta.content);
      for (const piece of choice.delta.tool_calls ?? []) {
        const cur = calls.get(piece.index) ?? { id: '', name: '', args: '' };
        cur.id = cur.id || (piece.id ?? '');
        cur.name = cur.name || (piece.function?.name ?? '');
        cur.args += piece.function?.arguments ?? '';
        calls.set(piece.index, cur);
      }
      if (choice.finish_reason != null) finishReason = choice.finish_reason as FinishReason;
    }
    if (chunk.usage != null) {
      usage = {
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      };
    }
  }

  const toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args } }));

  return {
    message: {
      role: 'assistant',
      content: parts.length === 0 ? null : parts.join(''),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    finishReason,
    ...(usage != null ? { usage } : {}),
  };
}
