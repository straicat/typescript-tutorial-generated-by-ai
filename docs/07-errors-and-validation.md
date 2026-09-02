# 07 · 错误处理与数据校验：编译期类型 ≠ 运行时安全

> 本章两件事：① 把 Java 的 `throws` / Go 的 `if err != nil` 思维平移过来（并接受"签名里看不见异常"）；
> ② 建立一个必须刻进肌肉记忆的习惯 —— **所有外部数据进入程序时，都要用 `zod` 校验一遍**。
>
> 第 ② 点比第 ① 点重要十倍：TS 的类型编译后**完全消失**，一个 `as User` 就能让整个类型系统失效。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 运行时类型安全 | JVM 有类型信息，Go 有反射 | **类型编译后消失**，只能靠校验库（zod） | 🔴 高 |
| 检查型异常 | Java `throws IOException` 强制处理 | **没有**，签名里看不出会抛什么 | 🔴 高 |
| `catch` 变量类型 | `catch (IOException e)` 类型确定 | **`unknown`**（因为能抛任何值） | 🔴 高 |
| 能抛什么 | 只能抛 `Throwable` / `error` | **任何值**：`throw 'oops'` 合法 😱 | 🔴 高 |
| 错误返回值 | Go `(T, error)` 是语言级约定 | 无内置 `Result`，自己写可辨识联合 | 🟡 中 |
| 错误链 | `initCause` / `fmt.Errorf("%w")` | `new Error(msg, { cause })`（ES2022） | 🟡 中 |
| 判断错误类型 | `catch (MyEx e)` / `errors.As` | `e instanceof MyError` + 自定义 `code` | 🟡 中 |
| 多错误聚合 | Go `errors.Join` | `AggregateError`（ES2021） | 🟢 低 |
| 资源清理 | try-with-resources / `defer` | 只有 `try/finally`（`using` 见 §6） | 🟡 中 |
| 进程兜底 | `UncaughtExceptionHandler` | `process.on('uncaughtException')` | 🟡 中 |
| 校验声明 | Bean Validation 注解 + POJO（两处） | zod schema **一处**，类型用 `z.infer` 推 | 🟢 低（优势） |

---

## 1. `Error` 对象：重点是 `cause`

```ts
const err = new Error('连接超时');
err.message;   // '连接超时'
err.name;      // 'Error'   ← 类名。自定义错误类必须自己设（§3）
err.stack;     // string | undefined —— 不保证有
String(err);   // 'Error: 连接超时'  等于 `${name}: ${message}`
```

**`cause`（ES2022）≈ Java 的 `initCause` / Go 的 `%w`：**

```ts
try {
  await readConfig();
} catch (e) {
  throw new Error('配置加载失败', { cause: e });   // ✅ 包一层但不丢根因
}

// cause 的类型是 unknown（可以是任何值），所以必须收窄才能往下挖
let cur: unknown = topError;
while (cur instanceof Error) {
  console.error(cur.message);
  cur = cur.cause;
}
```

> ⚠️ `console.error(err)` 会自动打印整条 `[cause]` 链，但 `err.message` **只有最外层那一句**。
> 日志里想看到根因，要么打整个对象，要么自己遍历。

**内置错误类型**（都继承 `Error`，用 `instanceof` 判断）：

| 类型 | 什么时候出现 | Java 近似 |
| --- | --- | --- |
| `TypeError` | 对 `undefined` 取属性、把非函数当函数调 | `NullPointerException` |
| `RangeError` | `new Array(-1)`、递归爆栈 | `IllegalArgumentException` |
| `SyntaxError` | `JSON.parse('{bad}')` | `JsonParseException` |
| `AggregateError` | `Promise.any()` 全失败；自己聚合多个错误 | Go 的 `errors.Join` |

```ts
const agg = new AggregateError([new Error('第 1 条'), new Error('第 3 条')], '2 条导入失败');
console.log(agg.errors.length);   // 2 ← 注意属性名是 errors
```

---

## 2. `throw` 能抛任何值 → `catch (e)` 里 `e` 是 `unknown`

```ts
throw 'oops';          // 😱 合法
throw { code: 500 };   // 😱 合法，第三方库真这么干过
throw null;            // 😱 合法
```

于是 TS 把 `catch` 变量定为 `unknown`（`useUnknownInCatchVariables`，`strict` 下默认开）：

