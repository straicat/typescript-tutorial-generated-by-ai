# 02 · 类型系统：结构化类型才是 TS 的灵魂

> 本章目标：把 Java/Go 那套「类型 = 类 + 继承树」的心智模型换成 TS 的「类型 = 形状描述」。
> 这是全书最重要的一章 —— 后面所有代码的写法都取决于你有没有真正接受这个模型。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 类型兼容判定 | **名义**：必须 `implements` / 显式声明 | **结构**：形状对得上就兼容（鸭子类型） | 🔴 高 |
| 类型的运行时存在 | 有 `getClass()` / `reflect` | **完全不存在**，编译后类型全部消失 | 🔴 高 |
| 强制类型转换 | `(Foo) x` 失败抛 `ClassCastException` | `x as Foo` **零运行时检查**，错了不报 | 🔴 高 |
| 「A 或 B」 | 抽象类 / sealed interface / `interface{}` | **联合类型 `A \| B`**，语言原生 | 🔴 高 |
| 未知数据的入口 | `Object` | `unknown`（安全），不是 `any`（会传染） | 🔴 高 |
| 枚举穷尽性 | Java switch 漏分支只是警告 | `never` + `assertNever` → **编译报错** | 🟡 中 |
| 泛型擦除 | 擦除，但有 `Class<T>` 兜底 | 擦得更彻底，**连 `getClass()` 都没有** | 🟡 中 |
| 不可变 | `final` / 无 | `readonly` / `as const`（**只在编译期**） | 🟡 中 |
| 类型级计算 | 没有 | 映射类型 / 条件类型 / 模板字面量类型 | 🟢 低 |

---

## 1. 结构化类型：本章第一观念

Java 里一个类要能当 `Comparable` 用，必须写 `implements`。Go 松一点（隐式实现），
但也仅限方法集。**TS 完全看形状**：属性和方法对得上就是同一个类型，不需要任何声明。

```ts
interface Logger { info(msg: string): void; }
// 没有 implements Logger，但它就是一个 Logger
const consoleLogger = { info(msg: string) { console.error(`[info] ${msg}`); } };
function run(logger: Logger): void { logger.info('started'); }
run(consoleLogger);   // ✅ 形状匹配，直接能传
```

三个日常收益：给第三方库补类型不用改它的源码；测试里造 mock 不需要框架
（`const fake: Logger = { info: () => {} }`）；**参数只声明真正用到的字段**（写 `{ size: number }`
而不是 `FileEntry`），函数复用范围立刻变大。

### 坑 1：多余属性检查（excess property check）只对字面量触发

TS 允许「多的属性」，但**对直接写出来的对象字面量额外查一次**，因为那多半是拼错字段：

```ts
interface Options { retries?: number; timeoutMs?: number; }
const a: Options = { retries: 3, timeouMs: 100 };  // ❌ 报错：拼错了，'timeouMs' 不在 Options 里
const raw = { retries: 3, timeouMs: 100 };
const b: Options = raw;         // ✅ 通过！😱 变量不触发这个检查，拼写错误被静默放过
```

**规则：字面量直接传 = 严格；先落到变量再传 = 宽松。** 配置对象尽量以字面量形式直接传；想两头兼得，用 §9 的 `satisfies`。

### 坑 2：形状相同 = 可以互换，哪怕语义完全不同

