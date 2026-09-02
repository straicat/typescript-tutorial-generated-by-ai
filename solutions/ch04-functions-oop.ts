/**
 * 第 04 章参考答案 · 函数与面向对象
 * 每题都附带「为什么这么写 / 常见错法」的说明，看的时候重点看注释。
 */

// ---------- 4.1 ----------
export function compose<A, B, C>(g: (b: B) => C, f: (a: A) => B): (a: A) => C {
  // 返回箭头函数，A -> B -> C 的类型串联由泛型参数保证：
  // 如果把 g / f 的顺序写反，编译器立刻报错，不用等到运行时。
  return (a: A): C => g(f(a));
}

// ---------- 4.2 ----------
export function pipeAll<T>(...steps: ReadonlyArray<(value: T) => T>): (value: T) => T {
  // reduce 的初始值就是入参，所以 steps 为空时天然退化成恒等函数 —— 不需要特判。
  // 常见错法：用 for 循环但忘了把上一步的结果传给下一步。
  return (value: T): T => steps.reduce((acc, step) => step(acc), value);
}

// ---------- 4.3 ----------
export function curry3<A, B, C, R>(
  fn: (a: A, b: B, c: C) => R,
): (a: A) => (b: B) => (c: C) => R {
  // 每一层都是一个闭包，捕获住自己那个参数。
  // 因为 a / b 存在各自的闭包里而不是共享变量，所以 c(1) 拿到的 add1 可以反复复用。
  return (a: A) => (b: B) => (c: C) => fn(a, b, c);
}

// ---------- 4.4 ----------
export function once<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  // 用「装箱」的方式记录是否执行过：cache 是 undefined 表示没执行过。
  // 常见错法：`let result: R | undefined` + `if (result === undefined)` ——
  // 那样原函数返回 undefined 时会被反复执行。
  let cache: { value: R } | undefined;
  return (...args: Args): R => {
    cache ??= { value: fn(...args) };
    return cache.value;
  };
}

// ---------- 4.5 ----------
export function memoize<A, R>(
  fn: (arg: A) => R,
  keyOf: (arg: A) => string = (value) => String(value),
): (arg: A) => R {
  // cache 藏在闭包里：外部没有任何办法拿到它，比 private 字段还严实。
  const cache = new Map<string, R>();
  return (arg: A): R => {
    const key = keyOf(arg);
    // 必须用 has()。写成 `const hit = cache.get(key); if (hit) ...`
    // 会让缓存值为 0 / '' / undefined 的项永远命中不了。
    if (cache.has(key)) return cache.get(key) as R;
    const value = fn(arg);
    cache.set(key, value);
    return value;
  };
}

// ---------- 4.6 ----------
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
  now: () => number,
): (...args: Args) => boolean {
  // lastRunAt 用 undefined 表示"还没跑过"。不要用 0 当初始值：
  // 假时钟（或 performance.now()）完全可能就是 0。
  let lastRunAt: number | undefined;
  return (...args: Args): boolean => {
    const t = now();
    if (lastRunAt !== undefined && t - lastRunAt < intervalMs) return false;
    lastRunAt = t;
    fn(...args);
    return true;
  };
  // 把"当前时间"作为依赖注入进来，是让时间相关逻辑可单测的标准手法。
  // 直接调 Date.now() 的版本只能靠 vi.useFakeTimers() 才能测，麻烦得多。
}

// ---------- 4.7 ----------
export function withRetry<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  maxAttempts: number,
  onRetry?: (attempt: number, error: unknown) => void,
): (...args: Args) => R {
  // 参数校验放在【包装时】而不是调用时：错误尽早暴露，等价于 Java 构造器里的 Objects.requireNonNull。
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }

  return (...args: Args): R => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return fn(...args);
      } catch (err) {
        lastError = err;
        // ?.() 可选调用：onRetry 没传就什么都不做。
        onRetry?.(attempt, err);
      }
    }
    // 原样抛出最后一次的异常：包一层新 Error 会丢掉原始堆栈和类型，
    // 调用方就没法用 instanceof 分派了（见 4.11）。
    throw lastError;
  };
}

// ---------- 4.8 ----------
export class Greeter {
  constructor(private readonly prefix: string) {}

  // 关键：写成【类字段 + 箭头函数】而不是原型方法。
  // 箭头函数没有自己的 this，它捕获的是构造时的 this，所以
  //   const { greet } = new Greeter('Hi');  greet('Ann')   ✅
  //   names.map(this.greet)                                ✅
  // 都不会丢 this。
  //
  // 如果写成普通方法 `greet(name) { return `${this.prefix}...` }`，
  // 上面两种用法都会抛 TypeError: Cannot read properties of undefined。
  // 另外两种修法（() => g.greet(x) 包一层 / greet.bind(g)）需要调用方配合，
  // 这题要求"被解构后还能用"，所以只有类字段箭头函数能满足。
  readonly greet = (name: string): string => `${this.prefix}, ${name}!`;

  greetAll(names: readonly string[]): string[] {
    // 方法引用直接传给 map —— 这是对 this 是否绑定成功的最好检验。
    // 注意 map 会多传 (index, array) 两个参数，greet 只声明了一个形参，多余的会被忽略。
    return names.map(this.greet);
  }
}

