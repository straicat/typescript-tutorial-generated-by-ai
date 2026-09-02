/**
 * 第 07 章练习 · 错误处理与数据校验
 * =====================================================================
 * 对应文档：docs/07-errors-and-validation.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch07`  或者 `pnpm vitest tests/ch07`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch07-errors-validation.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 本章第 7.7 题之后全部要用 zod v4（已装 zod@4.5.4）：
 *   import { z } from 'zod';
 * =====================================================================
 */

import { z } from 'zod';

/**
 * 练习 7.1 ⭐⭐ —— 把任何被抛出的值归一化成 Error
 *
 * JS 里 `throw` 可以抛任何值（`throw 'oops'` 是合法的），所以 catch 里的 e 是 unknown。
 * 写一个健壮的转换函数，**它自己永远不能抛异常**。
 *
 * 规则（按优先级）：
 *   1. 已经是 Error（含 TypeError / ZodError 等子类）→ 原样返回**同一个对象**
 *   2. 其它值 → 返回 `new Error(msg, { cause: 原始值 })`，msg 按下面的规则算：
 *      - string                          → 该字符串本身
 *      - 非 null 对象且有非空字符串 message → 取 message（跨进程传递后 Error 会退化成普通对象）
 *      - 其它对象                         → JSON.stringify 的结果
 *      - JSON.stringify 抛异常（循环引用 / BigInt）→ '[unserializable value]'
 *      - 其余（number / boolean / bigint / symbol / null / undefined）→ String(值)
 *
 * const e = new TypeError('t'); toError(e) === e            // 同一个对象
 * toError('oops').message      === 'oops'
 * toError('oops').cause        === 'oops'
 * toError(42).message          === '42'
 * toError(null).message        === 'null'
 * toError(undefined).message   === 'undefined'
 * toError({ message: 'from api' }).message === 'from api'
 * toError({ a: 1 }).message    === '{"a":1}'
 */
export function toError(value: unknown): Error {
  throw new Error('TODO 7.1: 实现 toError');
}

/**
 * 练习 7.2 ⭐⭐ —— 带错误码的自定义错误基类
 *
 * 实现 AppError，要求：
 *   - `code` 是只读的稳定错误码（用 code 分类错误，比匹配 message 可靠得多）
 *   - `name` 必须是**实际类名**：`new AppError(...).name === 'AppError'`，
 *     而 `new ConfigError(...).name === 'ConfigError'`。
 *     👉 提示：Error 构造函数不会帮你设 name，而且子类不该重复写一遍 —— 用 `new.target.name`
 *   - 必须把 options（也就是 `{ cause }`）传给 super，否则错误链会断
 *   - `instanceof AppError` / `instanceof Error` 都要为 true
 *
 * ConfigError 已经写好，它固定使用 code 'E_CONFIG'，你只需要完成 AppError。
 *
 * const low = new Error('low');
 * const e = new ConfigError('bad config', { cause: low });
 * e.name === 'ConfigError'; e.code === 'E_CONFIG'; e.cause === low;
 * e instanceof ConfigError && e instanceof AppError && e instanceof Error;
 * String(e) === 'ConfigError: bad config'
 */
export class AppError extends Error {
  /** 稳定的错误码，例如 'E_CONFIG' / 'E_USAGE' / 'E_NULL' */
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    throw new Error('TODO 7.2: 完成 AppError（还差 name，并且要让子类自动拿到自己的类名）');
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super('E_CONFIG', message, options);
  }
}

/**
 * 练习 7.3 ⭐⭐ —— 沿 cause 链挖出根因
 *
 * `new Error(msg, { cause })` 是 ES2022 的错误链（≈ Java 的 initCause / Go 的 %w）。
 * 沿着 `.cause` 一直往下走，返回**最深的那个 Error**。
 *
 * 注意三点：
 *   - cause 的类型是 unknown，只有当它 `instanceof Error` 时才继续往下走
 *   - 没有 cause（或 cause 不是 Error）时，返回传入的那个 error 本身
 *   - 😱 cause 可能形成环（a.cause = b; b.cause = a），**不能死循环**
 *
 * const low = new Error('low');
 * const mid = new Error('mid', { cause: low });
 * const top = new Error('top', { cause: mid });
 * getRootCause(top) === low
 * getRootCause(low) === low
 * getRootCause(new Error('x', { cause: 'not an error' }))  // 返回那个 Error 本身
 */
