/**
 * 第 09 章参考答案 · AI Agent 实战（OpenAI SDK）
 * 每题都附带「为什么这么写 / 常见错法」的说明。
 * 注意：这里一行网络请求都没有 —— Agent 的全部逻辑都是可离线单测的纯函数 + 接口。
 */

import { z } from 'zod';
import type { ZodType } from 'zod';
import { isAbsolute, relative, resolve } from 'node:path';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
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
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage?: ChatUsage;
}

export interface ChatClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}

export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  schema: ZodType<TArgs>;
  execute: (args: TArgs) => string | Promise<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>;

export type ToolRegistry = Record<string, AnyTool>;

// ---------- 9.1 ----------
export function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  // 用展开而不是 for (i < text.length)：展开按【码点】迭代，emoji 只算 1 个。
  for (const ch of [...text]) {
    // \u4e00-\u9fff 覆盖常用汉字，够用了。真要精确请上 js-tiktoken。
    if (ch >= '\u4e00' && ch <= '\u9fff') cjk += 1;
    else rest += 1;
  }
  return cjk + Math.ceil(rest / 4);
  // 常见错法：直接 Math.ceil(text.length / 4)。对中文会严重低估
  // （一个汉字通常 1~2 个 token，而不是 0.25 个），裁剪时就会撞上下文上限。
}

// ---------- 9.2 ----------
export function redactSecrets(text: string): string {
  return (
    text
      // 1. sk- 开头的 key。{8,} 是为了别把 'sk-短' 或 'gpt-4o' 这类误伤。
      //    替换结果 'sk-***' 里的 * 不属于 [A-Za-z0-9_-]，所以天然幂等。
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
      // 2. Authorization 头。同样靠长度阈值保证 'Bearer ***' 不会被二次匹配。
      .replace(/Bearer\s+\S{8,}/g, 'Bearer ***')
      // 3. KEY=value 形式的环境变量。捕获组回填键名，值一律打掉。
      //    i 标志让 [A-Z0-9_]* 也匹配小写，所以 apiKey=xxx 也能命中。
      .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*\S+/gi, '$1=***')
  );
  // 常见错法：只匹配 'sk-\w+'。\w 不含 '-'，而 OpenAI 的
  // sk-proj-xxx 里就有 '-'，会漏掉后半段。
}

// ---------- 9.3 ----------
export function defineTool<TSchema extends ZodType>(spec: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (args: z.output<TSchema>) => string | Promise<string>;
}): Tool<z.output<TSchema>> {
  // 运行时啥也不做，全部价值在类型上：调用方写 execute 时，
  // args 已经被推导成 z.output<typeof schema>，不用手写一遍类型。
  //
  // 这里的 as 是必需的：TS 无法证明「未解析的泛型 TSchema」满足
  // ZodType<z.output<TSchema>>（泛型条件类型无法在函数体内被展开）。
  // 对调用方来说类型完全安全，只有这一行需要收敛。
  return spec as Tool<z.output<TSchema>>;
}

export function toolToOpenAiTool(tool: AnyTool): OpenAiFunctionTool {
  // io: 'input' 表示「模型要构造的输入形状」。
  // 默认的 io: 'output' 会额外注入 additionalProperties: false，
  // 而且对带 default/transform 的 schema 语义不同，工具参数一律用 input。
  const raw = z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>;
  // $schema 必须删掉：strict 模式下 OpenAI 会因为不认识这个键而 400。
  const { $schema: _ignored, ...schema } = raw;

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...schema,
        // z.object({}) 生成的 JSON Schema 里没有 properties/required 两个键，
        // 但 OpenAI strict 模式要求它们存在，必须补齐。
        properties: schema['properties'] ?? {},
        required: schema['required'] ?? [],
        additionalProperties: false,
      },
      strict: true,
    },
  };
}

