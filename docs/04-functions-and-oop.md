# 04 · 函数与面向对象：闭包、`this`，以及「class 为什么用得比 Java 少」

> 本章目标：把 Java/Go 带来的「一切皆类 / 一切皆 struct+method」的肌肉记忆掰过来。
> TS 里**函数才是第一公民**，`class` 只是可选特性。另外要处理一个 Java/Go 都不存在的问题：
> **`this` 会丢**。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| `this` 绑定 | 编译期绑定到接收者，永不改变 | **调用方式决定 `this`**，方法传出去就丢 | 🔴 高 |
| 方法引用 | `obj::method` 自动带接收者 | `obj.method` **不带**接收者，要 `bind` 或箭头字段 | 🔴 高 |
| 闭包捕获 | Java 只能捕获 effectively final 变量 | 捕获**变量本身**，可读可写 | 🔴 高 |
| `private` | 运行时强制 | 只是**编译期**；真私有是 `#field` | 🔴 高 |
| 对象相等 | `equals` / `hashCode` | **没有**，`===` 只比引用，要自己写 | 🔴 高 |
| 函数类型 | `Function<T,R>` / 函数式接口 | 原生类型 `(a: number) => string` | 🟡 中 |
| 抽象类 | 运行时不可实例化 | `abstract` 被擦除，`as any` 后能 `new` | 🟡 中 |
| 面向接口 | 必须显式 `implements` | **结构化类型**，不写 `implements` 也能替换 | 🟡 中 |
| 重载 | 多个实现 | 多个**签名** + 一个实现 | 🟡 中 |
| `final` / 内部类 / 包私有 | 都有 | **都没有**（模块不导出 ≈ 包私有） | 🟡 中 |
| 构造器赋值字段 | 手写 `this.x = x` | **参数属性** `constructor(private x: string)` | 🟢 低 |
| 继承 | `extends` 一个 + `implements` 多个 | 完全一样 | 🟢 低 |

---

## 1. 函数是一等公民

Java 里传行为要绕道 `Function<T,R>` 这类函数式接口，Go 有 `func(int) string`。
TS 把函数类型内置进类型系统，写法是 `(参数: 类型) => 返回类型`（注意是 `=>`，不是 `:`）：

```ts
type Mapper = (input: string) => number;
const parse: Mapper = (s) => Number(s);   // ✅ 参数类型能从 Mapper 推出来，不用重复写

// 函数随便存进对象 / Map —— 这就是 TS 版策略模式，不需要接口 + 3 个实现类
const handlers: Record<string, (arg: string) => string> = {
  upper: (s) => s.toUpperCase(),
  reverse: (s) => [...s].reverse().join(''),
};
handlers['upper']?.('abc');                                  // 'ABC'
const tools = new Map<string, (input: string) => Promise<string>>();   // Agent 工具注册表
```

| Java | TypeScript |
| --- | --- |
| `Function<String,Integer>` | `(s: string) => number` |
| `Supplier<T>` / `Consumer<T>` | `() => T` / `(v: T) => void` |
| `Predicate<T>` / `Runnable` | `(v: T) => boolean` / `() => void` |
| `Comparator<T>` | `(a: T, b: T) => number` |
| `@FunctionalInterface` + 一个方法 | 直接 `type F = (a: A) => R` |

`interface` 也能描述函数（**可调用签名**，对应函数式接口），好处是能顺便挂属性 ——
因为函数本身就是对象，Java/Go 都做不到：

```ts
interface Middleware {
  (req: string): string;        // 可调用签名
  readonly label: string;       // 顺便挂个名字，日志里能打出来
}
const trim: Middleware = Object.assign((req: string) => req.trim(), { label: 'trim' });
// 😱 别挂名叫 name 的属性：函数自带只读的 .name，Object.assign 会在运行时抛 TypeError
```

---

## 2. 闭包：Java/Go 开发者最容易低估的特性