export function getRootCause(error: Error): Error {
  throw new Error('TODO 7.3: 实现 getRootCause');
}

/**
 * 练习 7.4 ⭐⭐ —— Result 工具箱（Go 风格的错误返回值）
 *
 * TS 没有内置 Result，也没有 Rust 的 `?` 运算符，只能自己定义一个可辨识联合。
 * 类型已经给好了，实现下面 7 个函数：
 *
 *   ok(1)                              -> { ok: true,  value: 1 }
 *   err('bad')                         -> { ok: false, error: 'bad' }
 *   isOk(ok(1))                        -> true    // 同时要能收窄类型
 *   isErr(err('x'))                    -> true
 *   mapResult(ok(2), n => n * 3)       -> { ok: true, value: 6 }
 *   mapResult(err('x'), n => n)        -> { ok: false, error: 'x' }    // 失败原样透传
 *   mapErrResult(err('x'), s => s + '!')-> { ok: false, error: 'x!' }
 *   mapErrResult(ok(1), s => s)        -> { ok: true, value: 1 }
 *   unwrapOr(ok(0), 99)                -> 0       // 😱 不能写 value ?? fallback
 *   unwrapOr(err('x'), 99)             -> 99
 */
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
  throw new Error('TODO 7.4: 实现 ok');
}

export function err<E>(error: E): Result<never, E> {
  throw new Error('TODO 7.4: 实现 err');
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  throw new Error('TODO 7.4: 实现 isOk');
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  throw new Error('TODO 7.4: 实现 isErr');
}

export function mapResult<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  throw new Error('TODO 7.4: 实现 mapResult');
}

export function mapErrResult<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  throw new Error('TODO 7.4: 实现 mapErrResult');
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  throw new Error('TODO 7.4: 实现 unwrapOr');
}

/**
 * 练习 7.5 ⭐⭐⭐ —— 把 Result[] 合并成 Result<T[]>
 *
 * 这是 CLI 校验参数的核心需求：**一次把所有问题都报给用户**，而不是修一个报一个。
 *   - 全部成功 → ok(按原顺序收集的 value 数组)
 *   - 有任何失败 → err(按原顺序收集的**全部** error 数组)，成功的项直接丢掉
 *   - 空数组 → ok([])
 *
 * collectResults([ok(1), ok(2), ok(3)])        -> { ok: true,  value: [1, 2, 3] }
 * collectResults([ok(1), err('a'), err('b')])  -> { ok: false, error: ['a', 'b'] }
 * collectResults([])                           -> { ok: true,  value: [] }
 */
export function collectResults<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  throw new Error('TODO 7.5: 实现 collectResults');
}

/**
 * 练习 7.6 ⭐⭐ —— 手写类型守卫 + 断言函数
 *
 * (a) `isUser(value): value is User` —— 类型谓词，返回 boolean。
 *     要求（注意 TS 是结构化类型，**多余的属性是允许的**）：
 *       - 必须是非 null 的普通对象；数组要返回 false
 *       - id 必须是 number 且是整数（NaN / 1.5 都不行）
 *       - name 必须是 string（空串也算合法）
 *       - email 要么是 undefined（缺省），要么是 string
 *
 *     isUser({ id: 1, name: 'a' })            === true
 *     isUser({ id: 1, name: 'a', x: 9 })      === true    // 多余属性不管
 *     isUser({ id: 1.5, name: 'a' })          === false
 *     isUser({ id: NaN, name: 'a' })          === false
 *     isUser({ id: 1, name: 'a', email: 1 })  === false
 *     isUser(null) === isUser([]) === isUser('{"id":1}') === false
 *
 * (b) `assertNonNull(value, name): asserts value is T` —— 断言函数，
 *     为 null / undefined 时抛 `AppError`，code 为 'E_NULL'，
 *     message 为 `${name} is null or undefined`；否则什么都不做（不返回值）。
 *
 *     👉 `asserts` 函数必须写显式返回类型，而且要用 function 声明（不能是箭头函数赋给 const）。
 *
 *     assertNonNull('x', 'foo')        // 不抛
 *     assertNonNull(0, 'foo')          // 不抛（0 不是 null！）
 *     assertNonNull(null, 'foo')       // 抛 AppError，code 'E_NULL'，message 'foo is null or undefined'
 */