```ts
try { risky(); } catch (e) {
  // console.log(e.message);   // ❌ 编译错误：'e' is of type 'unknown'
  if (e instanceof Error) console.log(e.message);   // ✅ 收窄之后才能用
}
```

**结论：每个 `catch` 的第一件事是把 `unknown` 变成 `Error`。** 写一次，全项目复用：

```ts
/** 把任何被抛出的鬼东西变成正常 Error，且自己永不抛异常 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;      // ✅ 原样返回，否则原 stack 丢了
  return new Error(describe(value), { cause: value });   // 原始值挂 cause，信息不丢
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    // 跨进程 / 结构化克隆后 Error 会退化成普通对象，但 message 还在
    const m = (value as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
    try { return JSON.stringify(value) ?? String(value); }
    catch { return '[unserializable value]'; }    // 😱 循环引用 / BigInt 会让 stringify 抛
  }
  return String(value);   // number/boolean/bigint/symbol/null/undefined 都安全
}
```

---

## 3. 自定义错误类：三个必须知道的细节

```ts
export class AppError extends Error {
  /** 稳定错误码。用 code 分类比匹配 message 可靠一万倍（message 是给人看的，会改） */
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);       // ✅ options 就是 { cause }，别忘了往上传，否则错误链断
    this.name = new.target.name;   // ✅ 见细节 1
    this.code = code;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, options?: ErrorOptions) { super('E_CONFIG', message, options); }
}

const e = new ConfigError('port 必须是数字', { cause: new SyntaxError('bad json') });
e.name;   // 'ConfigError'  ← new.target 的功劳，子类不用重复写
e.code;   // 'E_CONFIG'
e instanceof ConfigError && e instanceof AppError && e instanceof Error;   // 全 true
String(e);   // 'ConfigError: port 必须是数字'
```

**细节 1：必须自己设 `this.name`。** `Error` 构造函数不会根据类名设 `name`，不设的话
`String(err)` 和 `err.stack` 第一行都是 `Error: xxx`。用 `new.target.name` 让**子类自动拿到自己的类名**。

**细节 2：`Object.setPrototypeOf` 的历史坑。** 老代码里到处是这一行：

```ts
Object.setPrototypeOf(this, LegacyError.prototype);   // 😱 这行是干什么的？
```

原因：**`target: "ES5"` 时** `class` 被降级成函数 + 原型链模拟，而 `Error` 原生构造函数会返回新对象，
导致原型链断掉、`instanceof LegacyError` 变成 `false`。这行是当年的补丁。
本项目 `target: "ES2023"`，`class` 是原生的，**完全不需要它** —— 但你一定会在 Stack Overflow 上见到。

**细节 3：用 `code` 而不是继承树分类错误。** Java 习惯建异常继承树，CLI/Agent 场景更实用的是
**一个基类 + 字符串 code**：`switch (err.code)` 比一串 `instanceof` 好读；code 能直接映射退出码；
跨进程序列化后 `instanceof` 就废了，`code` 还在。

```ts
function exitCodeOf(err: unknown): number {
  if (!(err instanceof AppError)) return 1;
  switch (err.code) {
    case 'E_CONFIG': return 78;   // EX_CONFIG（sysexits.h 约定）
    case 'E_USAGE':  return 64;   // EX_USAGE
    default:         return 1;
  }
}
```

---

## 4. 没有 checked exception —— Java 开发者最不适应的点

```java
public Config load(Path p) throws IOException, ConfigException { ... }   // Java：编译器强迫你处理
```
```ts
function load(p: string): Config { ... }   // TS：签名里【一个字都没有】关于异常的信息
```

TS 甚至**没有** `throws` 语法（也不打算加）。三条对策：

1. **JSDoc 写 `@throws`**：编译器不查，但 IDE 会显示，聊胜于无。
2. **可预期的失败改用类型化的 `Result` 返回值**（§5）—— 失败就出现在签名里了，这就是 Go 的做法，**本章主推**。
3. **在边界统一兜底**：CLI 的 `main()`、Agent 的一轮循环外面套一个 `try/catch`（§7）。中间层不要到处 `try/catch`。

---

## 5. 异常 vs `Result`（Either）：按场景选

| 用异常 | 用 `Result` |
| --- | --- |
| 真正的意外：磁盘炸了、代码 bug（`TypeError`） | 可预期的失败：用户输入不合法、配置写错、LLM 返回不合 schema |
| 调用栈深、中间层无事可做（异常能自动穿透 10 层） | 需要**收集全部错误**：CLI 校验参数要一次报完，而不是修一个报一个 |
| 第三方库只提供抛异常的 API（大部分都是） | 批量处理：1000 条里坏 3 条，不能整批中断 |