闭包 (closure) = 函数 + 它定义时所处的作用域。**关键：捕获的是「变量本身」，不是「值的快照」。**

```ts
function makeCounter(): () => number {
  let count = 0;              // ← 被闭包捕获，函数返回后依然活着
  return () => {
    count += 1;               // ✅ 可以【修改】捕获的变量
    return count;
  };
}
const next = makeCounter();
next(); next();               // 1, 2
makeCounter()();              // 1 ← 每次调用都是一份独立状态
```

**与 Java 的重大差异**：

| Java | TypeScript |
| --- | --- |
| lambda 只能捕获 **effectively final** 变量 | 捕获任意 `let`，而且**能改** |
| 想累加得用 `AtomicInteger` / 长度 1 的数组绕开 | 直接 `count += 1` |
| 匿名内部类捕获的是值的副本 | 捕获的是变量的引用 |

Go 的闭包语义和 TS 一致（都捕获变量），所以 Go 开发者会亲切一些，但共享同一个坑：

```ts
const bad: Array<() => number> = [];
for (var i = 0; i < 3; i++) bad.push(() => i);
bad.map((f) => f());          // [3, 3, 3] 😱 var 是函数作用域，全世界只有一个 i
const good: Array<() => number> = [];
for (let j = 0; j < 3; j++) good.push(() => j);
good.map((f) => f());         // [0, 1, 2] ✅ let 每轮迭代都是一个新绑定
```

> **永远用 `let`/`const`，循环里的闭包就不会出问题。**（Go 1.22 才把 `for` 变量改成每轮一份。）

**闭包 = 不需要 class 的私有状态**。Java 里"有状态但只有一个方法"的东西你会写成类，TS 里工厂函数就够：

```ts
function memoizeOne<A, R>(fn: (arg: A) => R): (arg: A) => R {
  const cache = new Map<string, R>();          // 藏在闭包里，外部无论如何拿不到
  return (arg: A): R => {
    const key = String(arg);
    if (cache.has(key)) return cache.get(key) as R;   // ✅ 用 has
    // ❌ if (cache.get(key)) —— 缓存值是 0 / '' / undefined 时永远命中不了
    const value = fn(arg);
    cache.set(key, value);
    return value;
  };
}

// 限流器：把"当前时间"作为依赖注入，测试里喂假时钟，不必依赖真实计时器
function rateLimiter(max: number, windowMs: number, now: () => number): () => boolean {
  let windowStart = now();
  let used = 0;
  return (): boolean => {
    const t = now();
    if (t - windowStart >= windowMs) { windowStart = t; used = 0; }   // 开新窗口
    if (used >= max) return false;
    used += 1;
    return true;
  };
}
```

⚠️ **代价**：被捕获的变量不会被 GC 回收。长生命周期的闭包捕获了大对象（整个响应体）就是内存泄漏
—— 和 Java 匿名内部类隐式持有外部 `this` 是同一类问题。

---

## 3. `this` 的四种绑定规则

Java/Go 里接收者编译期就定了。TS/JS 里 **`this` 由「调用方式」决定**，四条规则优先级从低到高：

```ts
function show(this: unknown, tag: string): void { console.log(tag, this); }

show('default');                        // ① 默认绑定：模块是严格模式，this === undefined
const obj = { name: 'svc', show };
obj.show('implicit');                   // ② 隐式绑定：谁点出来的 this 就是谁 → obj
show.call({ name: 'A' }, 'call');       // ③ 显式绑定：call(thisArg, ...args)
show.apply({ name: 'B' }, ['apply']);   //    apply 的参数用数组传
const bound = show.bind({ name: 'C' }); //    bind 返回 this 被永久锁定的新函数
class Svc { constructor() { /* ④ new 绑定：this 是新实例，优先级最高 */ } }
```

**箭头函数不参与这四条规则**，它直接用**定义位置**的 `this`（词法 `this`）：