// ---------- 4.9 ----------
export class BoundedStack<T> {
  // `#` 是 ECMAScript 标准私有字段：运行时真私有。
  // 换成 TS 的 `private` 会导致 Object.keys / JSON.stringify 把它暴露出去，
  // 而且 `as any` 就能改，本题的两个"真私有"断言会挂。
  #items: T[] = [];
  #capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#capacity = capacity;
  }

  // 用 getter 暴露只读视图：调用方写 s.capacity（不带括号），像字段一样自然。
  get capacity(): number {
    return this.#capacity;
  }

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    if (this.#items.length >= this.#capacity) {
      throw new RangeError('stack is full');
    }
    this.#items.push(item);
  }

  pop(): T | undefined {
    // 空数组 pop() 返回 undefined，不会像 Java 的 Stack 那样抛 EmptyStackException。
    return this.#items.pop();
  }

  peek(): T | undefined {
    // at(-1) 比 items[items.length - 1] 干净；开了 noUncheckedIndexedAccess 后
    // 两种写法的返回类型都是 T | undefined。
    return this.#items.at(-1);
  }

  toArray(): T[] {
    // 必须返回拷贝：直接 `return this.#items` 等于把内部数组的引用交出去，
    // 调用方一个 push 就能绕过容量限制（Java 里同样要 List.copyOf）。
    return [...this.#items];
  }
}

// ---------- 4.10 ----------
export interface ReportRow {
  readonly name: string;
  readonly count: number;
}

export abstract class ReportFormatter {
  abstract readonly id: string;

  protected abstract formatRow(row: ReportRow): string;

  // 模板方法（template method）：把"不变的流程"放基类，"变的一步"交给子类。
  // 这是 class 真正值得用的场景之一。
  render(rows: readonly ReportRow[]): string {
    if (rows.length === 0) return `${this.id}: (empty)`;
    // 注意 map 的回调必须写成箭头函数：这样 this 才是当前实例。
    // 写成 rows.map(this.formatRow) 会丢 this（和 4.8 是同一个坑）。
    return `${this.id}:\n${rows.map((row) => this.formatRow(row)).join('\n')}`;
  }
}

export class CsvFormatter extends ReportFormatter {
  // override 不是必须的（实现抽象成员时可省），但写上更清晰；
  // 本项目开了 noImplicitOverride，重写【具体】方法时必须写。
  override readonly id = 'csv';

  protected override formatRow(row: ReportRow): string {
    return `${row.name},${row.count}`;
  }
}

export class JsonLinesFormatter extends ReportFormatter {
  override readonly id = 'json';

  protected override formatRow(row: ReportRow): string {
    // 显式列出字段而不是 JSON.stringify(row)：这样键的顺序由我们决定，
    // 不受调用方对象字面量的书写顺序影响（JSON 输出是有序的）。
    return JSON.stringify({ name: row.name, count: row.count });
  }
}

// ---------- 4.11 ----------
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(
    readonly resource: string,
    readonly id: string,
  ) {
    // super 必须是构造器里第一句（在访问 this 之前）。
    // 注意：这里不能用 this.resource 拼 message —— 参数属性是在 super() 之后才赋值的，
    // 所以直接用构造函数参数 resource / id。
    super(`${resource} not found: ${id}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export function describeError(err: unknown): string {
  // 顺序至关重要：NotFoundError 也是 AppError 也是 Error，
  // 父类判断写在前面会把子类全部吃掉（Java 里 catch 块顺序写反编译器会拦，TS 不会）。
  if (err instanceof NotFoundError) return `404 ${err.resource}#${err.id}`;
  if (err instanceof AppError) return `app[${err.code}] ${err.message}`;
  if (err instanceof Error) return `error ${err.message}`;
  // catch (e) 里 e 的类型是 unknown：throw 'string' 是合法的 JS，必须兜底。
  return `unknown ${String(err)}`;
}

// ---------- 4.12 ----------
export interface User {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface UserReader {
  find(id: string): User | undefined;
  find(ids: readonly string[]): User[];
  count(): number;
}

export interface UserWriter {
  add(id: string, name: string): User;
}

export class InMemoryUserRepository implements UserReader, UserWriter {
  #users = new Map<string, User>();

  // 参数属性简写：`private readonly now` 一行同时完成「声明字段 + 赋值」，
  // 相当于 Java 里写 3 遍字段名的构造器注入。
  // now 作为依赖注入进来，测试里传 () => 1000 就能固定时间。
  constructor(
    private readonly now: () => number,
    private readonly maxUsers: number = 100,
  ) {}

  add(id: string, name: string): User {
    if (this.#users.has(id)) throw new Error(`duplicate id: ${id}`);
    if (this.#users.size >= this.maxUsers) throw new RangeError('repository is full');
    const user: User = { id, name, createdAt: this.now() };
    this.#users.set(id, user);
    return user;
  }

  count(): number {
    return this.#users.size;
  }

  // 重载签名：只是给调用方更精确的类型，实现永远只有一个。
  // 有了这两行，repo.find('x') 的类型是 User | undefined，
  // repo.find(['x']) 的类型是 User[]，调用方不需要再手动断言。
  find(id: string): User | undefined;
  find(ids: readonly string[]): User[];
  find(arg: string | readonly string[]): User | User[] | undefined {
    // 实现签名对外不可见，所以这里用联合类型 + 收窄。
    if (typeof arg === 'string') return this.#users.get(arg);
    // 用类型守卫收窄 filter 的结果，否则类型是 (User | undefined)[]。
    return arg
      .map((id) => this.#users.get(id))
      .filter((user): user is User => user !== undefined);
  }
}