```ts
export interface Ok<T>  { readonly ok: true;  readonly value: T }
export interface Err<E> { readonly ok: false; readonly error: E }

/** 可辨识联合，靠 ok 字段收窄，≈ Rust 的 Result / Go 的 (T, error) */
export type Result<T, E> = Ok<T> | Err<E>;

export const ok  = <T>(value: T): Result<T, never> => ({ ok: true,  value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> { return r.ok; }

export function mapResult<T, E, U>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;           // 失败原样透传
}
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;            // ⚠️ 不能写 r.value ?? fallback，value 可能就是 0 / null
}
```

用起来靠 `if (r.ok)` 收窄，TS 自动缩到 `Ok<T>` 或 `Err<E>`：

```ts
const r = loadConfig(raw);
if (!r.ok) {
  for (const line of r.error) console.error(`  - ${line}`);   // ✅ 这里 r.error 是 string[]
  process.exitCode = 78;
  return;
}
console.log(r.value.port);                                     // ✅ 这里 r.value 是 Config
```

**代价：TS 没有 Rust 的 `?` 运算符**，也没有 Go 的 `if err != nil` 糖，链式调用会啰嗦：

```ts
// Rust: let cfg = load()?; let db = connect(cfg)?;
const a = parsePort(raw);   if (!a.ok) return a;
const b = checkRange(a.value); if (!b.ok) return b;   // 只能一层层判
```

> **本教程推荐的折中**：内部代码大方地抛异常，**只在「外部数据入口」和「CLI 命令边界」用 `Result`**。
> 两者不冲突：同一个 zod schema，`safeParse` 给你 Result，`parse` 给你异常（§10.3）。

---

## 6. `finally` 与资源清理

```ts
const handle = await open('data.txt');
try {
  return await handle.readFile('utf8');
} finally {
  await handle.close();       // ✅ 正常返回或抛异常都会执行
}
```

**没有 try-with-resources，也没有 `defer`。** 三个坑：

```ts
// 坑 1：finally 里 return 会【吃掉】异常
function bad(): string {
  try { throw new Error('boom'); }
  finally { return 'swallowed'; }        // 😱 异常消失，函数正常返回 'swallowed'
}

// 坑 2：finally 里再抛会【覆盖】原异常，真正的原因就丢了
finally { await handle.close(); }        // 😱 close 失败会掩盖业务错误
// ✅ 保住原错误：try { await handle.close(); } catch { /* 只记日志 */ }

// 坑 3：忘了 await（见第 06 章）—— finally 里不 await 的 Promise 等于没清理
```

CLI 里最实用的是把清理收成高阶函数：

```ts
export async function withCleanup<T>(
  acquire: () => Promise<{ resource: T; release: () => Promise<void> }>,
  use: (resource: T) => Promise<void>,
): Promise<void> {
  const { resource, release } = await acquire();
  try { await use(resource); }
  finally { await release().catch((e) => console.error('清理失败:', toError(e).message)); }
}
```

> **顺带一提**：TS 5.2+ 支持"显式资源管理" —— `using x = ...` + `Symbol.dispose`
> （异步版 `await using` + `Symbol.asyncDispose`），语义很接近 Go 的 `defer`。
> 但它需要 tsconfig 的 `lib` 加 `esnext.disposable`，本项目没开，而且生态里第三方库基本还没实现。
> **知道有这东西即可，先用 `try/finally`。**

---

## 7. 进程级兜底与 CLI 的统一错误出口

Node 是单线程事件循环，**任何未捕获的异常默认让进程退出**（exit code 1）。两个兜底钩子：

```ts
process.on('uncaughtException', (e, origin) => {
  console.error(`[FATAL] 未捕获异常 (${origin}):`, toError(e).stack);
  process.exit(1);                  // ✅ 记完日志必须退出
});
process.on('unhandledRejection', (reason) => {
  // Promise 被 reject 却没人 .catch()。Node 15+ 默认也会崩，这里只为留日志
  console.error('[FATAL] 未处理的 rejection:', toError(reason).stack);
  process.exit(1);
});
```

