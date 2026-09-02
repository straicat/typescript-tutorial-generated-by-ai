/**
 * Agent 的公共类型 —— 注意这里**没有 import openai**。
 *
 * 业务逻辑只依赖本文件定义的 `ChatClient` 接口，SDK 只出现在
 * lib/openai-client.ts 一个文件里。好处：
 *   - 离线跑（lib/fake-client.ts）和真实跑（lib/openai-client.ts）可以互换
 *   - 单元测试不需要 API key、不需要网络
 *   - 想换成 DeepSeek / Ollama / vLLM 只改 openai-client.ts 的三个参数
 *
 * 字段命名沿用 OpenAI 协议的 snake_case，这样和真实响应一一对应，转换成本为 0。
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** 模型生成的 JSON 字符串。不保证合法，不保证符合 schema。 */
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OpenAI `tools` 参数里单个函数工具的形状。 */
export interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: OpenAiFunctionTool[];
  model?: string;
  /** 传了就走流式：每收到一段文本增量就回调一次（CLI 打字机效果）。 */
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter';

export interface ChatResult {
  message: ChatMessage;
  finishReason: FinishReason;
  usage?: ChatUsage;
}

/** 整个 Agent 只依赖这一个接口。 */
export interface ChatClient {
  readonly label: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}
