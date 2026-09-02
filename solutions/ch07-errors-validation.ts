/**
 * 第 07 章参考答案 · 错误处理与数据校验
 * 每题都附带「为什么这么写 / 常见错法是什么」的说明，看的时候重点看注释。
 *
 * 本文件所有 zod API 均在 zod@4.5.4 上实测过（v4 和 v3 差异不小，注意注释里的提示）。
 */

import { z } from 'zod';

// ---------- 7.1 ----------
export function toError(value: unknown): Error {
  // ✅ 已经是 Error 就原样返回：不要 new 一个新的，否则原始的 stack 就丢了。
  if (value instanceof Error) return value;
  // 把原始值挂到 cause 上，这样即使 message 不够用，调试时还能拿回原对象。
  return new Error(describeThrown(value), { cause: value });
}

/** 只在本文件内用的小工具，不导出 */
function describeThrown(value: unknown): string {
  if (typeof value === 'string') return value;

  if (typeof value === 'object' && value !== null) {
    // 跨进程 / 结构化克隆之后 Error 会退化成普通对象，但 message 通常还在。
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
    try {
      // 😱 JSON.stringify 遇到循环引用、BigInt 会抛，所以必须包 try。
      // 另外它对 undefined / symbol 返回 undefined，用 ?? 兜一下。
      return JSON.stringify(value) ?? String(value);
    } catch {
      return '[unserializable value]';
    }
  }

  // number / boolean / bigint / symbol / null / undefined
  // String() 对这些全都安全（注意：`${sym}` 会抛，String(sym) 不会）。
  return String(value);
}

// ---------- 7.2 ----------
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    // ✅ 必须把 options 透传给 super，否则 { cause } 会被吞掉，错误链断在这里。
    super(message, options);
    // ✅ new.target 指向"实际被 new 的那个类"，所以子类自动拿到自己的类名，
    //    不用每个子类都写一遍 this.name = 'XxxError'。
    //    常见错法：完全不设 name —— 那么 String(err) 永远是 'Error: ...'。
    this.name = new.target.name;
    this.code = code;
    // 注：本项目 target 是 ES2023，class 是原生的，
    // **不需要** `Object.setPrototypeOf(this, AppError.prototype)`（那是 target ES5 时代的补丁）。
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('E_CONFIG', message, options);
  }
}

// ---------- 7.3 ----------
export function getRootCause(error: Error): Error {
  let current: Error = error;
  // 用 Set 记录走过的节点，防止 a.cause = b; b.cause = a 造成死循环。
  const seen = new Set<Error>([current]);

  // cause 的类型是 unknown（因为 cause 可以是任何值），必须 instanceof 收窄。
  while (current.cause instanceof Error && !seen.has(current.cause)) {
    current = current.cause;
    seen.add(current);
  }
  return current;
  // 常见错法：写成 `while (err.cause) err = err.cause as Error` ——
  // cause 是字符串时就会返回一个字符串，类型全靠 as 骗过去，运行时炸。
}

// ---------- 7.4 ----------
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Result<T, never> {
  // 返回 Result<T, never> 而不是 Result<T, unknown>：
  // never 能赋给任何 E，所以 ok(1) 可以直接当成 Result<number, string[]> 用。
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  // 返回类型写成 `result is Ok<T>`（类型谓词）而不是 boolean，
  // 这样调用方 `if (isOk(r))` 之后 r 才会被收窄成 Ok<T>。
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function mapResult<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  // 失败时直接把原对象透传（此处 result 已被收窄为 Err<E>，可以赋给 Result<U, E>）。
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErrResult<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  // 😱 常见错法：`return result.value ?? fallback` —— 一是失败分支上没有 value，
  // 二是 value 本身可能就是 0 / '' / null，会被错误地替换成 fallback。
  return result.ok ? result.value : fallback;
}

// ---------- 7.5 ----------
export function collectResults<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];

  // 关键：**不要提前 return**。CLI 校验参数时用户希望一次看到所有问题，
  // 所以要走完整个数组把 error 收集齐。
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }

  return errors.length > 0 ? err(errors) : ok(values);
  // 注意判定用 errors.length > 0 而不是 values.length === results.length，
  // 后者在空数组时也成立，但语义没那么直白。
}

// ---------- 7.6 ----------
export interface User {
  id: number;
  name: string;
  email?: string;
}

export function isUser(value: unknown): value is User {
  // typeof null === 'object'，数组的 typeof 也是 'object'，所以这两个都要显式排除。
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  // 先转成 Record<string, unknown> 再取属性：比 (value as User) 诚实得多 ——
  // 断言成 User 会让编译器以为 id 已经是 number，反而失去检查的意义。
  const o = value as Record<string, unknown>;

  // Number.isInteger 同时挡掉 NaN、Infinity、1.5，比 typeof + % 1 更省事。
  if (typeof o['id'] !== 'number' || !Number.isInteger(o['id'])) return false;
  if (typeof o['name'] !== 'string') return false;
  // 可选字段：只有"存在且不是 string"才算错。用 !== undefined 而不是 'email' in o，
  // 因为显式写 { email: undefined } 也应该算合法。
  if (o['email'] !== undefined && typeof o['email'] !== 'string') return false;

  return true;
  // 注意 TS 是结构化类型：多余属性天然合法，不需要（也不应该）去检查"有没有多余的键"。
}