**什么时候该让进程崩掉？** 业界共识（Node 官方文档同）：`uncaughtException` 之后程序状态**已不可信**
（资源半开、状态机停在中间），这两个钩子只用来**记日志/上报**，然后**必须退出**，不要试图"恢复运行"。
CLI 更简单：崩了就崩了，靠退出码告诉调用方。需要"重启"的是长驻服务，那是 systemd / k8s 的活。

**CLI 的统一错误出口**（第 08 章直接复用）：

```ts
function reportFatal(e: unknown, verbose: boolean): never {
  const error = toError(e);
  console.error(`✖ ${error.message}`);            // 1. 友好信息 → stderr（stdout 留给数据）

  let cause: unknown = error.cause;               // 2. 打错误链，让用户看到根因
  while (cause instanceof Error) {
    console.error(`  ↳ 原因: ${cause.message}`);
    cause = cause.cause;
  }

  if (verbose) console.error('\n' + (error.stack ?? '(no stack)'));   // 3. 只有 --verbose 才打栈
  process.exit(exitCodeOf(error));                                    // 4. 退出码供 shell 判断
}

main().catch((e) => reportFatal(e, process.argv.includes('--verbose')));
```

> 返回类型 `never` 让 TS 知道它不会正常返回，所以 `if (bad) reportFatal(...)` 之后变量能被正确收窄。

---

## 8. ⭐ 核心：为什么 TS 的类型在运行时救不了你

**全章最重要的一节。** TS 的类型编译后 **100% 消失**，没有任何运行时检查。
而 JS 里所有外部数据入口都返回 `any`：

```ts
const raw = JSON.parse(text);          // ⚠️ 返回类型是 any —— 类型系统在这里彻底缴械
const user = raw as User;              // 😱 一个 as 就"断言"成 User，编译器一声不吭
console.log(user.name.toUpperCase());  // 💥 运行时 TypeError: Cannot read properties of undefined
```

| | 反序列化时会发生什么 |
| --- | --- |
| Java (Jackson) | 类型不匹配 → 抛 `MismatchedInputException`，**真的检查** |
| Go (`encoding/json`) | 类型不匹配 → 返回 `error`，**真的检查** |
| TypeScript | **什么都不检查**。`as User` 连一行运行时代码都不生成 😱 |

`as` 比 Java 的强制转型危险得多 —— `(User) obj` 失败会抛 `ClassCastException`，`as User` 什么都不会发生。

**必须做运行时校验的入口清单（一个都不能漏）**：

| 数据来源 | 为什么不可信 |
| --- | --- |
| HTTP 响应 / `fetch().json()` | 上游改字段、返回错误页、网关吐 502 HTML |
| 配置文件（JSON/YAML/TOML） | 人手写的，一定会写错 |
| 环境变量 `process.env` | 类型是 `string \| undefined`，`PORT=abc` 是常态 |
| 命令行参数 `process.argv` | 全是字符串，用户什么都敢输 |
| **LLM 的输出** | 🔴 即使开了 JSON mode 也可能少字段、多字段、类型漂移 |
| 数据库 / 缓存里的历史数据 | 老版本写进去的，schema 早变了 |

> **铁律**：`JSON.parse` 之后**下一行**就该是校验。代码里出现 `as SomeInterface` 的地方，99% 是等着爆的 bug。

---

## 9. 手写类型守卫：能用，但别当主力

**① 类型谓词 `x is T`**（返回 boolean）：

```ts
interface User { id: number; name: string; email?: string }

function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  if (typeof o['id'] !== 'number' || !Number.isInteger(o['id'])) return false;  // 顺手挡掉 NaN / 1.5
  if (typeof o['name'] !== 'string') return false;
  if (o['email'] !== undefined && typeof o['email'] !== 'string') return false; // 可选字段
  return true;
}

const data: unknown = JSON.parse(text);
if (isUser(data)) console.log(data.name);   // ✅ 这里 data 的类型是 User
```

**② 断言函数 `asserts x is T`**（不返回值，不满足就抛）：

```ts
function assertNonNull<T>(value: T | null | undefined, name: string): asserts value is T {
  if (value == null) throw new AppError('E_NULL', `${name} is null or undefined`);
  // 😱 别写 if (!value) —— 0 / '' / false 会被误判成空
}

const found: User | undefined = users.find((u) => u.id === 1);
assertNonNull(found, 'user#1');
console.log(found.name);   // ✅ 这行之后 found 已收窄为 User
```

> ⚠️ `asserts` 函数**必须有显式返回类型标注**，而且**不能是箭头函数赋给 `const`**。写成 `function` 声明最稳。

