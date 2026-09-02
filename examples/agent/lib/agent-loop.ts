/**
 * Agent 的心脏：tool loop（也就是 ReAct 里的「决策-执行」循环）。
 *
 *   ┌──────────────────────────────────────────┐
 *   │  messages ──► LLM ──► 有 tool_calls？    │
 *   │      ▲                   │ 有            │
 *   │      │                   ▼               │
 *   │      └── tool 消息 ◄── 并行执行工具       │
 *   └──────────────────────────────────────────┘
 *              │ 没有
 *              ▼  最终回答
 *
 * 注意 client 是**注入**进来的（ChatClient 接口），所以这个文件
 * 完全可以在没有 API key、没有网络的情况下单元测试。
 */

import { buildToolsParam, executeToolCall } from './tool-registry.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ChatClient, ChatMessage, ChatRequest, ChatUsage, ToolCall } from './types.js';

export type AgentEvent =
  | { type: 'request'; step: number; messageCount: number }
  | { type: 'text-delta'; text: string }
  | { type: 'assistant-text'; step: number; text: string }
  | { type: 'tool-call'; step: number; call: ToolCall }
  | { type: 'tool-result'; step: number; name: string; content: string }
  | { type: 'tool-denied'; step: number; name: string }
  | { type: 'usage'; step: number; usage: ChatUsage };

export interface AgentLoopOptions {
  messages: readonly ChatMessage[];
  registry: ToolRegistry;
  model?: string;
  maxSteps?: number;
  stream?: boolean;
  onEvent?: (event: AgentEvent) => void;
  /** 危险工具的人类确认钩子；返回 false 就拒绝执行并把结果告诉模型。 */
  confirm?: (call: ToolCall) => Promise<boolean>;
}

export interface AgentLoopResult {
  finalText: string;
  messages: ChatMessage[];
  steps: number;
  usage: ChatUsage;
}

export async function runAgentLoop(
  client: ChatClient,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const { registry, model, maxSteps = 6, stream = false, onEvent, confirm } = options;
  const emit = (event: AgentEvent): void => onEvent?.(event);

  // 复制一份：调用方的历史不该被我们改掉。
  const messages: ChatMessage[] = [...options.messages];
  const tools = buildToolsParam(registry);
  const usage: ChatUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let steps = 0;

  for (;;) {
    const request: ChatRequest = { messages, tools };
    if (model != null) request.model = model;
    // 只有「可能产出最终文本」时才需要流式。工具调用轮流式意义不大，
    // 但真实场景下你无法预知这一轮是哪种，所以一律开着。
    if (stream) request.onTextDelta = (text) => emit({ type: 'text-delta', text });

    emit({ type: 'request', step: steps + 1, messageCount: messages.length });
    const result = await client.chat(request);
    steps += 1;

    if (result.usage != null) {
      usage.prompt_tokens += result.usage.prompt_tokens;
      usage.completion_tokens += result.usage.completion_tokens;
      usage.total_tokens += result.usage.total_tokens;
      emit({ type: 'usage', step: steps, usage: result.usage });
    }

    messages.push(result.message);
    if (result.message.content != null && result.message.content !== '') {
      emit({ type: 'assistant-text', step: steps, text: result.message.content });
    }

    const calls = result.message.tool_calls ?? [];
    if (calls.length === 0) {
      return { finalText: result.message.content ?? '', messages, steps, usage };
    }

    if (steps >= maxSteps) {
      // 死循环保护。模型反复调同一个工具是非常常见的失败模式，
      // 没有这一行，一个 bug 能烧掉整月预算。
      throw new Error(`工具循环超过最大轮数 ${maxSteps}，已中止`);
    }

    // 并行执行。Promise.all 保证结果顺序 == 输入顺序，
    // 所以 tool 消息和 tool_calls 一一对应，不会串号。
    const replies = await Promise.all(
      calls.map(async (call): Promise<ChatMessage> => {
        emit({ type: 'tool-call', step: steps, call });

        const tool = registry[call.function.name];
        if (tool?.dangerous === true && confirm != null && !(await confirm(call))) {
          emit({ type: 'tool-denied', step: steps, name: call.function.name });
          // 拒绝也要回一条 tool 消息，否则下一次请求会因为
          // 「tool_calls 没有对应的 tool 响应」被 OpenAI 拒掉。
          return {
            role: 'tool',
            tool_call_id: call.id,
            content: '错误: 用户拒绝了这次危险操作，请改用只读方式完成任务或询问用户。',
          };
        }

        const reply = await executeToolCall(registry, call);
        emit({ type: 'tool-result', step: steps, name: call.function.name, content: reply.content ?? '' });
        return reply;
      }),
    );
    messages.push(...replies);
  }
}