```ts
class Poller {
  private count = 0;
  bad(): void { setTimeout(function () { this.count += 1; }, 10); }  // ❌ this 是 undefined
  good(): void { setTimeout(() => { this.count += 1; }, 10); }       // ✅ 沿用 good 的 this
}
```

**经典坑：把方法当回调传出去。** 原因是 `t.run` 只是读属性，`.` 只在**调用那一刻**才提供 `this`：

```ts
class Task {
  constructor(private readonly name: string) {}
  run(): string { return `run ${this.name}`; }
}
const t = new Task('build');
t.run();                     // ✅ 'run build'
const fn = t.run;            // 😱 只取出函数值，丢了接收者
// fn();                     // TypeError: Cannot read properties of undefined (reading 'name')
const { run } = t;           // 😱 解构同理
setTimeout(t.run, 0);        // 😱 传回调同理（Java 的 obj::method 不会有这问题）
```

三种修复：

```ts
setTimeout(() => t.run(), 0);      // A. 箭头包一层：最省事，适合一次性回调
setTimeout(t.run.bind(t), 0);      // B. bind：得到 this 锁定的新函数
class Task2 {                      // C. 类字段写成箭头函数：适合"注定被当回调"的方法
  constructor(private readonly name: string) {}
  readonly run = (): string => `run ${this.name}`;   // 实例字段，this 构造时就绑死
}
const { run: r2 } = new Task2('build');
r2();                              // ✅ 'run build'，解构也不怕
```

> C 的代价：每个实例多一个函数对象，且子类无法 `super.run()`。
> **法则：会被当回调传出去的方法（事件、`map` 参数、CLI action）用类字段箭头函数，其余用普通方法。**

`this` 还能写成第一个**伪参数**（编译后消失），让编译器提前拦住你：

```ts
interface Handler { onDone(this: void, result: string): void }   // 这个回调里不许用 this
class Counter {
  count = 0;
  increment(this: Counter): void { this.count += 1; }            // 调用时 this 必须是 Counter
}
const inc = new Counter().increment;
// inc();   // ❌ 编译期就报错，比运行时炸掉好多了
```

---

## 4. 高阶函数与函数组合

```ts
const compose = <A, B, C>(g: (b: B) => C, f: (a: A) => B) => (a: A): C => g(f(a));   // 右→左
const pipe = <T>(...steps: Array<(v: T) => T>) => (v: T): T =>                       // 左→右
  steps.reduce((acc, step) => step(acc), v);

const slugify = pipe<string>((s) => s.trim(), (s) => s.toLowerCase(), (s) => s.replaceAll(' ', '-'));
slugify('  Hello World ');                              // 'hello-world'

const add3 = (a: number) => (b: number) => (c: number) => a + b + c;   // 柯里化 curry
add3(1)(2)(3);                                                         // 6
const log = (level: string, scope: string, msg: string) => `[${level}][${scope}] ${msg}`;
const dbInfo = (msg: string) => log('info', 'db', msg);                // 偏应用 partial
```

**装饰器式包装：TS 版的 AOP。** Java 里加重试、加计时靠 Spring AOP / 动态代理 / 注解处理器，
TS 里就是**函数包函数**：

```ts
function withRetry<Args extends unknown[], R>(fn: (...args: Args) => R, maxAttempts: number) {
  return (...args: Args): R => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try { return fn(...args); } catch (err) { lastError = err; }
    }
    throw lastError;              // ✅ 原样抛最后一次；包一层新 Error 会丢类型和堆栈
  };
}
function withTimingLog<Args extends unknown[], R>(fn: (...args: Args) => R, label: string) {
  return (...args: Args): R => {
    const start = Date.now();
    try { return fn(...args); } finally { console.error(`[${label}] ${Date.now() - start}ms`); }
  };
}
const loadUser = withTimingLog(withRetry(rawLoad, 3), 'loadUser');   // 想包几层就包几层
```