**`in` 也能收窄**（对可辨识联合最好用）：

```ts
type Res = { ok: true; data: string } | { ok: false; reason: string };
const show = (r: Res): string => ('data' in r ? r.data : r.reason);   // ✅ in 会收窄联合
```

**手写守卫的三个缺点**（所以要用 zod）：① 20 个字段要写 40 行 `typeof`；
② 嵌套对象/数组元素/可选字段漏一个就等于没校验；
③ 🔴 **和类型定义不同步** —— `interface User` 加字段，`isUser` 不会报错，编译器不知道它们该一致。**这条最致命。**

---

## 10. zod v4 实战（本章重头）

zod 反过来解决了第 ③ 个问题：**先写 schema，类型用 `z.infer` 从 schema 推出来**，
于是"校验逻辑"和"类型"物理上就是同一个东西，不可能不同步。

```ts
import { z } from 'zod';
```

> 本节 API 全部在 `zod@4.5.4` 上实测过。**v4 与 v3 差异不小**，末尾有对照表。

### 10.1 基本 schema

```ts
z.string(); z.number(); z.boolean(); z.bigint(); z.date();
z.literal('admin');                            // 字面量
z.enum(['debug', 'info', 'warn', 'error']);    // 枚举，.options 能拿回数组
z.array(z.string());                           // string[]
z.object({ id: z.number(), name: z.string() });
z.record(z.string(), z.number());              // ⚠️ v4 必须传两个参数（key, value）
z.tuple([z.string(), z.number()]);             // [string, number]
z.union([z.string(), z.number()]);             // string | number
z.discriminatedUnion('type', [/* ... */]);     // 见 10.5
z.unknown(); z.any(); z.null(); z.undefined();

z.string().optional();      // string | undefined
z.string().nullable();      // string | null
z.string().nullish();       // string | null | undefined
z.string().default('x');    // 输入可省略，输出一定有值
z.array(z.string()).default([]);

z.string().min(1).max(100).trim().regex(/^[a-z-]+$/);
z.number().int().positive().nonnegative().min(1).max(65535);
z.email(); z.url(); z.uuid();   // ⚠️ v4 是顶层函数；v3 的 z.string().email() 已 deprecated
```

### 10.2 `z.infer`：schema 是类型的唯一来源

```ts
const UserSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  role: z.enum(['admin', 'user']),
  tags: z.array(z.string()).default([]),
  nickname: z.string().optional(),
});

// ✅ single source of truth：不要再手写 interface User！
type User = z.infer<typeof UserSchema>;
// = { id: number; name: string; role: 'admin' | 'user'; tags: string[]; nickname?: string }

type UserIn = z.input<typeof UserSchema>;   // tags 可省略（有 .default）
// z.infer === z.output；有 .default() / .transform() 时 input 和 output 不同
```

| Java (Bean Validation) | TypeScript (zod) |
| --- | --- |
| POJO 写字段和类型 | schema 里写一次 |
| 再加 `@NotNull @Size(min=1) @Email` 注解 | 同一行链式写完 `.min(1)` |
| **两处维护**，加字段忘加注解不报错 | **一处维护**，类型自动同步 |
| 需要反射 + `Validator` bean | 一个函数调用 |

### 10.3 `parse` vs `safeParse`：正好对应异常 vs Result

```ts
const user = UserSchema.parse(raw);        // ① 失败抛 ZodError（异常风格），类型直接是 User

const result = UserSchema.safeParse(raw);  // ② 返回可辨识联合（Result 风格）
if (result.success) console.log(result.data.name);   // ✅ result.data 是 User
else console.error(result.error.issues);            // ✅ result.error 是 ZodError
```

返回类型就是 `{ success: true; data: T } | { success: false; error: ZodError }` —— 和 §5 手写的 `Result` 同一个模式。
异步 schema（`.refine` 里有 `await`）用 `parseAsync` / `safeParseAsync`。

`ZodError` 是 `Error` 子类（`e instanceof z.ZodError` 为 true，`e.name === 'ZodError'`）。
⚠️ 它的 `.message` 是**整个 issues 数组的 JSON 字符串**，又长又不友好，**别直接打给用户**。

### 10.4 错误信息处理（CLI 必备）