export interface User {
  id: number;
  name: string;
  email?: string;
}

export function isUser(value: unknown): value is User {
  throw new Error('TODO 7.6: 实现 isUser');
}

export function assertNonNull<T>(value: T | null | undefined, name: string): asserts value is T {
  throw new Error('TODO 7.6: 实现 assertNonNull');
}

/**
 * 练习 7.7 ⭐⭐ —— 把 ZodError 格式化成人类可读的字符串数组
 *
 * ZodError 的 `.message` 是整个 issues 数组的 JSON，又长又不能给用户看。
 * 把 `error.issues` 转成每行 `path: message` 的数组，顺序与 issues 一致。
 *   - path 是 `PropertyKey[]`，用 '.' 连接：['db','url'] -> 'db.url'
 *   - 数组下标是 number，也照样连：['list', 1] -> 'list.1'
 *   - 顶层错误的 path 是空数组 [] -> 输出 '(root)'
 *
 * const S = z.object({ name: z.string('name 必须是字符串') });
 * formatZodError(S.safeParse({}).error!)
 *   -> ['name: name 必须是字符串']
 *
 * const T = z.string('必须是字符串');
 * formatZodError(T.safeParse(1).error!)
 *   -> ['(root): 必须是字符串']
 */
export function formatZodError(error: z.ZodError): string[] {
  throw new Error('TODO 7.7: 实现 formatZodError');
}

/**
 * 练习 7.8 ⭐⭐⭐ —— 用 zod 写配置文件 schema，并返回 Result
 *
 * 用 zod 定义一个配置 schema（**不要手写 interface —— schema 才是类型的唯一来源，
 * 下面的 Config 只是把目标形状写给你看，你的实现应该让 z.infer 推出同样的结构**），
 * 然后实现 loadConfig：
 *   - 成功 → ok(填好默认值的 Config)
 *   - 失败 → err(formatZodError 的结果，即 `path: message` 数组)
 *
 * 字段与默认值：
 *   name      string，非空                      必填
 *   port      整数，1 ~ 65535                    必填
 *   logLevel  'debug' | 'info' | 'warn' | 'error'   默认 'info'
 *   retries   整数，0 ~ 10                        默认 3
 *   db.url    string，非空                        必填
 *   db.poolSize 正整数                            默认 5
 *   tags      string[]                            默认 []
 *
 * 要求的错误文案（测试会精确比对，请照抄）：
 *   name 必须是字符串 / name 不能为空
 *   port 必须是数字 / port 必须是整数 / port 必须在 1~65535 之间
 *   logLevel 只能是 debug|info|warn|error
 *   retries 必须在 0~10 之间
 *   db.url 必须是字符串 / db.url 不能为空
 *   tags 的每一项都必须是字符串
 *
 * 🔴 顶层必须用 **strict**（`z.strictObject` 或 `.strict()`）：多余的键要报错，
 *    这样用户把 `port` 写成 `prot` 时能立刻发现。zod 给出的 issue path 是 []，
 *    所以输出形如 '(root): Unrecognized key: "prot"'。
 *
 * loadConfig({ name: 'svc', port: 8080, db: { url: 'postgres://x' } })
 *   -> { ok: true, value: { name: 'svc', port: 8080, logLevel: 'info', retries: 3,
 *                           db: { url: 'postgres://x', poolSize: 5 }, tags: [] } }
 * loadConfig({ port: 0, db: {} })
 *   -> { ok: false, error: ['name: name 必须是字符串',
 *                           'port: port 必须在 1~65535 之间',
 *                           'db.url: db.url 必须是字符串'] }
 */
