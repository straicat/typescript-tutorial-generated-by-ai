# 09 · AI Agent 实战：LLM + 工具 + 循环 + 状态

> 用官方 `openai` SDK 从零写一个**能调工具、能自我纠错、能离线测试**的 Agent。
>
> 最重要的话先说：**Agent 不是新范式，它就是一个 while 循环** —— 把消息发给模型、看它想调
> 什么工具、执行工具、把结果塞回消息数组。剩下 90% 的工程量都在「模型会给你脏数据」和
> 「怎么不把钱烧光」上。本章所有代码都不需要 API key：`examples/agent/` 自带离线假 client。

---

## 差异清单

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 工具参数 schema | LangChain4j 注解 + 反射 / Go 手写 JSON Schema | **zod 一份 schema：校验 + 生成 JSON Schema + 推导参数类型** | 🟢 低 |
| 模型给的参数 | 以为反序列化成功就安全 | `JSON.parse` 成功 ≠ 数据合法，**必须 `safeParse`** | 🔴 高 |
| 工具执行失败 | 抛异常往上传 | **不能抛！要把错误文本回给模型让它自己改** | 🔴 高 |
| 流式 tool_calls | —— | **arguments 被切成几十个碎片，靠 `index` 拼** | 🔴 高 |
| 循环终止 | —— | 必须有 `maxSteps`，否则模型能自己转到你破产 | 🔴 高 |
| 结构化输出 | Jackson 反序列化 | `strict: true` 的 JSON Schema，**不支持 `.optional()`**（要 `.nullable()`） | 🔴 高 |
| 错误类型 | `catch (RateLimitException e)` | `err instanceof RateLimitError`；**`err.name` 是 `'Error'` 不是类名** | 🟡 中 |
| 换模型厂商 | 换 SDK / 换依赖 | **只改 `baseURL` + `apiKey` + 模型名** | 🟢 低 |
| 测试 | Mockito mock SDK 类 | **定义自己的最小接口 + 依赖注入**，别 mock SDK | 🟡 中 |
| 密钥 | 配置中心 | `process.env`，Node 20.6+ 用 `--env-file`，不用 dotenv | 🟡 中 |

**为什么 TS 写 Agent 特别顺**：① zod 一体化（一份 schema 干三件事；Java 要注解 + POJO 写两遍，
Go 基本手搓 `map[string]any`）；② 各家官方 SDK 和 MCP 参考实现都是 TS 一等公民；③ CLI/流式是
Node 的主场。Java 侧有成熟的 **LangChain4j / Spring AI**（适合嵌进现有 Spring 服务），Go 生态
偏薄；Agent 若是**独立 CLI/工具**，TS 最省力。

---

## 1. SDK 基础与密钥

```ts
import OpenAI from 'openai';          // 本项目已装 openai@7.8.0 + zod@4.5.4

const MODEL = process.env['MODEL'] ?? 'gpt-4o-mini';  // 模型名变得快，只从环境变量读
const client = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'],   // ✅ 不传时 SDK 也会自己读这个环境变量
  baseURL: process.env['OPENAI_BASE_URL'], // 换厂商就改这个（默认 https://api.openai.com/v1）
  timeout: 60_000,                         // 😱 默认 10 分钟，对 CLI 等于卡死
  maxRetries: 2,                           // 默认 2，SDK 自带指数退避
});
```

🔴 **永远不要把 key 写进代码**或会被提交的配置 —— 泄漏的 key 几分钟内就会被扫到并跑满额度。
`.env` 用 **Node 20.6+ 内置的 `--env-file`，不需要 `dotenv`**：
`node --env-file=.env --import tsx examples/agent/main.ts "…"`。

### 兼容 OpenAI 协议的服务：改三个变量就能换

DeepSeek、Kimi、Qwen、vLLM、Ollama 都实现了 `/chat/completions`，**同一份代码一行不用改**，
只改 `OPENAI_BASE_URL` + `OPENAI_API_KEY` + `MODEL`：

| 服务 | `OPENAI_BASE_URL` | `MODEL` 示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Qwen（百炼） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama / vLLM（本地） | `http://localhost:11434/v1` · `http://localhost:8000/v1` | `qwen3` · `Qwen/Qwen3-8B` |