```ts
const r = z.object({
  name: z.string(), db: z.object({ url: z.string() }), list: z.array(z.string()),
}).safeParse({ db: {}, list: ['a', 1] });

// r.error.issues 是扁平数组，每项至少有 code / path / message：
// [ { code: 'invalid_type', path: ['name'],     message: 'Invalid input: expected string...' },
//   { code: 'invalid_type', path: ['db','url'], message: '...' },
//   { code: 'invalid_type', path: ['list', 1],  message: '...' } ]   ← 数组下标是 number
```

`path` 的类型是 `PropertyKey[]`。**变成人类可读的多行提示** —— CLI 里我每次都这么写：

```ts
export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');   // ['db','url'] -> 'db.url'
    return `${path || '(root)'}: ${issue.message}`;  // 顶层错误 path 是 []
  });
}
```

v4 还内置三个**顶层函数**（v3 的 `error.format()` / `error.flatten()` 方法已 deprecated）：

```ts
z.prettifyError(r.error);      // ✅ 多行文本，带 ✖ 和 "→ at db.url"，直接打 stderr 就很好看
z.flattenError(r.error);       // { formErrors: string[], fieldErrors: {...} }，只适合一层
z.treeifyError(r.error);       // 按嵌套结构组织成树
z.core.toDotPath(issue.path);  // ['list', 1] -> 'list[1]'，比 join('.') 好看
```

**自定义 message** —— v4 统一用 `error` 这个 key（也支持字符串简写）：

```ts
z.string('name 必须是字符串')                  // ✅ v4 简写
z.string({ error: 'name 必须是字符串' })       // ✅ 等价完整写法
z.string().min(1, { error: 'name 不能为空' })  // 给单个 check 定制
```

> ⚠️ 实测细节：**基础类型上的 `error` 会成为整条链的默认消息**。
> `z.coerce.number({ error: 'A' }).max(10)` 超限时也报 `'A'`。
> 想让不同 check 报不同消息，就**在每个 check 上单独写 `error`**（check 级优先）。

### 10.5 `.refine()` / `.transform()` / `.pipe()` / `z.coerce`

**跨字段校验用 `.refine()`**（≈ Java 的类级别约束 `@AssertTrue`）：

```ts
const RangeSchema = z.object({ start: z.number(), end: z.number() })
  .refine((v) => v.start < v.end, {
    error: 'start 必须严格小于 end',
    path: ['start'],          // ✅ 一定要指定 path，否则 path 是 []，用户不知道改哪个字段
  });
// { start: 5, end: 1 } -> [{ code: 'custom', path: ['start'], message: 'start 必须严格小于 end' }]
```

> 😱 **实测确认的坑**：挂在对象外层的 `.refine()` **只有内层字段全部通过才会执行**。
> `{ start: 'a', end: 1 }` 只会得到 1 条 `start 必须是数字`，**不会**额外报 refine 的错。
> 这其实是好事（refine 里不会碰到脏数据），但写测试时要知道错误条数。

一次报多个自定义错误用 `.superRefine()`（v4 里还有更新的 `.check()`）：

```ts
z.object({ a: z.number(), b: z.number() }).superRefine((v, ctx) => {
  if (v.a < 0) ctx.addIssue({ code: 'custom', message: 'a 不能为负', path: ['a'] });
  if (v.b < 0) ctx.addIssue({ code: 'custom', message: 'b 不能为负', path: ['b'] });
});
```

**`.transform()` 改变输出类型，`.pipe()` 串联两个 schema：**

```ts
z.string().transform((s) => s.length);                    // 输出类型变成 number
z.string().trim().pipe(z.string().min(1));                // 先 trim 再校验非空 —— '   ' 会失败 ✅
z.string().pipe(z.coerce.number()).pipe(z.number().int().positive());
```

**`z.coerce.*`：解析环境变量 / 命令行参数必用**（它们永远是字符串）：

```ts
z.coerce.number().parse('42');      // 42   ✅
z.coerce.number().parse('');        // 0    😱 空串变 0（底层就是 Number('')）
z.coerce.number().safeParse('abc'); // 失败：invalid_type, received 'NaN'
z.coerce.boolean().parse('false');  // true 😱😱 Boolean('false') 是 true，非空串全是 true
```

> 🔴 **两个必须记住的 coerce 坑**：
> ① `''` 会变成 `0` —— 读环境变量前要**先把空串当成"没设置"过滤掉**，否则 `PORT=` 会被解析成 0 而不走 `.default()`。
> ② **永远别用 `z.coerce.boolean()` 解析环境变量**，手写：
> `z.string().optional().transform((v) => v === '1' || v === 'true')`。