export interface Config {
  name: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retries: number;
  db: { url: string; poolSize: number };
  tags: string[];
}

export function loadConfig(raw: unknown): Result<Config, string[]> {
  throw new Error('TODO 7.8: 实现 loadConfig');
}

/**
 * 练习 7.9 ⭐⭐⭐ —— 用 z.coerce 校验环境变量
 *
 * process.env 的值全是 `string | undefined`，必须 coerce 成真正的类型。
 *
 * 字段：
 *   API_KEY     string，非空                 必填
 *   PORT        整数 1~65535                 默认 3000
 *   TIMEOUT_MS  正整数                       默认 5000
 *   DEBUG       '1' 或 'true' → true，其余（含缺失）→ false
 *
 * 🔴 两个必须处理的坑：
 *   ① `z.coerce.number()` 会把 '' 变成 0 —— 所以 `PORT=`（空串）必须走默认值 3000，
 *      而不是变成 0 然后报 "超出范围"。**先把空串/纯空白当作没设置过滤掉。**
 *   ② 不要用 `z.coerce.boolean()`：`Boolean('false')` 是 true 😱。
 *      DEBUG 请用 `z.string().optional().transform(...)` 自己判。
 *
 * 要求的错误文案（照抄）：
 *   API_KEY 必须是字符串 / API_KEY 不能为空
 *   PORT 必须是数字 / PORT 必须是整数 / PORT 必须在 1~65535 之间
 *   TIMEOUT_MS 必须是数字 / TIMEOUT_MS 必须是正整数
 *
 * loadEnv({ API_KEY: 'k' })
 *   -> { ok: true, value: { API_KEY: 'k', PORT: 3000, TIMEOUT_MS: 5000, DEBUG: false } }
 * loadEnv({ API_KEY: 'k', PORT: '8080', TIMEOUT_MS: '1500', DEBUG: 'true' })
 *   -> { ok: true, value: { API_KEY: 'k', PORT: 8080, TIMEOUT_MS: 1500, DEBUG: true } }
 * loadEnv({ API_KEY: 'k', PORT: '' })      -> PORT 为 3000
 * loadEnv({ API_KEY: 'k', PORT: 'abc' })   -> { ok: false, error: ['PORT: PORT 必须是数字'] }
 * loadEnv({})                              -> { ok: false, error: ['API_KEY: API_KEY 必须是字符串'] }
 * loadEnv({ API_KEY: '' })                 -> { ok: false, error: ['API_KEY: API_KEY 必须是字符串'] }
 *   ↑ 空串被①的过滤当成"没设置"，所以报的是"必须是字符串"（缺字段）而不是"不能为空"
 */
export interface EnvConfig {
  API_KEY: string;
  PORT: number;
  TIMEOUT_MS: number;
  DEBUG: boolean;
}

export function loadEnv(env: Record<string, string | undefined>): Result<EnvConfig, string[]> {
  throw new Error('TODO 7.9: 实现 loadEnv');
}