`type UserId = { value: string }` 和 `type OrderId = { value: string }` 在 TS 里是**同一个类型**，
可以互相传 —— Java 里它们是两个类，天然不可互换。TS 要手动**模拟名义类型**（nominal typing），
惯用法是 **branded type**：

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, 'UserId'>;
// smart constructor：全项目唯一能造出 UserId 的地方，校验集中在这里
function toUserId(raw: string): UserId | null {
  return /^u_[a-z0-9]{4,}$/.test(raw) ? (raw as UserId) : null;   // as 只出现在这里
}
function loadUserById(id: UserId): void {}
const s = 'u_a1b2';
// loadUserById(s);                // ❌ string 不能当 UserId，编译期就拦住
const id = toUserId(s);
if (id != null) loadUserById(id);  // ✅
```

`__brand` **只存在于类型层面**，运行时 `typeof id === 'string'`，零包装开销 ——
相当于免费拿到了 Java `record UserId(String value)` 的安全性。

---

## 2. `interface` 还是 `type`？

| 能力 | `interface` | `type` |
| --- | --- | --- |
| 描述对象 / 函数形状 | ✅ | ✅ |
| 联合类型 `A \| B` | ❌ | ✅ |
| 组合 | `extends A, B` | `A & B` |
| 元组、字面量、原始类型别名 | ❌ | ✅ `type Port = number` |
| 映射类型 / 条件类型 | ❌ | ✅ |
| 声明合并（declaration merging） | ✅ | ❌（重名直接报错） |

**声明合并**是 `interface` 独有的：同名 interface 自动合并，主要用来给第三方类型打补丁
（例如 `declare global { namespace NodeJS { interface ProcessEnv { OPENAI_API_KEY?: string } } }`
给 `process.env` 补上你自己的变量）。

> ⚠️ 双刃剑：`type` 重名立刻报错，`interface` 会默默合并。

**实践建议（本教程统一遵守）**：**对象形状用 `interface`**（可扩展、报错好读、社区默认）；**其它
一切用 `type`**（联合、交叉、元组、函数类型、工具类型、字面量别名）。

---

## 3. 联合类型 `A | B`：TS 最锋利的武器

Java/Go **没有对应物**，这是转过来最需要重建的直觉：

| 需求 | Java | Go | TypeScript |
| --- | --- | --- | --- |
| 「字符串或数字」 | `Object` + instanceof | `interface{}` + type switch | `string \| number` |
| 「成功或失败」 | 异常 / `Either` 库 | `(T, error)` 双返回值 | `Ok<T> \| Err<E>` |
| 「A、B、C 之一」 | sealed interface + 3 个 record | interface + 3 个实现 | `A \| B \| C` |

```ts
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';   // 字面量联合，比 enum 更常用
function describe(x: string | number): string {
  // x.toUpperCase();   // ❌ 联合类型上只能访问【所有成员都有】的成员
  return x.toString();  // ✅ 其余必须先收窄（§6）
}
```

> 心态转变：Java 里你会本能地建继承树，TS 里**先想能不能用联合类型平铺**。
> 数据建模用联合，行为复用才用继承。联合类型也是 TS 代替方法重载的方式（第 01 章 §9）。

---

## 4. 交叉类型 `A & B`

`A & B` = 同时满足两者，**属性取并集**（注意和联合类型直觉相反）：

```ts
interface Timestamps { createdAt: number; updatedAt: number; }
type StoredUser = { id: string; name: string } & Timestamps;     // 4 个属性都必须有
type Middleware = ((req: string) => string) & { name: string };  // 给函数类型挂属性
type Broken = { v: string } & { v: number };   // 😱 v 变成 never，这种类型永远构造不出来
```

---

## 5. 字面量类型 + 可辨识联合：代替 sealed class / type switch

字面量类型指「值本身就是类型」：`let m: 'GET' = 'GET'`、`type HttpOk = 200 | 201 | 204`。
把它作为公共字段放进联合类型，就得到**可辨识联合**（discriminated union），TS 里最重要的建模模式：

```ts
type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E };
function readPort(raw: string): Result<number, string> {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { kind: 'err', error: `非法端口: ${raw}` };
  return { kind: 'ok', value: n };
}
const r = readPort('8080');   // r.value ❌ 收窄之前不许访问，编译器逼你先判断
if (r.kind === 'ok') console.log(r.value);      // ✅ 这里只有 value
else console.error(r.error);                    // ✅ 这里只有 error
```

| Java | Go | TypeScript |
| --- | --- | --- |
| `sealed interface` + `record Ok/Err` + switch 模式匹配（21+） | `(int, error)` + `if err != nil` | `Result<T, E>` + `if (r.kind === 'ok')` |

**关键优势：每个分支可以携带完全不同的字段**，这是「一个大 class 塞一堆可空字段」比不上的：

```ts
type TaskState =
  | { kind: 'idle' }                            // 无额外字段
  | { kind: 'running'; startedAt: number }      // 只有它有 startedAt
  | { kind: 'done'; durationMs: number }
  | { kind: 'failed'; reason: string };
// 编译器保证：除了 kind === 'running' 的分支拿不到 startedAt，于是不用到处写 `!` 非空断言。
```

> 约定：辨识字段统一叫 `kind` 或 `type` 且**用字符串字面量**；`{ ok: true } | { ok: false }` 也能工作，但加第三种状态时就废了。

---

## 6. 类型收窄（narrowing）：编译器会读你的 if

控制流分析会跟着你的 `if` 走。以下 8 种手段要全部掌握：

```ts
function handle(x: unknown): string {
  if (typeof x === 'string') return x.toUpperCase();     // ① typeof：只能判 8 种基础类型
  if (typeof x === 'number') return x.toFixed(2);
  if (Array.isArray(x)) return `array(${x.length})`;     // ② 数组唯一正确判法
  if (x instanceof Error) return x.message;              // ③ instanceof：只对 class 有效
  if (x == null) return 'empty';                         // ④ 真值 / 判空收窄
  if (typeof x === 'object' && 'code' in x) return String(x.code);  // ⑤ in：按属性存在收窄
  return 'unknown';
}
// ⑥ 字面量比较：`if (s.kind === 'running')` 之后才能访问 s.startedAt —— 可辨识联合的基础（§5）