| Java | TypeScript |
| --- | --- |
| `@Retryable` + Spring AOP 代理 | `withRetry(fn, 3)` |
| 动态代理 / CGLIB 字节码增强 | 高阶函数返回新函数 |
| 装饰器模式（一堆包装类） | 一个返回函数的函数 |

**没有反射、没有代理、没有容器** —— 这是 TS 生态最舒服的一点。

---

## 5. class：语法速览

```ts
class UserService {
  private cache = new Map<string, string>();       // 字段可以直接给初值
  readonly createdAt = Date.now();                 // readonly ≈ Java 的 final 字段
  static readonly VERSION = '1.0';
  static #count = 0;                               // 静态 + 运行时私有
  static { /* 静态初始化块，和 Java 一样 */ }

  constructor(
    private readonly baseUrl: string,              // 👈 参数属性：声明 + 赋值一步到位
    protected timeoutMs = 3000,
  ) { UserService.#count += 1; }

  get size(): number { return this.cache.size; }   // getter/setter：调用时【不写括号】
  set endpoint(_v: string) {}
  async load(id: string): Promise<string> { return `${this.baseUrl}/${id}`; }
}
const svc = new UserService('http://x');           // 必须 new（没有 Go 的零值 struct）
svc.size;                                          // 👈 不写 ()
```

**参数属性**是 Java/Go 都没有的糖：构造函数参数上加修饰符
（`private`/`protected`/`public`/`readonly` 任选），TS 自动声明并赋值，字段名不用写三遍：

```ts
class RepoVerbose {                                // ❌ Java 风格
  private readonly db: string;
  constructor(db: string) { this.db = db; }
}
class Repo { constructor(private readonly db: string) {} }   // ✅ 完全等价，一行
```

> `accessor` 关键字（TS 4.9+）是 `get/set` + 私有存储的语法糖，用得极少，见到再查。

**字段初始化顺序**：基类字段 → 基类构造器体 → 子类字段 → 子类构造器体。

```ts
class Base {
  constructor() { this.init(); }        // 基类构造器里调用被重写的方法
  protected init(): void {}
}
class Child extends Base {
  private ready = true;                 // 在 super() 返回【之后】才初始化
  protected override init(): void { console.log(this.ready); }   // 😱 undefined
}
```

和 Java 一样的坑（Java 里打印 `false`），解法也一样：**别在构造器里调用可重写方法**。

---

## 6. `private` 是编译期的，`#private` 才是运行时的 🔴

本章最重要的一条差异。

```ts
class TsPrivate { private secret = 42; }
const a = new TsPrivate();
// a.secret;                                          // ❌ 编译报错
(a as unknown as { secret: number }).secret;          // 😱 42，运行时照样读到
Object.keys(a);                                       // ['secret'] 😱 会被枚举
JSON.stringify(a);                                    // '{"secret":42}' 😱 序列化泄漏

class JsPrivate {
  #secret = 42;                                       // ES 标准私有字段
  peek(): number { return this.#secret; }             // 只有类体内部能访问
  static has(v: object): boolean { return #secret in v; }   // ✅ 品牌检查，比 instanceof 可靠
}
Object.keys(new JsPrivate());                         // [] ✅
JSON.stringify(new JsPrivate());                      // '{}' ✅ 不会泄漏
```

| | `private x` | `#x` |
| --- | --- | --- |
| 谁检查 | TypeScript 编译器 | JS 引擎（运行时） |
| `as any` 能绕过 | ✅ 能 | ❌ 属性根本不存在 |
| `Object.keys` / `JSON.stringify` | 会出现 | 不会出现 |
| 子类能访问 | `protected` 可以 | 永远不行（没有 `#protected`） |

**建议**：业务代码内部用 `private` 够了（可读、能配合 `protected`）；
**要发布 npm 包、防止别人依赖内部实现、或对象会被 `JSON.stringify` 的，用 `#`。**

---

## 7. 继承、抽象类与接口

