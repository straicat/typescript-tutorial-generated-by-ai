/**
 * 第 09 章练习 · AI Agent 实战（OpenAI SDK）
 * =====================================================================
 * 对应文档：docs/09-ai-agent-with-openai.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch09`  或者 `pnpm vitest tests/ch09`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch09-agent.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * ⚠️ 本章**没有任何题目会发真实网络请求**。所有涉及模型的题目都通过
 *    ChatClient 接口注入假 client（依赖注入），这也是测 LLM 应用的唯一正确姿势。
 * =====================================================================
 */

import { z } from 'zod';
import type { ZodType } from 'zod';

/* =====================================================================
 * 公共类型：一个「最小 LLM 接口」
 * ---------------------------------------------------------------------
 * 注意我们**没有**直接用 openai SDK 的类型。理由见文档第 10 节：
 * 自己定义最小接口，业务代码就能脱离 SDK 单独测试、也能换成任何兼容服务。
 * 字段名沿用 OpenAI 协议的 snake_case，这样和真实响应一一对应，转换成本为 0。
 * ===================================================================== */

/** 模型发起的一次函数调用（tool call）。 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** 模型生成的 JSON 字符串。**不保证是合法 JSON，也不保证符合 schema。** */
    arguments: string;
  };
}

/** 对话中的一条消息。消息数组就是 Agent 的全部状态。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** 仅 assistant 消息可能有 */
  tool_calls?: ToolCall[];
  /** 仅 tool 消息必须有，指向它回答的那次 tool call */
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
}

export interface ChatResult {
  message: ChatMessage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage?: ChatUsage;
}

/**
 * 业务代码只依赖这一个接口，不依赖 `OpenAI` 类。
 * 真实实现包一层 SDK，测试实现返回预设脚本。
 */
export interface ChatClient {
  chat(request: ChatRequest): Promise<ChatResult>;
}

/** 一个工具：名字 + 描述（给模型看）+ zod schema（校验）+ 执行体。 */
export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  schema: ZodType<TArgs>;
  /** 返回值必须是字符串——因为它要作为 `role: 'tool'` 消息的 content 回给模型。 */
  execute: (args: TArgs) => string | Promise<string>;
}

/**
 * 擦除了参数类型的 Tool，用来放进注册表。
 * 这里必须用 `any` 而不是 `unknown`：`execute` 是逆变位置，
 * `Tool<{path: string}>` 不能赋值给 `Tool<unknown>`。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>;

/** 工具注册表：key 就是工具名。 */
export type ToolRegistry = Record<string, AnyTool>;

/* =====================================================================
 * 练习开始
 * ===================================================================== */

/**
 * 练习 9.1 ⭐ —— 粗略估算 token 数
 *
 * 真实项目用 `js-tiktoken` 精确算，但本项目没装，而且做上下文裁剪只需要
 * 一个「不会低估」的粗估函数就够了。规则：
 *   - 空串返回 0
 *   - CJK 字符（`\u4e00`-`\u9fff`）每个算 1 个 token
 *   - 其余字符按 4 个字符 ≈ 1 token，**向上取整**
 *   - 两部分相加
 *   - 按【码点】遍历（emoji 算 1 个字符，别用 .length）
 *
 * estimateTokens('')            === 0
 * estimateTokens('a')           === 1     // ceil(1/4)
 * estimateTokens('hello world') === 3     // ceil(11/4)
 * estimateTokens('你好')         === 2
 * estimateTokens('你好abcd')     === 3     // 2 + ceil(4/4)
 */
export function estimateTokens(text: string): number {
  throw new Error('TODO 9.1: 实现 estimateTokens');
}