// ⑦ 自定义类型守卫：返回类型写 `x is T`
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((i) => typeof i === 'string');
}
const data: unknown = ['a', 'b'];
if (isStringArray(data)) data.join(',');    // ✅ data 在这里是 string[]

// ⑧ 断言函数：返回 `asserts x is T`，不返回 boolean，不满足就抛
function assertString(v: unknown): asserts v is string {
  if (typeof v !== 'string') throw new TypeError(`expected string, got ${typeof v}`);
}
declare const raw: unknown;    // 假设这是外部传进来的数据
assertString(raw);
raw.toUpperCase();             // ✅ 这一行之后 raw 就是 string
```

> 😱 **类型谓词是你对编译器的承诺，编译器不验证它。** 守卫里写 `return true` 也能编译，然后运行时
> 炸在别处，所以必须逐项老实检查，复杂结构交给 `zod`（第 07 章）。另外：断言函数**必须有显式返回
> 类型标注**（箭头函数 + 推断会失效）；收窄在被重新赋值的 `let` 和某些回调里会失效，先存进 `const` 最稳。

---

## 7. `never` 与穷尽性检查

`never` 表示「不可能有值」，是所有类型的子类型。它最大的实战价值是**帮你抓漏掉的分支**：

```ts
function assertNever(value: never): never {
  throw new Error(`unexpected variant: ${JSON.stringify(value)}`);
}
function render(s: TaskState): string {
  switch (s.kind) {
    case 'idle': return '空闲';
    case 'running': return `运行中（${s.startedAt}）`;
    case 'done': return `完成，用时 ${s.durationMs}ms`;
    case 'failed': return `失败：${s.reason}`;
    default: return assertNever(s);        // ✅ 这里 s 的类型已经是 never
  }
}
```

给 `TaskState` 加一个 `{ kind: 'canceled' }`，上面那行立刻**编译报错**
（`Argument of type '{ kind: "canceled"; }' is not assignable to parameter of type 'never'`），逼你回来补分支。

| Java | TypeScript |
| --- | --- |
| switch on enum 漏分支：默认只是警告，运行时静默走 default | 漏分支 = **编译失败**，改类型时不可能忘 |
| `default: throw new IllegalStateException()`：运行时才发现 | `assertNever`：编译期发现 + 运行时兜住脏数据 |

---

## 8. `any` vs `unknown` vs `never`

| | 含义 | 能赋给它 | 它能赋给别人 | 何时用 |
| --- | --- | --- | --- | --- |
| `any` | 关闭类型检查 | 任何值 | **任何类型** 😱 | 基本不用 |
| `unknown` | 「有值，但不知道是什么」 | 任何值 | 只能给 `unknown` / `any` | **所有外部数据入口** |
| `never` | 「不可能有值」 | 无 | 任何类型 | 穷尽性检查、不返回的函数 |

```ts
const a: any = JSON.parse('{}');
a.foo.bar.baz();          // 😱 编译通过，运行时 TypeError
const u: unknown = JSON.parse('{}');
// u.foo;                 // ❌ 报错：必须先收窄
if (typeof u === 'object' && u !== null && 'foo' in u) { /* 现在能用了 */ }