export function assertNonNull<T>(value: T | null | undefined, name: string): asserts value is T {
  // `== null` 一次命中 null 和 undefined，这是唯一推荐使用 == 的场合。
  // 😱 常见错法：`if (!value)` —— 0 / '' / false 会被误判成"空"。
  if (value == null) {
    throw new AppError('E_NULL', `${name} is null or undefined`);
  }
  // asserts 函数不返回值；返回类型标注是必需的，而且不能写成箭头函数赋给 const。
}

// ---------- 7.7 ----------
export function formatZodError(error: z.ZodError): string[] {
  // v4 只有 error.issues（v3 的 error.errors 别名已被移除）。
  // 也别直接用 error.message —— 它是整个 issues 数组的 JSON 字符串，不能给用户看。
  return error.issues.map((issue) => {
    // path 的类型是 PropertyKey[]（string | number | symbol），
    // 直接 join 在 symbol 上会抛，所以先 map(String) 保险。
    const path = issue.path.map(String).join('.');
    // 顶层错误（输入整体类型不对）的 path 是空数组。
    return `${path || '(root)'}: ${issue.message}`;
  });
  // 想要更好看的输出，v4 还提供 z.prettifyError(error) / z.treeifyError(error)
  // / z.flattenError(error)（v3 的 error.format() / error.flatten() 方法已 deprecated）。
}

// ---------- 7.8 ----------
// ✅ schema 是类型的唯一来源（single source of truth）：
//    先写 schema，类型用 z.infer 推出来，就不可能出现"改了类型忘了改校验"。
//    Java 那边要写 POJO + Bean Validation 注解两处，这里只有一处。
const ConfigSchema = z
  .strictObject({
    // 🔴 strictObject：多余的键报错。用户手写的配置文件一定要 strict，
    //    这样把 port 拼成 prot 时能立刻发现（默认的 z.object 会静默丢掉）。
    name: z.string({ error: 'name 必须是字符串' }).min(1, { error: 'name 不能为空' }),
    port: z
      .number({ error: 'port 必须是数字' })
      .int({ error: 'port 必须是整数' })
      .min(1, { error: 'port 必须在 1~65535 之间' })
      .max(65535, { error: 'port 必须在 1~65535 之间' }),
    // enum + default：输入可省略，输出一定是四个字面量之一。
    logLevel: z
      .enum(['debug', 'info', 'warn', 'error'], { error: 'logLevel 只能是 debug|info|warn|error' })
      .default('info'),
    retries: z
      .number({ error: 'retries 必须在 0~10 之间' })
      .int({ error: 'retries 必须在 0~10 之间' })
      .min(0, { error: 'retries 必须在 0~10 之间' })
      .max(10, { error: 'retries 必须在 0~10 之间' })
      .default(3),
    db: z.object({
      url: z.string({ error: 'db.url 必须是字符串' }).min(1, { error: 'db.url 不能为空' }),
      poolSize: z
        .number({ error: 'db.poolSize 必须是正整数' })
        .int({ error: 'db.poolSize 必须是正整数' })
        .positive({ error: 'db.poolSize 必须是正整数' })
        .default(5),
    }),
    tags: z
      .array(z.string({ error: 'tags 的每一项都必须是字符串' }), {
        error: 'tags 的每一项都必须是字符串',
      })
      .default([]),
  });

// 这就是练习文件里那个 Config interface —— 但这里不用手写，直接推。
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(raw: unknown): Result<Config, string[]> {
  // safeParse 返回 { success, data | error }，正好就是 Result 风格。
  // 如果想要异常风格，同一个 schema 直接用 ConfigSchema.parse(raw)（失败抛 ZodError）。
  const parsed = ConfigSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(formatZodError(parsed.error));
  // 常见错法：`ConfigSchema.parse(raw)` 包一层 try/catch 再把 e as ZodError ——
  // 能跑，但 safeParse 更直接，而且不用担心 catch 到别的异常。
}