/**
 * 练习 9.2 ⭐⭐ —— 日志脱敏
 *
 * Agent 会把整个 messages 数组打进日志，一不小心就把 API key 泄漏到
 * CI 日志 / issue 附件里。写一个脱敏函数，按顺序应用三条规则：
 *
 *   1. `sk-` 开头、后接 **8 个及以上** `[A-Za-z0-9_-]` 的串 → 整体替换为 `sk-***`
 *   2. `Bearer ` 后接 **8 个及以上**非空白字符 → 替换为 `Bearer ***`
 *   3. 形如 `XXX=value` 且键名（只含字母/数字/下划线）以 `key` / `token` /
 *      `secret` / `password` 结尾（**大小写不敏感**）→ 替换为 `键名=***`
 *
 * 要求**幂等**：redactSecrets(redactSecrets(s)) === redactSecrets(s)
 *
 * redactSecrets('用 sk-abcd1234efgh 调用')            === '用 sk-*** 调用'
 * redactSecrets('Authorization: Bearer abcdefgh1234') === 'Authorization: Bearer ***'
 * redactSecrets('OPENAI_API_KEY=xyz123')              === 'OPENAI_API_KEY=***'
 * redactSecrets('apiKey=abc123')                      === 'apiKey=***'
 * redactSecrets('sk-短')                              === 'sk-短'    // 不足 8 位不动
 * redactSecrets('model=gpt-4o-mini')                  === 'model=gpt-4o-mini'
 */
export function redactSecrets(text: string): string {
  throw new Error('TODO 9.2: 实现 redactSecrets');
}

/**
 * 练习 9.3 ⭐⭐ —— 工具定义 + zod schema 转 JSON Schema
 *
 * (a) `defineTool` 只做一件事：把传进来的对象原样返回，但**利用泛型让 execute 的
 *     参数类型从 schema 自动推导出来**。这是类型安全工具注册表的关键。
 *     实现上就是 `return spec;`，难点在签名（已经给你写好了）。
 *
 * (b) `toolToOpenAiTool` 把 Tool 转成 OpenAI `tools` 数组里的一项：
 *     - 用 `z.toJSONSchema(tool.schema, { io: 'input' })` 生成 schema
 *     - **删掉 `$schema` 字段**（OpenAI 不认，strict 模式下会报错）
 *     - 缺 `properties` 时补 `{}`，缺 `required` 时补 `[]`
 *       （zod 对 `z.object({})` 不会生成这两个字段 😱）
 *     - 强制 `additionalProperties: false`、`strict: true`
 *
 * const echo = defineTool({
 *   name: 'echo', description: '回显',
 *   schema: z.object({ text: z.string() }),
 *   execute: (args) => args.text,          // ← args 自动推导为 { text: string }
 * });
 *
 * toolToOpenAiTool(echo) 等于：
 * {
 *   type: 'function',
 *   function: {
 *     name: 'echo', description: '回显', strict: true,
 *     parameters: {
 *       type: 'object',
 *       properties: { text: { type: 'string' } },
 *       required: ['text'],
 *       additionalProperties: false,
 *     },
 *   },
 * }
 *
 * (c) `buildToolsParam` 把整个注册表转成数组，**按工具名字典序排序**（保证请求可复现）。
 */
export function defineTool<TSchema extends ZodType>(spec: {
  name: string;
  description: string;
  schema: TSchema;
  execute: (args: z.output<TSchema>) => string | Promise<string>;
}): Tool<z.output<TSchema>> {
  throw new Error('TODO 9.3a: 实现 defineTool');
}

export function toolToOpenAiTool(tool: AnyTool): OpenAiFunctionTool {
  throw new Error('TODO 9.3b: 实现 toolToOpenAiTool');
}

export function buildToolsParam(registry: ToolRegistry): OpenAiFunctionTool[] {
  throw new Error('TODO 9.3c: 实现 buildToolsParam');
}

/**
 * 练习 9.4 ⭐⭐⭐ —— 执行一次工具调用（本章最重要的一题）
 *
 * 模型给的 `arguments` 是它「猜」出来的 JSON 字符串，实战中会出现：
 * 不合法 JSON、少字段、类型错、调用不存在的工具。
 *
 * **铁律：这个函数永远不能抛异常。** 任何失败都要变成一条人类可读的
 * 错误文本，作为 `role: 'tool'` 消息回给模型，让它自己修正后重试。
 * 一抛异常，整个 Agent 就死了。
 *
 * 返回值固定是 `{ role: 'tool', tool_call_id: call.id, content: <文本> }`。
 * content 的取值按优先级：
 *   1. 工具未注册            → `错误: 未注册的工具 "<name>"`
 *   2. arguments 不是合法 JSON → `错误: 参数不是合法 JSON: <原始字符串>`
 *   3. zod 校验失败           → `错误: 参数校验失败: <path>: <message>; ...`
 *      （多个 issue 用 '; ' 连接；path 为空时写 `(root)`）
 *   4. execute 抛异常         → `错误: 工具执行失败: <error.message>`
 *   5. 成功                   → execute 的返回值原样
 *
 * 提示：空字符串的 arguments（模型对无参工具常这么干）要当成 `{}`。
 */