```ts
abstract class Formatter {
  abstract readonly id: string;                        // 抽象字段（Java 没有）
  protected abstract renderRow(row: string): string;   // 抽象方法
  render(rows: readonly string[]): string {            // 模板方法：可以调用抽象成员
    return rows.map((r) => this.renderRow(r)).join('\n');
    // ⚠️ 不能写 rows.map(this.renderRow)，会丢 this（§3 那个坑）
  }
}
interface Named { readonly id: string }
interface Closeable { close(): void }

// extends 只能一个，implements 可以多个（和 Java 完全一致）
class CsvFormatter extends Formatter implements Named, Closeable {
  override readonly id = 'csv';
  protected override renderRow(row: string): string { return row.replaceAll(',', ';'); }
  close(): void {}
}
new CsvFormatter() instanceof Formatter;               // true，和 Java 一致

const Sneaky = Formatter as unknown as new () => Formatter;
new Sneaky();      // 😱 abstract 只是编译期概念，运行时成功了！Java 会 InstantiationError
```

本项目开了 `noImplicitOverride`：**重写基类的具体方法必须写 `override`**（实现抽象成员时可省）。
好处是基类改名字时子类立刻报错，而不是静默变成一个新方法 —— Java `@Override` 想解决的问题，
这里是强制的。`super.method()` 用法和 Java 一样。

| 需求 | 选 interface 还是 abstract class |
| --- | --- |
| 只描述"形状"，不带实现 | `interface` / `type` |
| 需要共享实现、模板方法 | `abstract class` |
| 需要运行时 `instanceof` | `class`（`interface` 运行时不存在！） |

**TS 特有现象**：因为是结构化类型（duck typing），"面向接口编程"往往退化成"面向类型编程" ——
**根本不需要写 `implements`**：

```ts
interface Clock { now(): number }
class SystemClock { now(): number { return Date.now(); } }   // 没写 implements Clock
function tick(c: Clock): number { return c.now(); }
tick(new SystemClock());        // ✅ 形状对得上就行
tick({ now: () => 0 });         // ✅ 对象字面量也行 —— 测试 mock 就这么写，不需要 Mockito
```

`implements` 的唯一作用是**让编译器在类定义处就地校验**（而不是等到使用处才报错）。
推荐写上，但它不影响类型兼容性。

---

## 8. 没有 `equals`，也没有 `final` / 内部类 / 包私有

```ts
class Point { constructor(readonly x: number, readonly y: number) {} }
new Point(1, 2) === new Point(1, 2);        // false 😱 只比引用，没有 equals 可重写
```

三种替代：① 自己写 `equals(other: Point): boolean` 方法；
② `import { isDeepStrictEqual } from 'node:util'` 做深比较（测试里用 `expect(...).toEqual`）；
③ 要当 `Map`/`Set` 的键就**自己拼 string 键** —— `Map` 用 `===` 比键，没有 `hashCode` 钩子。

其它别找了：**没有 `final class`**（不想被继承就别导出，或改用工厂函数）、
**没有内部类/匿名内部类**（用闭包或普通对象）、**没有包私有**（模块不导出就是私有，第 05 章）、
`toString()` 默认是没用的 `'[object Object]'`。

---

## 9. 为什么 TS 项目里 class 用得比 Java 少

Java 里**一切**都得放进类，因为语言不允许自由函数。TS 允许，所以：

```ts
class StringUtils { static slugify(s: string) { return s.trim(); } }   // ❌ Java 式工具类
export function slugify(s: string): string { return s.trim(); }        // ✅ 模块本身就是命名空间

class UserDto { constructor(readonly id: string) {} }                  // ❌ DTO 写成类
interface User { readonly id: string }                                 // ✅ JSON 进出零成本，
const u: User = { id: '1' };                                           //    class 还得手动 revive
```