export function buildToolsParam(registry: ToolRegistry): OpenAiFunctionTool[] {
  // 排序是为了让请求体可复现（便于做 prompt 缓存和 diff 调试）。
  // Object.values 的顺序取决于插入顺序，不排序会让缓存 key 不稳定。
  return Object.keys(registry)
    .sort()
    .map((name) => toolToOpenAiTool(registry[name] as AnyTool));
}

// ---------- 9.4 ----------
export async function executeToolCall(registry: ToolRegistry, call: ToolCall): Promise<ChatMessage> {
  const reply = (content: string): ChatMessage => ({
    role: 'tool',
    tool_call_id: call.id,
    content,
  });

  const tool = registry[call.function.name];
  if (tool == null) {
    // 模型偶尔会凭空发明工具名。告诉它真相比抛异常有用得多。
    return reply(`错误: 未注册的工具 "${call.function.name}"`);
  }

  const rawArgs = call.function.arguments.trim();
  let parsedJson: unknown;
  try {
    // 无参工具模型常给 '' 而不是 '{}'。
    parsedJson = rawArgs === '' ? {} : JSON.parse(rawArgs);
  } catch {
    return reply(`错误: 参数不是合法 JSON: ${call.function.arguments}`);
  }

  // safeParse 而不是 parse：我们要的是错误信息，不是异常。
  const checked = tool.schema.safeParse(parsedJson);
  if (!checked.success) {
    const detail = checked.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    // 把 zod 的报错原文回给模型，它下一轮通常能自己补上缺的字段。
    return reply(`错误: 参数校验失败: ${detail}`);
  }

  try {
    return reply(await tool.execute(checked.data));
  } catch (err) {
    // 工具自己炸了（文件不存在、命令失败……）也不能让循环挂掉。
    return reply(`错误: 工具执行失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------- 9.5 ----------
export type LooseParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseJsonLoose<T>(text: string, schema: ZodType<T>): LooseParseResult<T> {
  // 1. 先剥围栏。[\s\S] 代替 . 是因为 JS 正则默认 . 不匹配换行
  //    （没有 Java 的 DOTALL 默认开启，也可以写 s 标志）。
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;

  // 2. 再截首尾。模型爱在 JSON 前后加寒暄。
  const startObj = body.indexOf('{');
  const startArr = body.indexOf('[');
  const candidates = [startObj, startArr].filter((i) => i >= 0);
  if (candidates.length === 0) return { ok: false, error: '未找到 JSON 起始符 { 或 [' };
  const start = Math.min(...candidates);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end < start) return { ok: false, error: '未找到 JSON 结束符 } 或 ]' };

  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    return { ok: false, error: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 3. 解析成功 ≠ 数据对。JSON.parse 的结果类型是 any，必须过一遍 schema。
  const checked = schema.safeParse(value);
  if (!checked.success) {
    return {
      ok: false,
      error: `schema 校验失败: ${checked.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return { ok: true, data: checked.data };
}

// ---------- 9.6 ----------
export interface StreamToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface StreamChunk {
  delta: {
    content?: string | null;
    tool_calls?: StreamToolCallDelta[];
  };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  usage?: ChatUsage | null;
}

export function accumulateStreamDeltas(chunks: readonly StreamChunk[]): ChatResult {
  const contentParts: string[] = [];
  // Map 保序（按插入顺序），但 index 不一定按序到达，所以最后还要显式排序。
  const calls = new Map<number, ToolCall>();
  let finishReason: ChatResult['finishReason'] = 'stop';
  let usage: ChatUsage | undefined;

  for (const chunk of chunks) {
    // == null 一次挡掉 null 和 undefined；不能写 `if (chunk.delta.content)`，
    // 那样 '' 和 '0' 这种碎片会被吞掉。
    if (chunk.delta.content != null) contentParts.push(chunk.delta.content);

    for (const piece of chunk.delta.tool_calls ?? []) {
      const existing = calls.get(piece.index);
      if (existing == null) {
        calls.set(piece.index, {
          id: piece.id ?? '',
          type: 'function',
          function: { name: piece.function?.name ?? '', arguments: piece.function?.arguments ?? '' },
        });
        continue;
      }
      // id / name 只在第一个碎片出现；后续碎片只带 arguments 分片。
      // 用 `||` 而不是 `??`：这里空串就等于「没给」，正好想被覆盖掉。
      existing.id = existing.id || (piece.id ?? '');
      existing.function.name = existing.function.name || (piece.function?.name ?? '');
      existing.function.arguments += piece.function?.arguments ?? '';
    }

    if (chunk.finishReason != null) finishReason = chunk.finishReason;
    if (chunk.usage != null) usage = chunk.usage;
  }

  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);

  const message: ChatMessage = {
    role: 'assistant',
    // 一个碎片都没有 → null。OpenAI 协议里「只调工具、不说话」的
    // assistant 消息 content 就是 null，写成 '' 有些兼容服务会报错。
    content: contentParts.length === 0 ? null : contentParts.join(''),
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const result: ChatResult = { message, finishReason };
  if (usage != null) result.usage = usage;
  return result;
}

// ---------- 9.7 ----------
export function truncateMessages(messages: readonly ChatMessage[], budget: number): ChatMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const cost = (m: ChatMessage): number => estimateTokens(m.content ?? '');
  const systemCost = systems.reduce((sum, m) => sum + cost(m), 0);
  let remaining = budget - systemCost; // 可能为负：system 本身就超了，也照样保留

  // 从后往前：最近的对话最有价值。
  const kept: ChatMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const m = rest[i] as ChatMessage;
    const c = cost(m);
    if (c > remaining) break;
    remaining -= c;
    kept.unshift(m);
  }

  // 😱 孤儿 tool 消息会让 OpenAI 直接 400：
  // 'messages with role tool must be a response to a preceding message with tool_calls'
  while (kept.length > 0 && kept[0]?.role === 'tool') kept.shift();

  return [...systems, ...kept];
}

// ---------- 9.8 ----------
export interface SystemPromptOptions {
  role?: string;
  constraints?: readonly string[];
  outputFormat?: string;
}

export function buildSystemPrompt(registry: ToolRegistry, options?: SystemPromptOptions): string {
  const { role = '你是一个严谨的命令行助手。', constraints, outputFormat } = options ?? {};
  // 分段收集再 join，比一路 += 字符串更容易保证「空段整段消失」。
  const sections: string[] = [role];

  const names = Object.keys(registry).sort();
  if (names.length > 0) {
    const lines = names.map((n) => `- ${n}: ${(registry[n] as AnyTool).description}`);
    sections.push(['可用工具：', ...lines].join('\n'));
  }

  if (constraints != null && constraints.length > 0) {
    const lines = constraints.map((c, i) => `${i + 1}. ${c}`);
    sections.push(['约束：', ...lines].join('\n'));
  }

  if (outputFormat != null && outputFormat !== '') {
    sections.push(`输出格式：\n${outputFormat}`);
  }

  return sections.join('\n\n');
}

// ---------- 9.9 ----------
export interface HttpErrorLike {
  status?: number | null | undefined;
  code?: string | null | undefined;
  headers?: { get(name: string): string | null } | undefined;
}

export function shouldRetry(error: HttpErrorLike): boolean {
  // 余额不足要先判：它也是 429，但重试只会浪费时间和日志。
  if (error.code === 'insufficient_quota') return false;
  const status = error.status;
  // 连接错误 / 超时的 status 是 undefined（openai SDK 的 APIConnectionError 就是这样）。
  if (status == null) return true;
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}

export function retryAfterMs(error: HttpErrorLike, attempt: number): number {
  const readPositive = (name: string): number | null => {
    const raw = error.headers?.get(name);
    if (raw == null) return null;
    const n = Number(raw);
    // Number('Wed, 21 Oct 2015 07:28:00 GMT') 是 NaN —— HTTP 的 Retry-After
    // 也允许写日期格式，这里明确只认数字，其余回退到退避。
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const ms = readPositive('retry-after-ms');
  if (ms != null) return ms;
  const seconds = readPositive('retry-after');
  if (seconds != null) return seconds * 1000;

  // 指数退避 + 上限。真实项目还要乘一个随机抖动（jitter），
  // 否则一批并发请求会在同一毫秒同时重试，把限流再撞一次。
  // 这里为了可测试性省掉了随机数。
  return Math.min(500 * 2 ** attempt, 30_000);
}

// ---------- 9.10 ----------
export function safeResolveInsideRoot(root: string, userPath: string): string | null {
  const absRoot = resolve(root);
  const resolved = resolve(absRoot, userPath);
  const rel = relative(absRoot, resolved);

  // rel === ''        -> 就是 root 自己，允许
  // rel 以 '..' 开头  -> 跑到 root 外面了
  // isAbsolute(rel)   -> 在 Windows 上跨盘符时 relative 会返回绝对路径
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) return null;
  return resolved;
  // 常见错法：resolved.startsWith(absRoot)。
  // '/srv/application/x'.startsWith('/srv/app') === true，直接被穿透。
  // 打补丁写成 startsWith(absRoot + sep) 也行，但 root 自身会被误判为越界。
}

// ---------- 9.11 ----------
export interface UsageTracker {
  client: ChatClient;
  total: () => ChatUsage;
  calls: () => number;
}

export function withUsageTracking(inner: ChatClient): UsageTracker {
  const total: ChatUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let calls = 0;

  return {
    // ChatClient 是接口而非 class，所以「装饰」只需要一个对象字面量。
    // Java 里得写一个 DelegatingChatClient 并转发每个方法。
    client: {
      async chat(request) {
        calls += 1; // 先加：失败的请求也算「发起过」，成本统计才不会漏
        const result = await inner.chat(request);
        const u = result.usage;
        total.prompt_tokens += u?.prompt_tokens ?? 0;
        total.completion_tokens += u?.completion_tokens ?? 0;
        total.total_tokens += u?.total_tokens ?? 0;
        return result; // 原样返回，不要拷贝：调用方可能依赖引用相等
      },
    },
    // 返回浅拷贝，防止调用方把内部计数器改掉。
    total: () => ({ ...total }),
    calls: () => calls,
  };
}

// ---------- 9.12 ----------
export interface ToolLoopOptions {
  messages: readonly ChatMessage[];
  registry: ToolRegistry;
  maxSteps?: number;
  model?: string;
}

export interface ToolLoopResult {
  finalText: string;
  messages: ChatMessage[];
  steps: number;
}

export async function runToolLoop(
  client: ChatClient,
  options: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const { registry, maxSteps = 5, model } = options;
  // 复制一份：调用方传进来的历史不应该被我们改掉（尤其它可能是 readonly 常量）。
  const messages: ChatMessage[] = [...options.messages];
  const tools = buildToolsParam(registry);
  let steps = 0;

  // 用 while(true) 而不是 for (i < maxSteps)：结束条件有两个
  //（模型不再要工具 / 撞上轮数上限），写在循环体里更清楚。
  for (;;) {
    const request: ChatRequest = { messages, tools };
    if (model != null) request.model = model;

    const result = await client.chat(request);
    steps += 1;
    messages.push(result.message);

    const calls = result.message.tool_calls ?? [];
    if (calls.length === 0) {
      // content 可能是 null（模型只调工具不说话），对外统一成空串。
      return { finalText: result.message.content ?? '', messages, steps };
    }

    if (steps >= maxSteps) {
      // 死循环保护：模型反复调同一个工具是非常常见的失败模式。
      // 没有这一行，一个 bug 能烧掉整月预算。
      throw new Error(`工具循环超过最大轮数 ${maxSteps}`);
    }

    // 并行执行。Promise.all 保证结果数组顺序 == 输入顺序，
    // 所以 tool 消息和 tool_calls 一一对应，不会串号。
    const replies = await Promise.all(calls.map((call) => executeToolCall(registry, call)));
    messages.push(...replies);
  }
}