⚠️ 差异集中在 `strict` 结构化输出和并行 tool calls 的支持程度。莫名 400 先关掉 `strict` 试。

---

## 2. 第一个请求

```ts
const res = await client.chat.completions.create({
  model: MODEL,
  messages: [
    { role: 'system', content: '你是一个简洁的命令行助手。' },
    { role: 'user', content: '一句话解释什么是事件循环' },
  ],
  temperature: 0.2,   // 0~2；工具调用/信息抽取用 0~0.3，创意写作才调高
  max_tokens: 512,    // 输出上限，控成本第一道闸
});
const message = res.choices[0]?.message;   // ⚠️ noUncheckedIndexedAccess：这里是 | undefined
console.log(message?.content, res.usage);  // usage: { prompt_tokens, completion_tokens, … }
```

四个角色：`system`（人格/工具说明/约束/输出格式，**Agent 最重要的"代码"**）、`user`、
`assistant`（回答，或 `content: null` + `tool_calls`）、`tool`（工具结果，必须带 `tool_call_id`
指回那次调用）。`finish_reason` 一定要判：`stop` → 用 `content`；
`tool_calls` → 执行工具继续循环；`length` 撞 `max_tokens` **被截断**（😱 `content` 是残的，
JSON 必然解析失败）；`content_filter` 被安全策略拦（换 prompt，别重试）。

> openai@7 里也有新一代的 **Responses API**（`client.responses.create() / .parse() / .stream()`，
> 内置会话状态与工具）。**本章用 Chat Completions**：所有兼容服务只实现它，概念完全一样。

---

## 3. 流式输出

CLI 体验的关键：让字立刻往外冒，而不是干等 20 秒。

```ts
const stream = await client.chat.completions.create(
  { model: MODEL, messages, stream: true, stream_options: { include_usage: true } },
  { signal: ac.signal },   // ac 是你自己的 AbortController
);
const parts: string[] = [];
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta.content;
  if (delta != null && delta !== '') {                  // ✅ 不能写 if (delta)，'0' 会被吞
    parts.push(delta);
    process.stdout.write(delta);                        // 边收边打印
  }
  if (chunk.usage != null) console.error(chunk.usage);  // usage 只在最后一个 chunk 上
}
const full = parts.join('');   // 流式下想拿完整消息只能自己拼
```

三个坑：① **取消**用 `ac.abort()` 或 `stream.controller.abort()`，提前 `break` 出 `for await`
也会自动 abort 底层请求；② 开了 `include_usage` 时**最后一个 chunk 的 `choices` 是空数组**；
③ 🔴 **`tool_calls` 也是流式的，分片规则很别扭** —— `id` 和 `function.name` 只在第一个碎片出现，
`arguments` 被切成几十片靠 `index` 关联，碎片形状是 `{ index: number; id?: string;
function?: { name?: string; arguments?: string } }`。完整合并见练习 9.6 和 `lib/openai-client.ts`。

> SDK 也提供 `client.chat.completions.stream()`（带 `.finalMessage()` / `.totalUsage()` /
> `.abort()` / `.on('content', …)`），省事但绑得更紧；手写 `for await` 是为了看清协议。

---

## 4. ⭐ Function Calling：本章核心

### 4.1 `tools` 参数与 `tool_choice`

```ts
const tools = [{ type: 'function', function: {
  name: 'read_file',                        // a-zA-Z0-9_- ，≤64 字符
  description: '读取工作目录内的文本文件',     // 👈 给模型看的文档，写含糊它就调错
  parameters: { type: 'object',              // 标准 JSON Schema
    properties: { path: { type: 'string', description: '相对路径' } },
    required: ['path'], additionalProperties: false },
  strict: true,                              // 严格按 schema 生成，强烈建议开
} }];
```
`tool_choice`：`'auto'`（有 tools 时默认）/ `'none'` / `'required'`（必须调至少一个）/
`{ type: 'function', function: { name: 'read_file' } }`（强制指定）。

### 4.2 用 zod 生成 JSON Schema

手写 JSON Schema 又长又容易和实际校验逻辑对不上。两条路都实测可用：