// ---------- 7.9 ----------
const EnvSchema = z.object({
  API_KEY: z.string({ error: 'API_KEY 必须是字符串' }).min(1, { error: 'API_KEY 不能为空' }),
  // z.coerce.number() 底层就是 Number(x)，专门用来处理"值全是字符串"的环境变量 / CLI 参数。
  PORT: z
    .coerce
    .number({ error: 'PORT 必须是数字' })
    .int({ error: 'PORT 必须是整数' })
    .min(1, { error: 'PORT 必须在 1~65535 之间' })
    .max(65535, { error: 'PORT 必须在 1~65535 之间' })
    .default(3000),
  TIMEOUT_MS: z
    .coerce
    .number({ error: 'TIMEOUT_MS 必须是数字' })
    .int({ error: 'TIMEOUT_MS 必须是正整数' })
    .positive({ error: 'TIMEOUT_MS 必须是正整数' })
    .default(5000),
  // 😱 千万别写 z.coerce.boolean()：Boolean('false') === true，任何非空串都是 true。
  //    自己 transform 才可控。
  DEBUG: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadEnv(env: Record<string, string | undefined>): Result<EnvConfig, string[]> {
  // 🔴 关键的一步：先把空串 / 纯空白当成"没设置"。
  //    因为 Number('') === 0，`PORT=` 会被 coerce 成 0 然后报 "必须在 1~65535 之间"，
  //    而用户的意思显然是"我没设它"，应该走 .default(3000)。
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value != null && value.trim() !== '') cleaned[key] = value;
  }

  const parsed = EnvSchema.safeParse(cleaned);
  return parsed.success ? ok(parsed.data) : err(formatZodError(parsed.error));
}

// ---------- 7.10 ----------
// ✅ discriminatedUnion 而不是 union：
//    - 报错精准：只报一条 path=['type'] 的错，union 会把每个分支的错误全列出来
//    - 快：靠 type 字段直接选分支，不用逐个试
//    - 推出来的类型是可辨识联合，配 switch 能做穷尽性检查
const CliEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    command: z.string({ error: 'command 不能为空' }).min(1, { error: 'command 不能为空' }),
    at: z
      .number({ error: 'at 必须是非负整数' })
      .int({ error: 'at 必须是非负整数' })
      .nonnegative({ error: 'at 必须是非负整数' }),
  }),
  z.object({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error'], {
      error: 'level 只能是 debug|info|warn|error',
    }),
    message: z.string({ error: 'message 必须是字符串' }),
  }),
  z.object({
    type: z.literal('exit'),
    code: z.number({ error: 'code 必须是整数' }).int({ error: 'code 必须是整数' }),
  }),
]);

export type CliEvent = z.infer<typeof CliEventSchema>;

export function parseCliEvent(raw: unknown): Result<CliEvent, string[]> {
  const parsed = CliEventSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(formatZodError(parsed.error));
}

// 顺带一提：z.infer 出来的 CliEvent 是可辨识联合，配 switch 能做穷尽性检查 ——
//   switch (event.type) { case 'start': ... default: { const _n: never = event; } }
// 以后加了第四种事件忘了处理，default 分支就会编译报错。

// ---------- 7.11 ----------
const TimeRangeSchema = z
  .object({
    start: z
      .number({ error: 'start 必须是非负整数' })
      .int({ error: 'start 必须是非负整数' })
      .nonnegative({ error: 'start 必须是非负整数' }),
    end: z
      .number({ error: 'end 必须是非负整数' })
      .int({ error: 'end 必须是非负整数' })
      .nonnegative({ error: 'end 必须是非负整数' }),
    label: z.string({ error: 'label 不能为空' }).min(1, { error: 'label 不能为空' }).default('range'),
  })
  // .refine 做跨字段校验（≈ Java Bean Validation 的类级别约束 @AssertTrue）。
  // ⚠️ 一定要指定 path，否则 issue 的 path 是空数组，用户不知道该改哪个字段。
  // ⚠️ 实测行为：外层 refine 只有内层字段全部通过才执行，
  //    所以 { start: 'a', end: 1 } 只会得到 1 条字段类型错误，不会额外报这条。
  .refine((v) => v.start < v.end, { error: 'start 必须严格小于 end', path: ['start'] });

export interface TimeRange {
  start: number;
  end: number;
  label: string;
}

export function parseTimeRange(raw: unknown): Result<TimeRange, string[]> {
  const parsed = TimeRangeSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(formatZodError(parsed.error));
}

// ---------- 7.12 ----------
export interface PartitionResult<T> {
  valid: T[];
  invalid: Array<{ index: number; input: unknown; errors: string[] }>;
}

export function partitionParse<T>(
  schema: z.ZodType<T>,
  inputs: readonly unknown[],
): PartitionResult<T> {
  const valid: T[] = [];
  const invalid: PartitionResult<T>['invalid'] = [];

  // 逐条 safeParse：1000 条里坏 3 条不该让整批失败，这是批量导入的标准做法。
  // 用 entries() 同时拿下标和值（for...in 拿到的是字符串键，别用）。
  for (const [index, input] of inputs.entries()) {
    const parsed = schema.safeParse(input);
    if (parsed.success) {
      // 注意 push 的是 parsed.data 而不是 input：默认值 / transform 的结果都在 data 里。
      valid.push(parsed.data);
    } else {
      invalid.push({ index, input, errors: formatZodError(parsed.error) });
    }
  }

  return { valid, invalid };
}