export function executeToolCall(registry: ToolRegistry, call: ToolCall): Promise<ChatMessage> {
  throw new Error('TODO 9.4: 实现 executeToolCall');
}

/**
 * 练习 9.5 ⭐⭐⭐ —— 从脏输出里抠出 JSON
 *
 * 不支持 `json_schema` 的模型（或你用了 `json_object` 兜底）经常返回：
 *   「好的，这是结果：\n```json\n{"a":1}\n```\n希望有帮助！」
 *
 * 实现步骤：
 *   1. 先去掉 ```json ... ``` / ``` ... ``` 围栏（只需处理第一个围栏块）
 *   2. 再截取第一个 `{` 或 `[` 到最后一个 `}` 或 `]` 之间的内容
 *   3. JSON.parse
 *   4. 用传入的 zod schema 校验
 *   任何一步失败都返回 `{ ok: false, error: <说明> }`，**不要抛异常**
 *
 * const S = z.object({ a: z.number() });
 * parseJsonLoose('```json\n{"a":1}\n```', S)     -> { ok: true, data: { a: 1 } }
 * parseJsonLoose('结果是 {"a":1} 谢谢', S)         -> { ok: true, data: { a: 1 } }
 * parseJsonLoose('{"a":"x"}', S)                 -> { ok: false, error: '...' }
 * parseJsonLoose('完全没有 json', S)              -> { ok: false, error: '...' }
 */
export type LooseParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseJsonLoose<T>(text: string, schema: ZodType<T>): LooseParseResult<T> {
  throw new Error('TODO 9.5: 实现 parseJsonLoose');
}

/**
 * 练习 9.6 ⭐⭐⭐ —— 合并流式 chunk（很实用，也最容易写错）
 *
 * 流式响应下，一次 tool call 的 `arguments` 会被切成几十个碎片分批到达，
 * `id` 和 `name` 通常只在第一个碎片里出现，靠 `index` 关联。
 * 把 chunk 数组合并成一个完整的 ChatResult：
 *
 *   - content：把所有非 null 的 delta.content 顺序拼接；
 *     **一个 content 碎片都没有时，content 必须是 null**（而不是 ''）
 *   - tool_calls：按 `index` 分组；`id`/`name` 取第一次出现的非空值，
 *     `arguments` 顺序拼接；结果按 index 升序排列；
 *     **没有任何 tool call 时不要带 tool_calls 字段**（保持 undefined）
 *   - finishReason：取最后一个非 null 的值，都没有则 'stop'
 *   - usage：取最后一个出现的 usage（通常在最末一个 chunk）
 *   - role 固定 'assistant'
 *
 * accumulateStreamDeltas([
 *   { delta: { content: 'He' } },
 *   { delta: { content: 'llo' } },
 *   { delta: {}, finishReason: 'stop' },
 * ])
 * -> { message: { role: 'assistant', content: 'Hello' }, finishReason: 'stop' }
 */
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
  throw new Error('TODO 9.6: 实现 accumulateStreamDeltas');
}

/**
 * 练习 9.7 ⭐⭐⭐ —— 上下文裁剪
 *
 * 对话越长越贵，最终会撞上上下文上限。最简单有效的策略是「保 system + 留最近 N 条」。
 * 用 estimateTokens(m.content ?? '') 作为每条消息的开销，按以下规则裁剪：
 *
 *   1. 所有 `role: 'system'` 的消息**无条件保留**（即使已经超预算）
 *   2. 剩余预算 = budget - system 总开销（可能是负数）
 *   3. 从**最后一条**非 system 消息往前累加，一旦加上某条就会超出剩余预算，
 *      就停在它之前（该条不要）
 *   4. 😱 关键坑：如果留下来的窗口**开头是 `role: 'tool'` 的消息**，必须把它
 *      （以及紧随其后的连续 tool 消息）丢掉 —— 一条 tool 消息如果找不到它对应的
 *      带 tool_calls 的 assistant 消息，OpenAI 会直接返回 400
 *   5. 返回：system 消息（原顺序）+ 窗口（原顺序），不修改入参数组
 */