/**
 * 练习 7.10 ⭐⭐⭐ —— 用 discriminatedUnion 解析 CLI 事件
 *
 * 用 `z.discriminatedUnion('type', [...])` 解析下面三种事件（**不要用 z.union**：
 * union 失败时会把每个分支的错误全列出来，discriminatedUnion 只报一条，还更快）。
 *
 *   { type: 'start', command: string(非空), at: 非负整数 }
 *   { type: 'log',   level: 'debug'|'info'|'warn'|'error', message: string }
 *   { type: 'exit',  code: 整数 }
 *
 * 要求的错误文案（照抄）：
 *   command 不能为空 / at 必须是非负整数 / level 只能是 debug|info|warn|error
 *   message 必须是字符串 / code 必须是整数
 * 未知的 type 由 zod 自己报（path 为 ['type']），你不用定制。
 *
 * parseCliEvent({ type: 'exit', code: 2 })
 *   -> { ok: true, value: { type: 'exit', code: 2 } }
 * parseCliEvent({ type: 'exit', code: 1.5 })
 *   -> { ok: false, error: ['code: code 必须是整数'] }
 * parseCliEvent({ type: 'nope' })
 *   -> { ok: false, error: ['type: ...'] }        // 只有一条，且以 'type: ' 开头
 */
export type CliEvent =
  | { type: 'start'; command: string; at: number }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  | { type: 'exit'; code: number };

export function parseCliEvent(raw: unknown): Result<CliEvent, string[]> {
  throw new Error('TODO 7.10: 实现 parseCliEvent');
}

/**
 * 练习 7.11 ⭐⭐⭐ —— 用 .refine() 做跨字段校验
 *
 * 解析一个时间区间：
 *   start  非负整数    必填
 *   end    非负整数    必填
 *   label  非空字符串  默认 'range'
 * 额外约束：**start 必须严格小于 end**，用 `.refine()` 实现，
 * 并把 issue 的 path 指定成 ['start']，错误文案为 'start 必须严格小于 end'。
 *
 * 字段级错误文案（照抄）：
 *   start 必须是非负整数 / end 必须是非负整数 / label 不能为空
 *
 * 😱 注意实测行为：挂在对象外层的 .refine() **只有内层字段全部通过才会执行**。
 *    所以 { start: 'a', end: 1 } 只会得到 1 条 'start: start 必须是非负整数'。
 *
 * parseTimeRange({ start: 1, end: 2 })
 *   -> { ok: true, value: { start: 1, end: 2, label: 'range' } }
 * parseTimeRange({ start: 5, end: 5 })
 *   -> { ok: false, error: ['start: start 必须严格小于 end'] }
 * parseTimeRange({ start: 'a', end: 1 })
 *   -> { ok: false, error: ['start: start 必须是非负整数'] }        // 只有一条
 */
export interface TimeRange {
  start: number;
  end: number;
  label: string;
}

export function parseTimeRange(raw: unknown): Result<TimeRange, string[]> {
  throw new Error('TODO 7.11: 实现 parseTimeRange');
}

/**
 * 练习 7.12 ⭐⭐⭐ —— 综合：用 safeParse 批量处理，分离成功与失败
 *
 * 批量导入 1000 条记录时，不能因为第 3 条坏了就整批失败。
 * 用 `schema.safeParse` 逐条处理，把成功的和失败的分开：
 *   - valid：成功的**解析后**数据（注意是 safeParse 的 data，默认值已填好），按原顺序
 *   - invalid：失败项的 { index（原数组下标）, input（原始值）, errors（formatZodError 的结果）}
 *
 * const S = z.object({ id: z.number('id 必须是数字'), tag: z.string().default('none') });
 * partitionParse(S, [{ id: 1 }, { id: 'x' }, null])
 *   -> {
 *        valid: [{ id: 1, tag: 'none' }],
 *        invalid: [
 *          { index: 1, input: { id: 'x' }, errors: ['id: id 必须是数字'] },
 *          { index: 2, input: null,        errors: ['(root): ...'] },
 *        ],
 *      }
 * partitionParse(S, []) -> { valid: [], invalid: [] }
 */
export interface PartitionResult<T> {
  valid: T[];
  invalid: Array<{ index: number; input: unknown; errors: string[] }>;
}

export function partitionParse<T>(
  schema: z.ZodType<T>,
  inputs: readonly unknown[],
): PartitionResult<T> {
  throw new Error('TODO 7.12: 实现 partitionParse');
}