**该用 class 的场景：**① 有状态的服务，需要多个实例 + 依赖注入（`Repository`/`ApiClient`/`Agent`）；
② 需要继承层次共享实现（上面的模板方法）；③ 需要 `#private` 做真封装的 SDK；
④ **`Error` 子类** —— 这个必须用 class，因为要靠 `instanceof` 分类：

```ts
class AppError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'AppError';        // ⚠️ 必须手动设，否则日志里显示 'Error'
  }
}
class NotFoundError extends AppError {
  constructor(readonly resource: string) {
    super(`${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}
function handle(err: unknown): string {
  if (err instanceof NotFoundError) return `404 ${err.resource}`;  // ⚠️ 子类判断必须写在前
  if (err instanceof AppError) return `app ${err.code}`;
  if (err instanceof Error) return `error ${err.message}`;
  return `unknown ${String(err)}`;      // catch 到的可能不是 Error！见第 07 章
}
```

**其余情况：普通对象 + 函数 + 闭包更简单，也更好测。**

---

## 10. 组合优于继承的 TS 写法

```ts
interface Clock { now(): number }
interface Store { get(k: string): string | undefined }

class SessionService {              // ① 依赖注入 = 构造函数参数，不需要 Spring / wire / 注解
  constructor(
    private readonly clock: Clock,  //    测试时传 { now: () => 1000 }
    private readonly store: Store,
  ) {}
  touch(id: string): string { return `${this.store.get(id) ?? 'new'}@${this.clock.now()}`; }
}

const logger = { log: (m: string) => console.error(m) };   // ② 对象组合：拼能力而不是继承
const worker = { ...logger, attempts: 3 };
worker.log(`retry ${worker.attempts}`);

const makeSession = (clock: Clock, store: Store) => ({     // ③ 函数式注入：连 class 都不要
  touch: (id: string): string => `${store.get(id) ?? 'new'}@${clock.now()}`,
});
```

> **mixin** 一句话：可以用「返回类的函数」实现
> （`const M = <T extends new (...a: any[]) => object>(B: T) => class extends B {}`），
> 类型体操重，业务代码几乎用不到，见到再查。

---

## 11. 约定方法与装饰器

JS 的很多"接口"靠**约定的方法名 / Symbol** 实现，一句话过一遍：

```ts
class Range {
  constructor(private readonly from: number, private readonly to: number) {}
  toString(): string { return `[${this.from},${this.to})`; }        // ≈ Java toString
  *[Symbol.iterator](): Iterator<number> {                         // ≈ Java Iterable，能 for...of
    for (let i = this.from; i < this.to; i += 1) yield i;
  }
  [Symbol.toPrimitive](hint: string): string | number {            // 转数字/字符串的钩子
    return hint === 'number' ? this.to - this.from : this.toString();
  }
}
console.log(`${new Range(1, 4)}`, [...new Range(1, 4)], +new Range(1, 4));  // '[1,4)' [1,2,3] 3
```

排序没有 `Comparable`，**传比较函数**：`arr.sort((a, b) => a.age - b.age)`（第 03 章）。

**装饰器 decorator**：TS 5 起支持 ECMAScript 标准装饰器（`@log` 那种）。写 CLI / Agent 基本用不上，
**遇到 NestJS / TypeORM 再学**，本教程不涉及。

---

## 本章练习

```bash
# 1. 打开 exercises/ch04-functions-oop.ts，把所有 TODO 填掉
pnpm test tests/ch04

# 2. watch 模式
pnpm vitest tests/ch04

# 3. 卡住了看 solutions/ch04-functions-oop.ts
```

练习覆盖：`compose`/`pipe` 组合、柯里化与偏应用、闭包私有状态（`once`/`memoize`）、
注入时钟做可测试的节流、高阶函数包装 `withRetry`、`this` 丢失的修复、`#private` 真封装、
抽象类模板方法、`Error` 子类 + `instanceof` 顺序、参数属性 + 重载签名。

---

**下一章** → [05 · 模块与工程化：ESM、包结构与构建发布](./05-modules-and-tooling.md)