export function truncateMessages(messages: readonly ChatMessage[], budget: number): ChatMessage[] {
  throw new Error('TODO 9.7: 实现 truncateMessages');
}

/**
 * 练习 9.8 ⭐⭐ —— 拼装 system prompt
 *
 * system prompt 是 Agent 最重要的「代码」。按固定模板拼装，段与段之间用
 * **一个空行**（即 '\n\n'）分隔，空的段整段省略：
 *
 *   <role>
 *
 *   可用工具：
 *   - <name>: <description>          ← 按工具名字典序，每行一个
 *
 *   约束：
 *   1. <constraint>                  ← 从 1 开始编号
 *
 *   输出格式：
 *   <outputFormat>
 *
 * role 缺省为 '你是一个严谨的命令行助手。'
 * 注册表为空 → 省略「可用工具」段；constraints 为空/未传 → 省略「约束」段；
 * outputFormat 未传 → 省略「输出格式」段。结果末尾不要有多余换行。
 */
export interface SystemPromptOptions {
  role?: string;
  constraints?: readonly string[];
  outputFormat?: string;
}

export function buildSystemPrompt(registry: ToolRegistry, options?: SystemPromptOptions): string {
  throw new Error('TODO 9.8: 实现 buildSystemPrompt');
}

/**
 * 练习 9.9 ⭐⭐ —— 重试决策
 *
 * SDK 自带 maxRetries，但一旦你把请求包进自己的队列/批处理，就得自己判断。
 * 注意入参故意定义成「结构上像 HTTP 错误」的最小接口，这样测试里可以直接
 * 造对象，不需要真的 openai 错误实例（结构化类型的好处）。
 *
 * shouldRetry 规则（按顺序判断）：
 *   1. code === 'insufficient_quota' → false（余额不足，重试一万次也没用）
 *   2. status 为 undefined/null → true（连接错误、超时，值得重试）
 *   3. status 是 408 / 409 / 429 → true
 *   4. status >= 500 → true
 *   5. 其它（含 400 / 401 / 403 / 404 / 422）→ false
 *
 * retryAfterMs 规则（按顺序）：
 *   1. `retry-after-ms` 响应头是合法非负数字 → 直接返回该毫秒数
 *   2. `retry-after` 响应头是合法非负数字（单位【秒】）→ 返回 秒 * 1000
 *   3. 否则指数退避：min(500 * 2 ** attempt, 30_000)，attempt 从 0 开始
 *
 * shouldRetry({ status: 429 })                       === true
 * shouldRetry({ status: 429, code: 'insufficient_quota' }) === false
 * shouldRetry({ status: 400 })                       === false
 * shouldRetry({})                                    === true
 * retryAfterMs({ headers: new Headers({ 'retry-after': '3' }) }, 0) === 3000
 * retryAfterMs({}, 0)  === 500
 * retryAfterMs({}, 3)  === 4000
 * retryAfterMs({}, 20) === 30000
 */
export interface HttpErrorLike {
  status?: number | null | undefined;
  code?: string | null | undefined;
  /** 结构上兼容 `Headers`，也兼容任何自己实现 get() 的对象 */
  headers?: { get(name: string): string | null } | undefined;
}

export function shouldRetry(error: HttpErrorLike): boolean {
  throw new Error('TODO 9.9a: 实现 shouldRetry');
}

export function retryAfterMs(error: HttpErrorLike, attempt: number): number {
  throw new Error('TODO 9.9b: 实现 retryAfterMs');
}