### 10.6 三个实用配方

**A · 校验环境变量**

```ts
const EnvSchema = z.object({
  API_KEY: z.string('API_KEY 必须是字符串').min(1, { error: 'API_KEY 不能为空' }),
  PORT: z.coerce.number({ error: 'PORT 必须是数字' }).int({ error: 'PORT 必须是整数' })
          .min(1, { error: 'PORT 超出范围' }).max(65535, { error: 'PORT 超出范围' }).default(3000),
  DEBUG: z.string().optional().transform((v) => v === '1' || v === 'true'),
});

export function loadEnv(env: Record<string, string | undefined>) {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v != null && v.trim() !== '') cleaned[k] = v;   // ✅ 关键：空串当成没设置，否则 PORT= 变 0
  }
  return EnvSchema.safeParse(cleaned);
}

const r = loadEnv(process.env);
if (!r.success) {
  console.error('环境变量有误:\n' + formatZodError(r.error).map((l) => '  - ' + l).join('\n'));
  process.exit(78);
}
// r.data: { API_KEY: string; PORT: number; DEBUG: boolean }  ← 真正的类型，不是 string
```

**B · 校验 JSON 配置文件**

```ts
const ConfigSchema = z.strictObject({     // strict：多余的键报错，帮用户抓拼写错误
  name: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  db: z.object({ url: z.string().min(1), poolSize: z.number().int().positive().default(5) }),
});
export type Config = z.infer<typeof ConfigSchema>;

export async function readConfig(path: string): Promise<Config> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));    // 可能抛 ENOENT 或 SyntaxError
  } catch (e) {
    throw new ConfigError(`无法读取配置 ${path}`, { cause: e });   // ✅ cause 保住根因
  }
  const r = ConfigSchema.safeParse(raw);               // ✅ parse 之后立刻校验
  if (!r.success) {
    throw new ConfigError(`配置不合法 ${path}:\n${formatZodError(r.error).join('\n')}`, { cause: r.error });
  }
  return r.data;
}
```

**C · 校验 LLM 返回的 JSON**（第 09 章直接用这段）

```ts
const ToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('search'), query: z.string().min(1), limit: z.number().int().max(50).default(10) }),
  z.object({ tool: z.literal('read_file'), path: z.string().min(1) }),
  z.object({ tool: z.literal('finish'), answer: z.string() }),
]);
type ToolCall = z.infer<typeof ToolCallSchema>;

function parseToolCall(llmOutput: string): Result<ToolCall, string[]> {
  let raw: unknown;
  try { raw = JSON.parse(llmOutput); }
  catch { return err(['模型没有返回合法 JSON']); }    // 模型经常在 JSON 外裹一层 ```json
  const r = ToolCallSchema.safeParse(raw);
  return r.success ? ok(r.data) : err(formatZodError(r.error));
  // ✅ 失败时把 formatZodError 的结果喂回给模型当反馈让它重试 —— Agent 的标准做法
}

function run(call: ToolCall): string {
  switch (call.tool) {                     // 可辨识联合 + switch = 穷尽性检查
    case 'search':    return `搜索 ${call.query} (limit=${call.limit})`;
    case 'read_file': return `读取 ${call.path}`;
    case 'finish':    return call.answer;
    default: { const _never: never = call; return _never; }   // 加了新 tool 忘处理 → 编译报错 ✅
  }
}
```

> **`discriminatedUnion` vs `union`：一定用前者。** `union` 失败会把**每个分支的错误全列出来**
> （嵌套的 `invalid_union.errors`），没法看；`discriminatedUnion` 只报**一条**
> `path: ['tool'], message: "Invalid discriminator value. Expected 'search' | ..."`，而且不用逐个试分支，快得多。

### 10.7 多余属性：`strip` / `strict` / `loose` / `catchall`

`z.object()` 默认是 **strip：静默丢掉未声明的键**（≠ Jackson 默认报错）：

```ts
const S = z.object({ a: z.string() });
S.parse({ a: '1', extra: 9 });                     // { a: '1' }  ← extra 被丢掉，不报错

z.strictObject({ a: z.string() }).safeParse({ a: '1', typo: 9 });
// ✗ { code: 'unrecognized_keys', keys: ['typo'], path: [], message: 'Unrecognized key: "typo"' }