// 😱 any 会传染，顺着调用链把整片代码的检查腐蚀掉：
function parseConfig(raw: any) { return { port: raw.port }; }   // 入口用了 any
parseConfig('{}').port.toUpperCase();   // port 也变成 any，编译通过，运行时炸
function parseJson(text: string): unknown { return JSON.parse(text); }  // ✅ 正确的入口签名
```

**铁律**：`JSON.parse`、`process.env`、命令行参数、HTTP 响应、LLM 返回内容 —— 一律先当 `unknown`，
用类型守卫或 `zod` 校验后再往下传。

> `unknown` 像 Java 的 `Object` 但更严：`Object` 上还能调 `toString()`，`unknown` 上什么都不能做。

---

## 9. 泛型：语法像 Java，运行时差别巨大

### 差异 1：没有任何运行时类型信息

Java 泛型也擦除，但你还有 `Class<T>` / `getClass()` / 反射兜底，**TS 什么都没有**：

```ts
// function create<T>(): T { return new T(); }   // ❌ 语法都不成立：T 在运行时根本不存在
// 需要运行时类型信息？只能把「运行时的东西」显式传进来（≈ Java 传 Class<T>）：
function createBy<T>(factory: () => T): T { return factory(); }
function isInst<T>(v: unknown, c: new (...a: never[]) => T): v is T { return v instanceof c; }
```

### 差异 2：约束是「结构」的，还能约束到属性名

```ts
// Java 的 <T extends Comparable<T>> 要求 implements；TS 的约束只看形状：
function sum<T extends { valueOf(): number }>(xs: readonly T[]): number {
  return xs.reduce((acc, x) => acc + x.valueOf(), 0);   // 任何有 valueOf 的类型都能进来
}
// keyof 约束："key 必须是该对象的属性名"，Java 完全表达不了
function getField<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const port = getField({ host: 'h', port: 80 }, 'port');  // 类型精确是 number
// getField({ host: 'h' }, 'nope');                      // ❌ 编译期就拦住
```

### 差异 3：默认类型参数 + 多参数一起推断

```ts
type Handler<TIn, TOut = void> = (input: TIn) => TOut;   // 默认类型参数 TOut = void
function zip<A, B>(as: readonly A[], bs: readonly B[]): Array<[A, B]> {
  return as.map((a, i) => [a, bs[i]!] as [A, B]);
}
const pairs = zip(['a', 'b'], [1, 2]);   // Array<[string, number]>，A、B 一起推出来
```

> 经验：**先不写类型参数，让推断跑**；只有推不出来（空数组、只出现在返回值里）才手写。

### `satisfies`：既校验又不丢精度（TS 4.9+，极其实用）

```ts
interface CommandSpec { summary: string; args: readonly string[]; }
// 写法 A：类型标注 —— 校验了，但类型被"放宽"：keyof typeof a 只剩 string，a.run 还可能 undefined
const a: Record<string, CommandSpec> = { run: { summary: 'x', args: ['task'] } };
// 写法 B：satisfies —— 校验 + 保留精确推断 ✅
const COMMANDS = {
  init: { summary: '初始化', args: [] },
  run: { summary: '执行任务', args: ['task'] },
} as const satisfies Record<string, CommandSpec>;
type CommandName = keyof typeof COMMANDS;   // 'init' | 'run' ✅ 精确
// COMMANDS.run.args[0] 的类型是 'task'（字面量），不是 string
```

**规则：配置对象、常量表、路由表 —— 一律 `as const satisfies X`。** 它同时解决了
「拼错字段没人管」（§1 坑 1）和「类型被放宽」两个问题。

---

## 10. 工具类型速览（每天都会用到）

```ts
interface User { id: string; name: string; age?: number; tags: string[]; }
const u = { id: '1', role: 'admin' } as const;
async function load(id: string): Promise<User[]> { return []; }