/**
 * 练习 9.10 ⭐⭐⭐ —— 路径穿越防护（安全题）
 *
 * 只要你给 Agent 一个 readFile 工具，模型（或提示注入）就一定会尝试
 * `../../../etc/passwd`。把用户/模型给的路径限制在 root 目录内：
 *
 *   - 合法 → 返回 `path.resolve` 后的绝对路径
 *   - 越界 → 返回 null
 *   - root 自身算合法
 *
 * 😱 关键坑：**不能用 `resolved.startsWith(root)` 判断**，
 * 因为 '/srv/application/x'.startsWith('/srv/app') === true。
 * 正确做法是用 `path.relative(root, resolved)`。
 *
 * safeResolveInsideRoot('/srv/app', 'a/b.txt')        === '/srv/app/a/b.txt'
 * safeResolveInsideRoot('/srv/app', './x')            === '/srv/app/x'
 * safeResolveInsideRoot('/srv/app', '.')              === '/srv/app'
 * safeResolveInsideRoot('/srv/app', '/srv/app/ok')    === '/srv/app/ok'
 * safeResolveInsideRoot('/srv/app', '../etc/passwd')  === null
 * safeResolveInsideRoot('/srv/app', '/etc/passwd')    === null
 * safeResolveInsideRoot('/srv/app', '/srv/application/x') === null   // 前缀坑
 * safeResolveInsideRoot('/srv/app', 'a/../../b')      === null
 */
export function safeResolveInsideRoot(root: string, userPath: string): string | null {
  throw new Error('TODO 9.10: 实现 safeResolveInsideRoot');
}

/**
 * 练习 9.11 ⭐⭐⭐ —— 用装饰器模式统计 token 用量
 *
 * 「LLM 花了多少钱」必须能随时查到。给任意 ChatClient 包一层，累计 usage。
 * 因为 ChatClient 是接口而不是 class，装饰它只需要一个对象字面量 —— 这比
 * Java 写一个 DelegatingClient 类爽得多。
 *
 * 要求：
 *   - `total()` 初始为 { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
 *   - 每次成功调用把 result.usage 累加进去（result.usage 缺失时按 0 算）
 *   - `calls()` 返回**发起过的请求数**（包括最终抛异常的那次也要计入）
 *   - 原样返回内层 client 的 ChatResult（不要复制、不要改字段）
 *   - 内层抛异常要原样透传
 */
export interface UsageTracker {
  client: ChatClient;
  total: () => ChatUsage;
  calls: () => number;
}

export function withUsageTracking(inner: ChatClient): UsageTracker {
  throw new Error('TODO 9.11: 实现 withUsageTracking');
}

/**
 * 练习 9.12 ⭐⭐⭐ —— 综合题：完整的 tool loop（Agent 的心脏）
 *
 * 循环逻辑：
 *   1. 带上 `buildToolsParam(registry)` 请求模型，steps + 1
 *   2. 把返回的 assistant 消息追加到消息数组
 *   3. 如果它**没有** tool_calls（或数组为空）→ 结束，
 *      finalText = message.content ?? ''
 *   4. 否则**并行**执行所有 tool_calls（用 Promise.all，结果顺序必须和
 *      tool_calls 顺序一致），把每条 tool 消息按序追加，回到第 1 步
 *   5. 已经请求了 maxSteps 轮，模型**还在**要求调用工具 → 抛
 *      `new Error('工具循环超过最大轮数 <maxSteps>')`
 *
 * 其它要求：
 *   - maxSteps 缺省 5
 *   - 不修改传入的 options.messages（返回的 messages 是新数组，包含初始消息）
 *   - 每次请求都要把 model 透传下去
 *   - 工具失败不中断循环（executeToolCall 已经保证不抛）
 */
export interface ToolLoopOptions {
  messages: readonly ChatMessage[];
  registry: ToolRegistry;
  maxSteps?: number;
  model?: string;
}

export interface ToolLoopResult {
  finalText: string;
  /** 完整轨迹：初始消息 + 每轮的 assistant 消息 + tool 消息 */
  messages: ChatMessage[];
  /** 实际向模型发了几次请求 */
  steps: number;
}

export function runToolLoop(client: ChatClient, options: ToolLoopOptions): Promise<ToolLoopResult> {
  throw new Error('TODO 9.12: 实现 runToolLoop');
}