```ts
// 路线 A：SDK helper（推荐，一步到位）
import { zodFunction, zodResponseFormat, zodTextFormat } from 'openai/helpers/zod';
const tool = zodFunction({
  name: 'read_file',
  description: '读取工作目录内的文本文件',
  parameters: z.object({ path: z.string(), maxBytes: z.number().int().nullable() }),
});
// => { type:'function', function:{ name, description, strict:true, parameters:{…} } }
// 直接丢进 tools 数组；还能配合 client.chat.completions.runTools() 自动跑循环

// 路线 B：自己转（想完全掌控、或不想被 helper 的强校验卡住）
const raw = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
const { $schema: _drop, ...rest } = raw;  // 😱 $schema 必须删，OpenAI 不认识它会 400
const parameters = { ...rest, additionalProperties: false,
  properties: rest['properties'] ?? {},    // 😱 z.object({}) 不生成这两个键，
  required: rest['required'] ?? [] };      //    但 strict 模式要求它们存在
```

🔴 **`strict: true` 最大的陷阱：不支持 `.optional()`，必须 `.nullable()`**
（Structured Outputs 要求所有字段都出现在 `required` 里）。`zodFunction` 会直接抛错
``Schema field at `properties/maxBytes` uses `.optional()` without `.nullable()``。
所以工具 schema 一律写 `.nullable()`，让模型显式传 `null`。

### 4.3 类型安全的工具注册表

```ts
export interface Tool<TArgs = unknown> {
  name: string;
  description: string;
  schema: ZodType<TArgs>;
  execute: (args: TArgs) => string | Promise<string>;   // 返回值必须是字符串
  dangerous?: boolean;
}
// `any` 不是偷懒：execute 在逆变位置，Tool<{path:string}> 不能赋给 Tool<unknown>
export type ToolRegistry = Record<string, Tool<any>>;
export function defineTool<TSchema extends ZodType>(spec: {
  name: string; description: string; schema: TSchema;
  execute: (args: z.output<TSchema>) => string | Promise<string>;   // 👈 关键
}): Tool<z.output<TSchema>> { return spec as Tool<z.output<TSchema>>; }
```

用起来 `execute` 的参数**一个标注都不用写**，自动推导成 `{ path: string; maxBytes: number | null }`。
**一份 schema，三种用途**：生成 JSON Schema、运行时校验、推导 `execute` 参数类型。

### 4.4 执行工具：三条铁律

```ts
async function executeToolCall(registry: ToolRegistry, call: ToolCall): Promise<ChatMessage> {
  const reply = (content: string) => ({ role: 'tool' as const, tool_call_id: call.id, content });
  const tool = registry[call.function.name];
  if (tool == null) return reply(`错误: 未注册的工具 "${call.function.name}"`);  // 它会发明工具名

  let json: unknown;
  try {
    const raw = call.function.arguments.trim();
    json = raw === '' ? {} : JSON.parse(raw);   // 无参工具模型常给 '' 而不是 '{}'
  } catch { return reply(`错误: 参数不是合法 JSON: ${call.function.arguments}`); }
  const checked = tool.schema.safeParse(json);  // ✅ safeParse，不是 parse
  if (!checked.success) {
    const detail = checked.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    return reply(`错误: 参数校验失败: ${detail}。请按 schema 重新调用。`);  // 原文回给模型
  }
  try {
    return reply(await tool.execute(checked.data));
  } catch (err) {
    return reply(`错误: 工具执行失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}  // 三个 return 分支的错误文本都是给【模型】看的，所以要写得像人话
```

1. 🔴 **必须校验参数。** 模型会给漏字段、类型错、纯属幻觉的参数。开 `strict` 只是"大概率对"。
2. 🔴 **永远不抛异常。** 失败一律变成 `role: 'tool'` 文本回给模型 —— 它下一轮通常能自己改对
   （这就是"自愈"）。抛一次异常整个 Agent 就死了。
3. 🔴 **每个 `tool_call` 都必须有对应的 `tool` 消息**，少一条下次请求直接 400；
   连"用户拒绝执行"也要回一条说明。

### 4.5 完整的 tool loop

```ts
for (;;) {
  const result = await client.chat({ messages, tools });
  steps += 1;
  messages.push(result.message);
  const calls = result.message.tool_calls ?? [];
  if (calls.length === 0) return result.message.content ?? '';   // 不调工具了 -> 结束
  if (steps >= maxSteps) throw new Error(`工具循环超过最大轮数 ${maxSteps}`);  // 🔴 破产保护
  // 并行执行；Promise.all 保证结果顺序 == 输入顺序，所以 tool 消息不会串号
  messages.push(...(await Promise.all(calls.map((c) => executeToolCall(registry, c)))));
}
```

`maxSteps` 不是可选项。「模型反复调同一个工具」是最常见的失败模式，
没有这一行，一个 bug 能在一夜之间烧掉整月预算。

---

## 5. 结构化输出

```ts
import { zodResponseFormat } from 'openai/helpers/zod';
const Verdict = z.object({ level: z.enum(['low', 'high']), reason: z.string() });

const res = await client.chat.completions.parse({           // 注意是 .parse 不是 .create
  model: MODEL, messages,
  response_format: zodResponseFormat(Verdict, 'verdict'),   // 签名：(schema, name, props?)
});
const parsed = res.choices[0]?.message.parsed;    // ✅ 类型是 Verdict | null，已校验过
const refusal = res.choices[0]?.message.refusal;  // 模型拒答时这里有文本，parsed 是 null
```

它实际生成的是 `{ type:'json_schema', json_schema:{ name, strict:true, schema:{…} } }`，手写就
照这个形状（`create()` 也接受，只是不会自动 `.parsed`）。**strict 模式的限制**：不支持
`.optional()`（用 `.nullable()`）；所有字段必须在 `required` 里；`additionalProperties` 必须
`false`；顶层必须是 object；正则、`minimum/maximum`、复杂 `union` 可能被服务端拒绝。

**兜底方案**（模型/服务不支持 `json_schema` 时）：用 `response_format: { type: 'json_object' }`
（只保证合法 JSON，⚠️ prompt 里必须出现 "JSON" 字样），然后自己抠 JSON + zod 校验 + 失败重试
（练习 9.5 就是这题：要处理 ` ```json ` 围栏、前后寒暄、被 `length` 截断）。Responses API 侧
对应 `zodTextFormat(schema, name)` 传给 `text.format`。

---

## 6. 对话状态与上下文管理

**消息数组就是全部状态**，没有别的，所以持久化就是
`writeFile('session.json', JSON.stringify(messages))`。反过来读的时候
✅ **一定要过一遍 zod**（`SessionSchema.parse(JSON.parse(text))`）——
磁盘上的旧格式文件是最常见的运行时炸点。

上下文越用越长（越贵越慢，最终撞上限）。三种策略：**截断**（保 system + 留最近 N 轮，
大多数 CLI 场景够用）、**滚动摘要**（把老消息压成 summary 插在 system 后，适合长对话）、
**外部检索**（老内容存起来，需要时当工具查回来，适合知识库型 Agent）。截断有个 🔴 **必踩的坑**：
窗口开头**不能是孤儿 `tool` 消息** —— 一条 `role: 'tool'` 找不到对应的带 `tool_calls` 的
assistant 消息，OpenAI 直接 400（练习 9.7 专考这个）。

token 估算精确要用 `js-tiktoken`（本项目没装）；做裁剪只需要一个**不低估**的粗估：

```ts
// 英文 ≈ 4 字符/token，中文 ≈ 1 token/字。直接 length/4 会把中文严重低估
function estimateTokens(text: string): number {
  let cjk = 0, rest = 0;
  for (const ch of [...text]) (ch >= '\u4e00' && ch <= '\u9fff') ? cjk++ : rest++;
  return cjk + Math.ceil(rest / 4);   // 宁可高估，不能低估
}
```

---

## 7. 工程化关注点

### 错误处理

错误类全部从**包根**导入（`import { APIError, RateLimitError, APIConnectionError,
AuthenticationError, BadRequestError } from 'openai'`）。`APIError` 是基类，常见对应关系：
`400 BadRequestError`（schema 不合法、消息序列不对 —— 孤儿 tool 消息！）、
`401/403 AuthenticationError / PermissionDeniedError`、`404 NotFoundError`（模型名拼错）、
`429 RateLimitError`（限流，或 `code === 'insufficient_quota'` 余额不足）、
`≥500 InternalServerError`、`APIConnectionError`（连不上，`status` 是 `undefined`；
超时是其子类 `APIConnectionTimeoutError`）。

```ts
catch (err) {
  if (err instanceof APIError) {
    err.status;      // number | undefined（连接错误时是 undefined）
    err.code;        // 服务端错误码，如 'insufficient_quota'
    err.requestID;   // 来自 x-request-id，报障必带；err.headers 是 Headers 对象
  }  // 😱 err.name 是 'Error' 不是类名！判类型只能 instanceof（或 err.constructor.name）
}
```

### 重试

SDK 内置 `maxRetries: 2`，自动重试**连接错误、408、409、429、≥500**，带指数退避。什么时候要
自己再包一层（配合[第 06 章](./06-async.md)的 `retry`）？① 想尊重服务端的 `retry-after` 头；
② 想让**整个 Agent 循环**可重试；③ 想区分「限流」和「余额不足」——后者重试一万次也没用。

```ts
function shouldRetry(err: HttpErrorLike): boolean {
  if (err.code === 'insufficient_quota') return false;   // 余额不足，先判这个
  if (err.status == null) return true;                   // 连接错误/超时
  if (err.status === 408 || err.status === 409 || err.status === 429) return true;
  return err.status >= 500;
}
function retryAfterMs(err: HttpErrorLike, attempt: number): number {
  const ms = Number(err.headers?.get('retry-after-ms'));
  if (Number.isFinite(ms)) return ms;
  const s = Number(err.headers?.get('retry-after'));   // ⚠️ 也可能是 HTTP 日期，那就是 NaN
  return Number.isFinite(s) ? s * 1000 : Math.min(500 * 2 ** attempt, 30_000);  // 生产还要加抖动
}
```

**没有抖动（jitter）的退避在并发场景等于自杀**：一批请求会在同一毫秒同时重试，
把限流再撞一次。练习 9.9 为了可测试省掉了随机数，生产请加上。

### 限流、成本、可观测性

- **并发上限**：批量处理复用[第 06 章](./06-async.md)的并发池（2~5 就够，再高必被 429）。
- **成本累计**：把 `usage` 累加起来随时可查。装饰 `ChatClient` 只要一个对象字面量（练习 9.11），
  比 Java 写 `DelegatingClient` 类爽得多。**本地缓存**：开发期用
  `hash(model + messages + tools)` 当 key 存到 `.cache/*.json`，调 prompt 能省 90% 的钱。
- **结构化日志走 stderr**（stdout 留给结果，见[第 01 章](./01-basics.md)）：
  `console.error(JSON.stringify({ evt:'llm_call', step, tokens, ms }))`；并**把每轮完整 messages
  落盘**（`--json`）—— 调 Agent 时 99% 的问题看一眼实际请求就明白了。
- 🔴 **落盘前脱敏**：`sk-` key、`Bearer` 头、`*_KEY=` 环境变量（练习 9.2）。CI 日志和 issue
  附件是密钥泄漏头号渠道。
- **幂等**：会写数据的工具带上 request id，模型重试同一调用时别写两遍。
- **超时**：`timeout` 一定要设（默认 10 分钟），CLI 里 30~60 秒合适。

---

## 8. ReAct 循环与 Agent 架构

```
感知 Perceive  messages（system + 历史 + 工具结果）
      ↓
决策 Decide    LLM 一次请求
      ↓
   有 tool_calls ？ ──否──► 输出最终回答，退出循环
      │是
      ↓
执行 Act       并行跑工具 ──► 结果作为 tool 消息追加 ──► 回到「感知」
```

这就是 **ReAct**（Reasoning + Acting）的全部，不需要框架。

**system prompt 四段式**（见练习 9.8 的 `buildSystemPrompt`）：① **角色**「你是一个运行在命令行
里的助手，通过调用工具来回答关于本地文件的问题」；② **能力**逐条列出 `- read_file: 读取…`
（`tools` 参数已经告诉它了，但写上能显著减少乱调）；③ **约束（最重要）**「只能通过工具获取信息，
不要凭记忆编造」「工具返回以『错误:』开头时，读懂原因后修正参数重试，不要重复同样的错误调用」
「危险操作会需要用户确认，被拒绝就换只读方案」；④ **输出格式**「用简洁中文回答，不要输出 JSON」。

**人类确认**：会改变世界的工具（写文件、发请求、执行命令）标 `dangerous: true`：

```ts
if (tool?.dangerous === true && !(await confirm(call))) {
  // 拒绝也要回一条 tool 消息，否则下次请求 400
  return { role: 'tool', tool_call_id: call.id, content: '错误: 用户拒绝了这次危险操作' };
}  // CI 里用 --yes 放行；stdin 不是 TTY 时默认拒绝（宁可少做不要做错）
```

**何时上 multi-agent**：单 Agent 工具超过 ~15 个、system prompt 超过几百行、
或子任务需要完全不同的约束时，再拆成「主 Agent 通过工具调用子 Agent」。
在此之前，打磨工具描述比拆架构有用得多。

---

## 9. 测试 LLM 应用

**核心原则：不要 mock SDK，而是定义自己的最小接口并注入。**

```ts
// ✅ 业务代码只依赖这个，不依赖 openai 的任何类型
export interface ChatClient { chat(request: ChatRequest): Promise<ChatResult>; }

// 假 client 按脚本返回，可以断言「调了几轮」「调了哪些工具」「最终答案」
function fakeClient(script: ChatResult[]): ChatClient { /* … */ }

// 需要断言调用参数时用 vi.fn()
const inner = { chat: vi.fn<ChatClient['chat']>().mockResolvedValue(result) };
expect(inner.chat).toHaveBeenLastCalledWith({ messages: [...], tools: [...] });
```

好处：① 测试不需要 key/网络，也不需要 `vi.mock('openai')` 那种脆弱魔法；② SDK 升级改字段名只有
`openai-client.ts` 一个文件要动；③ 换厂商/换协议（Anthropic、MCP）只需再写一个实现。
其它手法：**录制 fixture**（跑一次真实请求，把响应 JSON 存进 `tests/fixtures/` 当回归基线）；
**纯函数优先**（`accumulateStreamDeltas` / `truncateMessages` / `parseJsonLoose` 都是纯函数，
可穷举边界 —— 这也是本章练习的主体）；**评测（eval）**（准备一组「输入 → 期望性质」样例批量
打分，把 prompt 改动当代码改动来 review，见[第 10 章](./10-testing-and-quality.md)）。

---

## 10. 生态导航（先掌握底层，再上框架）

| 库 | 什么时候上 |
| --- | --- |
| `ai`（Vercel AI SDK） | 需要**同时**支持 OpenAI / Anthropic / Gemini，想要统一的流式与工具抽象 |
| `@modelcontextprotocol/sdk` | 把工具做成**标准协议服务**，让 Claude Desktop / Cursor / 自己的 Agent 都能用 |
| `langchain` / `langgraph` | 需要复杂编排：分支、并行子图、检查点、人类介入节点 |
| `js-tiktoken` | 需要精确 token 计数（计费、精细裁剪） |

本章只用官方 SDK，是为了让你先看清协议本身。这些框架解决的是「循环之上」的问题，而循环里的坑
（参数校验、错误回喂、流式分片、上下文裁剪、成本控制）不会因为换框架而消失。

---

## 完整示例

`examples/agent/` 是一个能真正跑起来的 CLI Agent，**不需要 API key**：

```bash
pnpm agent --dry-run "列出当前目录并读取 package.json 的 name"
```

无 `OPENAI_API_KEY` 或带 `--dry-run` 时自动切到离线假 client，你会看到完整的 5 轮工具调用轨迹，
其中包含**参数校验失败**和**路径穿越被拦**两次自愈。真实输出、危险工具确认演示、换 DeepSeek /
Ollama 的方法都在 [examples/agent/README.md](../examples/agent/README.md)。

---

## 本章练习

```bash
pnpm test tests/ch09     # 打开 exercises/ch09-agent.ts 填掉所有 TODO；卡住了看 solutions/
```

练习覆盖：token 估算与上下文裁剪、日志脱敏、`defineTool` 泛型推导、zod → JSON Schema、
**工具参数校验与错误回喂**、脏 JSON 提取、**流式 tool_calls 分片合并**、system prompt 拼装、
重试决策与 `retry-after`、**路径穿越防护**、用量统计装饰器，以及综合题 —— **完整的 tool loop**。
全部离线可测，一行网络请求都不发。

---

**下一章** → [10 · 测试与质量保障：vitest 与工程护栏](./10-testing-and-quality.md)