type K = keyof User;                  // 'id' | 'name' | 'age' | 'tags'
type U = typeof u;                    // 在【类型位置】用 typeof 取一个值的类型
type Name = User['name'];             // string —— 索引访问类型 T[K]
type Tag = User['tags'][number];      // string —— 用 number 当下标取数组元素类型
type P = Partial<User>;               // 全变可选        | type R = Required<User>;  全变必填
type RO = Readonly<User>;             // 全加 readonly   | type ById = Record<string, User>;
type Small = Pick<User, 'id' | 'name'>;           // 只保留这两个
type NoId = Omit<User, 'id'>;                     // 去掉 id
type Str = Extract<'a' | 'b' | 1, string>;        // 'a' | 'b' —— 从联合里筛出
type NotA = Exclude<'a' | 'b' | 'c', 'a'>;        // 'b' | 'c' —— 从联合里剔除
type S = NonNullable<string | null | undefined>;  // string
type Ret = ReturnType<typeof load>;               // Promise<User[]>
type Loaded = Awaited<ReturnType<typeof load>>;   // User[] —— 拆掉 Promise
type Args = Parameters<typeof load>;              // [id: string]
```

> `Omit` 有个坑：它**不检查** key 是否真的存在，`Omit<User, 'nope'>` 不报错也不生效。

---

## 11. 映射类型、条件类型、模板字面量类型（看懂就够）

**映射类型** = 遍历一个类型的所有 key 批量改造；**条件类型** = 类型层面的三元表达式，`extends`
读作「是不是子类型」；**模板字面量类型** = 字符串拼接发生在类型层面。这些是**库作者**的日常工具，
业务代码里能不用就不用 —— 一个看不懂的类型比一个 `any` 更让同事痛苦。

```ts
type MyPartial<T> = { [K in keyof T]?: T[K] };        // 映射类型：Partial 就是这么实现的
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };
// Getters<{ id: string }> === { getId: () => string }  ← as 子句能重命名 key
type IsString<T> = T extends string ? true : false;   // 条件类型：IsString<'x'> = true
type MyReturnType<F> = F extends (...args: never[]) => infer R ? R : never;  // infer 抓出一部分
type MyExclude<T, U> = T extends U ? never : T;       // 对联合类型自动分发：<'a'|'b', 'a'> = 'b'
type EnvKey = `APP_${Uppercase<'debug' | 'info'>}`;   // 模板字面量：'APP_DEBUG' | 'APP_INFO'
type Route = `/api/${string}`;
const ok: Route = '/api/users';              // ✅  const bad: Route = '/users';  // ❌
```

---

## 12. `as const`、`readonly`，以及 `as` 的危险性

```ts
const methods = ['GET', 'POST'];             // string[]
const methods2 = ['GET', 'POST'] as const;   // readonly ['GET', 'POST']，元素是字面量类型
type Method = (typeof methods2)[number];     // 'GET' | 'POST' ← 从常量表推导类型的标准套路
const cfg = { host: 'h', port: 80 } as const;
// cfg.port = 90;                            // ❌ readonly，编译期拦住
function join(parts: readonly string[]): string {   // 参数用 readonly = 声明"我不改你的数组"
  return parts.join('/');                           // 函数体里 parts.push(...) 会编译报错
}
```

⚠️ **`readonly` / `as const` 只在编译期生效**，运行时对象照样可改（`(cfg as any).port = 90`）；
需要运行时冻结用 `Object.freeze()`。

### `as` 断言：和 Java 的 cast 是两回事

| Java | TypeScript |
| --- | --- |
| `(Foo) obj` 有**运行时检查**，不匹配抛 `ClassCastException` | `obj as Foo` **编译后完全消失**，没有任何检查 |
| 强转失败 = 立刻炸在强转处，栈很清楚 | 断言错了 = 在**很远的地方**炸，甚至静默产出错数据 |

```ts
const raw: unknown = JSON.parse('{"id": 1}');
const user = raw as { name: string };    // 😱 编译通过
user.name.toUpperCase();                 // 💥 运行时 TypeError
```

**`as` 只有三种正当用法**：① 刚做过运行时校验（branded type 的 smart constructor）；
② 收窄 `unknown` 时告诉编译器一个你已确认的事实；③ `as const`（只是"别放宽字面量"，完全安全）。
其余都该换成类型守卫或 `zod`。同理 `!` 非空断言也是承诺，能用 `?.` / `??` 就别用。

---

## 13. 什么时候写类型，什么时候靠推断

**一定要写：** 导出函数的**参数和返回值**（模块契约，也让报错落在函数内部而不是调用处）；空数组 /
空对象初值 `const users: User[] = []`（否则推成 `never[]`）；以后要改值的变量
`let conn: Connection | null = null`；外部数据入口 `(text: string): unknown`。

**不要写：** 有初值的局部变量（`const port = 8080` 写 `: number` 纯噪音）；回调参数
（`items.map((item) => ...)` 一定推得出来）；泛型调用的类型参数（`first([1,2,3])` 不用写
`<number>`）；常量表（用 `as const satisfies X`，而不是 `: X`）。

```ts
export function summarize(rows: readonly TaskState[]): Record<string, number> {
  const counts: Record<string, number> = {};    // 空对象要标注，否则推不出来
  for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;   // row 靠推断
  return counts;
}
```

> 一句话：**边界写死，内部放开** —— 和 Go 里「函数签名写全、函数体用 `:=`」是同一套哲学。

---

## 本章练习

```bash
# 1. 打开 exercises/ch02-types.ts，把所有 TODO 填掉
pnpm test tests/ch02        # 跑测试
pnpm vitest tests/ch02      # watch 模式（改一个存一次自动重跑，推荐）
pnpm typecheck              # 本章有纯类型题（文件底部的 Expect<...> 断言），务必也跑这个
# 2. 卡住超过 10 分钟 → 看 solutions/ch02-types.ts
```

练习覆盖：结构化类型与多余属性检查、类型守卫 `x is T`、`unknown` 安全解析、branded type、可辨识联合
+ `assertNever` 穷尽性检查（表达式求值器 / 状态机）、`Result<T, E>` 的 `mapResult` / `andThen` /
`unwrapOr`、泛型 `groupBy` 与 `pick`、`as const satisfies` + `keyof typeof`。

---

**下一章** → [03 · 数据结构：Array / Object / Map / Set 与解构](./03-data-structures.md)