z.looseObject({ a: z.string() }).parse({ a: '1', extra: 9 });   // { a: '1', extra: 9 } 原样保留
// 实例方法 .loose() 等价；v3 的 .passthrough() 已 deprecated
S.catchall(z.number()).parse({ a: '1', extra: 9 });             // 未声明的键必须是 number
```

**怎么选**：**用户手写的配置文件用 `z.strictObject`**（能抓出 `prot` 这种拼写错误）；
**上游 API / LLM 响应用默认 strip**（上游加字段不该让你崩）。

### 10.8 性能与取舍

zod 是运行时校验，每次 parse 都要走一遍 checks，有真实开销。热路径（每秒几万次）可以考虑
`valibot`（模块化、体积极小）、`typia`（编译期生成校验代码，最快）、`arktype`（语法接近 TS 类型本身）。
**但 CLI 和 Agent 场景下，parse 耗时相对一次网络/LLM 调用可以忽略 —— 直接用 zod**，
生态和文档最好，`openai` SDK 的结构化输出也原生支持它。

### zod v3 → v4 变化速查（均已实测）

| v3 | v4 |
| --- | --- |
| `z.string().email()` | `z.email()`（旧写法仍可用但已 deprecated） |
| `error.errors` | **只有 `error.issues`**（`errors` 别名被移除） |
| `error.format()` / `error.flatten()` | `z.treeifyError(err)` / `z.flattenError(err)`（方法已 deprecated） |
| — | 新增 `z.prettifyError(err)`：直接给人看的多行文本 |
| `.passthrough()` | `.loose()` / `z.looseObject()` |
| `{ message: '...' }` | `{ error: '...' }`，或简写 `z.string('...')` |
| `z.record(valueSchema)` | `z.record(keySchema, valueSchema)`（**必须两个参数**） |
| `z.ZodIssue` | `z.core.$ZodIssue`（`z.ZodIssue` 已 deprecated） |
| code `invalid_string` / `invalid_enum_value` | `invalid_format` / `invalid_value` |

---

## 11. 小结：数据从哪来 → 用什么校验 → 失败怎么办

| 数据来源 | 校验方式 | 失败怎么办 | 退出码 |
| --- | --- | --- | --- |
| 命令行参数 | `z.coerce.*` + `safeParse` | 打印**全部**问题到 stderr + usage | `64` (EX_USAGE) |
| 环境变量 | `safeParse`（先滤空串） | 打印缺哪个变量，**启动时就失败** | `78` (EX_CONFIG) |
| 配置文件 | `z.strictObject` + `safeParse` | 打印 `path: message` 多行列表 | `78` (EX_CONFIG) |
| HTTP 响应 | 默认 strip 的 `z.object` + `safeParse` | 重试 / 降级，记录原始 body | 不崩，返回 `Result` |
| LLM 输出 | `discriminatedUnion` + `safeParse` | 把错误文本喂回模型，**重试 N 次** | 不崩，返回 `Result` |
| 数据库 / 缓存 | `safeParse`，老数据用 `.optional()` 兼容 | 跳过该条 + 告警，别整批失败 | 不崩 |
| 内部不变量 | `assertNonNull` / `parse`（抛异常） | **让它崩** —— 这是 bug，不是用户的错 | `1` |
| 未捕获异常 | `process.on('uncaughtException')` | 记日志 + 上报，然后**退出** | `1` |

**一句话版本**：**边界用 `safeParse` + `Result`，内部用 `parse` + 异常，
`catch` 第一行 `toError`，`main()` 外面一个统一出口。**

---

## 本章练习

```bash
# 1. 打开 exercises/ch07-errors-validation.ts，把所有 TODO 填掉
# 2. 跑测试
pnpm test tests/ch07

# 3. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch07

# 4. 卡住了看 solutions/ch07-errors-validation.ts
```

练习覆盖：`toError(unknown)` 归一化、带 `code` 的自定义错误类 + `cause` 链 + `getRootCause`、
`Result` 工具箱（`ok`/`err`/`isOk`/`map`/`mapErr`/`unwrapOr`）与 `collectResults` 收集全部错误、
手写守卫 `isUser` 与断言函数 `assertNonNull`、`formatZodError` 输出 `path: message`、
zod 配置 schema + `loadConfig`、`z.coerce` 校验环境变量、`discriminatedUnion` 解析 CLI 事件、
`.refine` 跨字段校验、`safeParse` 批量处理分离成功与失败。

---

**下一章** → [08 · 命令行工具实战：用 commander 写一个像样的 CLI](./08-cli-with-commander.md)
