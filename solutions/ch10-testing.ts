/**
 * 第 10 章参考答案 · 测试与质量保障
 * 每题都附带「为什么这么写 / 常见错法」的说明，看的时候重点看注释。
 */

// ---------- 10.1 ----------
export function once<T>(fn: () => T): () => T {
  // 三个状态：没跑过 / 跑成功了 / 跑挂了。用一个 union 表示比三个布尔标记安全。
  type State = { kind: 'pending' } | { kind: 'ok'; value: T } | { kind: 'err'; error: unknown };
  let state: State = { kind: 'pending' };

  return (): T => {
    if (state.kind === 'ok') return state.value;
    if (state.kind === 'err') throw state.error;
    try {
      const value = fn();
      state = { kind: 'ok', value };
      return value;
    } catch (error) {
      // 常见错法：catch 里不记状态，于是每次调用都会重新执行 fn。
      // 生产上这会导致"初始化失败后被无限重试"，日志被刷爆。
      state = { kind: 'err', error };
      throw error;
    }
  };
}

// ---------- 10.2 ----------
export function formatDuration(ms: number): string {
  // 输入校验放最前面：Number.isFinite 一次挡掉 NaN / Infinity（`ms < 0` 挡不住 NaN，
  // 因为任何和 NaN 的比较都是 false）。
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`formatDuration: ms 必须是非负有限数字，收到 ${ms}`);
  }
  const total = Math.floor(ms);

  if (total < 1000) return `${total}ms`;

  if (total < 60_000) {
    // Math.round(x / 100) / 10 = 保留一位小数。
    // 别用 toFixed(1)：它总会补出 '2.0s' 这种尾巴，还返回字符串不好再判断。
    const s = Math.round(total / 100) / 10;
    return `${s}s`;
  }

  if (total < 3_600_000) {
    const m = Math.floor(total / 60_000);
    const s = Math.floor((total % 60_000) / 1000);
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }

  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

// ---------- 10.3 ----------
export async function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  // for await...of 会自动处理 next()/return()，源抛错时异常直接往外冒 —— 这正是我们要的。
  // 常见错法：手写 while + await it.next() 时忘了 done 判断，或者用 try/catch 把错误吞了。
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

// ---------- 10.4 ----------
export type SpyOutcome<R> = { type: 'return'; value: R } | { type: 'throw'; error: unknown };

export interface SpyRecord<A extends unknown[], R> {
  args: A;
  outcome: SpyOutcome<R>;
}

export interface Spy<A extends unknown[], R> {
  (...args: A): R;
  calls: A[];
  records: Array<SpyRecord<A, R>>;
  callCount(): number;
  lastCall(): A | undefined;
  reset(): void;
}

export function createSpy<A extends unknown[], R = void>(impl?: (...args: A) => R): Spy<A, R> {
  // 全部状态就是这两个数组 —— vi.fn() / Mockito 的 verify() 本质上也只有这些。
  const calls: A[] = [];
  const records: Array<SpyRecord<A, R>> = [];

  const invoke = (...args: A): R => {
    calls.push(args);
    try {
      // 没传 impl 时返回 undefined。这里必须断言，因为 R 可能是任意类型；
      // 这是"假实现"不可避免的一次说谎，用 vi.fn() 时它替你说了。
      const value = impl ? impl(...args) : (undefined as R);
      records.push({ args, outcome: { type: 'return', value } });
      return value;
    } catch (error) {
      // 先记录、再抛出。顺序反了的话，抛异常的调用就不会出现在 records 里。
      records.push({ args, outcome: { type: 'throw', error } });
      throw error;
    }
  };

  // Object.assign 把属性挂到函数对象上。JS 的函数是对象，这就是 vi.fn() 既能调用
  // 又有 .mock.calls 的原因（Java 里做不到，只能用 Answer + ArgumentCaptor）。
  return Object.assign(invoke, {
    calls,
    records,
    callCount: (): number => calls.length,
    // at(-1) 比 calls[calls.length - 1] 干净；开了 noUncheckedIndexedAccess 后
    // 两者的返回类型都是 A | undefined。
    lastCall: (): A | undefined => calls.at(-1),
    reset: (): void => {
      // 只清历史，不动 impl —— 对应 vitest 的 mockClear()。
      // 如果这里顺手把 impl 也清了，就变成 mockReset() 了，语义不同。
      calls.length = 0;
      records.length = 0;
    },
  });
}

// ---------- 10.5 ----------
export type ErrorClass = new (...args: never[]) => Error;

export type ErrorMatcher = string | RegExp | ErrorClass | ((error: unknown) => boolean);

function isErrorClass(m: unknown): m is ErrorClass {
  // 关键技巧：Error 子类和普通函数的 typeof 都是 'function'，
  // 只能靠原型链区分。`Foo.prototype instanceof Error` 对 class Foo extends Error 为 true。
  return typeof m === 'function' && (m === Error || m.prototype instanceof Error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertThrows(fn: () => unknown, matcher?: ErrorMatcher): unknown {
  let thrown: unknown;
  let didThrow = false;
  try {
    fn();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  // 判断"抛没抛"必须用独立的布尔标记，不能靠 `thrown !== undefined`：
  // `throw undefined` 是合法的 JS。😱
  if (!didThrow) {
    throw new Error('expected function to throw, but it returned normally');
  }
  if (matcher === undefined) return thrown;

  const ok =
    typeof matcher === 'string'
      ? messageOf(thrown).includes(matcher)
      : matcher instanceof RegExp
        ? matcher.test(messageOf(thrown))
        : isErrorClass(matcher)
          ? thrown instanceof matcher
          : matcher(thrown);

  if (!ok) {
    throw new Error(`thrown error did not match: ${messageOf(thrown)}`);
  }
  // 把 error 返回出去，调用方可以继续断言它的字段：
  //   const e = assertThrows(load, HttpError) as HttpError;
  //   expect(e.status).toBe(503);
  return thrown;
}

// ---------- 10.6 ----------
export interface MiniFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface InMemoryFs extends MiniFs {
  snapshot(): Record<string, string>;
}

export function createInMemoryFs(initial?: Record<string, string>): InMemoryFs {
  // 用 Map 而不是普通对象：不会被 '__proto__' / 'constructor' 这类键污染。
  const files = new Map<string, string>(Object.entries(initial ?? {}));

  return {
    // 三个方法都是 async：假实现必须和真实现"同样异步"，
    // 否则测试里代码路径是同步的，上线后变异步就露馅了。
    async readFile(path: string): Promise<string> {
      const content = files.get(path);
      if (content === undefined) {
        // 消息里带 ENOENT，和 node:fs 的错误对齐，业务代码里 `err.message.includes('ENOENT')`
        // 这类判断在假实现下也能走通。
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async writeFile(path: string, data: string): Promise<void> {
      files.set(path, data);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    snapshot(): Record<string, string> {
      return Object.fromEntries(files);
    },
  };
}

export async function saveReport(fs: MiniFs, path: string, data: unknown): Promise<void> {
  // 注意这个函数的签名：fs 是**参数**，不是 import 进来的。
  // 于是它天生可测 —— 不需要 vi.mock('node:fs/promises')，不需要临时目录，
  // 也不需要 Spring 那样的容器来注入。这是 TS 比 Java 轻松的地方。
  if (await fs.exists(path)) {
    const old = await fs.readFile(path);
    await fs.writeFile(`${path}.bak`, old);
  }
  await fs.writeFile(path, JSON.stringify(data, null, 2));
}

// ---------- 10.7 ----------
export function deepEqual(a: unknown, b: unknown): boolean {
  // seen 记录"正在比较中的 a → b 组合"，用来切断循环引用。
  // 用 WeakMap 而不是 Map：不阻止 GC。
  const seen = new WeakMap<object, Set<object>>();

  const eq = (x: unknown, y: unknown): boolean => {
    // Object.is 一次搞定两个坑：NaN 和自己相等、0 和 -0 不相等。
    // 常见错法：写 `x === y`，于是 deepEqual(NaN, NaN) 返回 false。
    if (Object.is(x, y)) return true;

    // 到这里 x/y 至少有一个不是原始值、或者是两个不同的对象。
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) return false;

    // 循环引用：如果这一对已经在比较栈上，就认为相等（协同归纳法）。
    const visited = seen.get(x);
    if (visited?.has(y) === true) return true;
    if (visited === undefined) seen.set(x, new Set([y]));
    else visited.add(y);

    if (x instanceof Date || y instanceof Date) {
      if (!(x instanceof Date) || !(y instanceof Date)) return false;
      // 两个 Invalid Date 的 getTime() 都是 NaN，用 Object.is 才算相等。
      return Object.is(x.getTime(), y.getTime());
    }

    const xIsArr = Array.isArray(x);
    if (xIsArr !== Array.isArray(y)) return false; // 数组和对象永远不相等
    if (xIsArr) {
      const ax = x as unknown[];
      const ay = y as unknown[];
      if (ax.length !== ay.length) return false;
      return ax.every((item, i) => eq(item, ay[i]));
    }

    // 只比"普通对象"。Map/Set/RegExp/class 实例走到这里会因为键集合为空而
    // 被误判成相等，所以先兜底：原型不是 Object.prototype / null 的就用引用比较。
    const px = Object.getPrototypeOf(x) as unknown;
    const py = Object.getPrototypeOf(y) as unknown;
    if (px !== py) return false;
    if (px !== Object.prototype && px !== null) return false;

    const kx = Object.keys(x);
    const ky = Object.keys(y);
    // 键**集合**相同：先比个数，再逐个查对方有没有。
    // 这一步决定了 { a: 1 } 和 { a: 1, b: undefined } 不相等 ——
    // 这正是 vitest 里 toEqual（相等）和 toStrictEqual（不相等）的分歧点。
    if (kx.length !== ky.length) return false;
    const rx = x as Record<string, unknown>;
    const ry = y as Record<string, unknown>;
    return kx.every((k) => Object.hasOwn(ry, k) && eq(rx[k], ry[k]));
  };

  return eq(a, b);
}

// ---------- 10.8 ----------
export function sanitizeSnapshot(text: string): string {
  return (
    text
      // 1. ISO 时间戳。必须最先替换：里面既有 '-' 又有 ':' 又有数字，
      //    放到最后会被路径/耗时规则啃出奇怪的结果。
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, '<TIMESTAMP>')
      // 2. UUID。8-4-4-4-12，i 标志兼顾大写。
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      // 3. 绝对路径：必须以 / 开头，且至少两段（`(?:seg\/)+seg`），
      //    所以 '/tmp' 和 'docs/01.md' 都不会被替换。
      .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<PATH>')
      // 4. 耗时。放最后：此时 <TIMESTAMP> / <PATH> 里已经没有裸数字了。
      //    \b 保证不会把 'v1s' 里的 '1s' 也吃掉。
      .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<DURATION>')
  );
}

// ---------- 10.9 ----------
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface StubClock extends Clock {
  advance(ms: number): Promise<void>;
  pending(): number;
}

interface StubTimer {
  dueAt: number;
  resolve: () => void;
}

export function createStubClock(startMs = 0): StubClock {
  let current = startMs;
  let timers: StubTimer[] = [];

  // 让出一次【宏任务】。await Promise.resolve() 只让出一个微任务，
  // 被唤醒的代码如果自己还 await 了别的东西就跑不完；setImmediate 会把
  // 整个微任务队列排空，行为更接近 vitest 的 advanceTimersByTimeAsync。
  const flushMicrotasks = (): Promise<void> =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

  return {
    now: (): number => current,

    sleep(ms: number): Promise<void> {
      if (ms < 0) throw new RangeError(`sleep: ms 不能为负数，收到 ${ms}`);
      // 关键：dueAt 在**注册时**就算好。这样嵌套的 sleep 才能得到正确的绝对到期时间。
      return new Promise<void>((resolve) => {
        timers.push({ dueAt: current + ms, resolve });
      });
    },

    async advance(ms: number): Promise<void> {
      if (ms < 0) throw new RangeError(`advance: ms 不能为负数，收到 ${ms}`);
      const target = current + ms;
      // 先排空一次微任务队列：调用 advance 的那一刻，可能还有代码正排队等着执行
      // （典型场景：`const p = retry(...); await clock.advance(...)` —— retry 的
      // catch 块还没跑，第一个 sleep 根本还没注册）。不先 flush 的话这些 sleep
      // 会以推进后的时间为基准注册，然后永远等不到唤醒 —— 测试直接超时挂住。😱
      await flushMicrotasks();
      // 循环而不是一次性 flush：每唤醒一个 sleep，被唤醒的代码可能又注册新的 sleep，
      // 只要它也在 [current, target] 区间内就应该在这一次 advance 里跑掉。
      for (;;) {
        const due = timers.filter((t) => t.dueAt <= target).sort((x, y) => x.dueAt - y.dueAt);
        const next = due[0];
        if (next === undefined) break;
        timers = timers.filter((t) => t !== next);
        // 时间只能前进，不能因为一个早已到期的 timer 而倒退。
        current = Math.max(current, next.dueAt);
        next.resolve();
        await flushMicrotasks();
      }
      current = target;
    },

    pending: (): number => timers.length,
  };
}

// ---------- 10.10 ----------
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  clock: Clock,
): (...args: A) => void {
  if (ms < 0) throw new RangeError(`debounce: ms 不能为负数，收到 ${ms}`);

  let generation = 0;
  let lastArgs: A | undefined;

  return (...args: A): void => {
    lastArgs = args;
    // Promise 不能取消，所以用"代号"实现逻辑取消：
    // 醒来后发现自己不是最新一代，就当自己被取消了。
    // 这个模式在 TS 里非常常用（比 Java 的 ScheduledFuture.cancel() 更啰嗦，但够用）。
    generation += 1;
    const mine = generation;

    // void 明确表示"我知道这是个不 await 的 Promise"。
    // 生产代码里 eslint 的 no-floating-promises 会强制你写这个 void。
    void (async () => {
      await clock.sleep(ms);
      if (mine !== generation) return; // 期间又被调用了 -> 放弃这一次
      // 用 lastArgs 而不是闭包里的 args：debounce 的语义是"用最后一次的参数"。
      if (lastArgs !== undefined) fn(...lastArgs);
    })();
  };
}

// ---------- 10.11 ----------
export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  clock: Clock;
}

export async function retryWithClock<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  const { retries, baseDelayMs, clock } = config;
  if (retries < 0) throw new RangeError(`retryWithClock: retries 不能为负数，收到 ${retries}`);
  if (baseDelayMs < 0) {
    throw new RangeError(`retryWithClock: baseDelayMs 不能为负数，收到 ${baseDelayMs}`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries + 1) break; // 最后一次失败就不用再睡了
      // 指数退避：100 / 200 / 400 …… 生产上还要加 jitter（随机抖动）防止惊群，
      // 但那会让测试不确定，所以 jitter 也应该做成注入的依赖。
      await clock.sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // 原样抛出最后一次的错误：包装成新 Error 会丢掉 stack 和自定义字段（比如 status）。
  throw lastError;
}

// ---------- 10.12 ----------
export interface MiniTestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
}

export interface MiniHooks {
  beforeEach?: () => void | Promise<void>;
  afterEach?: () => void | Promise<void>;
}

export interface MiniRunner {
  test(name: string, fn: () => void | Promise<void>): void;
  skip(name: string): void;
  run(): Promise<MiniTestResult[]>;
}

interface MiniCase {
  name: string;
  fn?: (() => void | Promise<void>) | undefined;
}

function normalizeError(e: unknown): string {
  // 归一化：JS 里可以 `throw '字符串'`、`throw 42`，甚至 `throw undefined`。
  // 所有 catch 块都要按 unknown 处理，这是第 07 章的规矩。
  return e instanceof Error ? e.message : String(e);
}

export function createMiniRunner(hooks?: MiniHooks): MiniRunner {
  const cases: MiniCase[] = [];

  return {
    test(name: string, fn: () => void | Promise<void>): void {
      cases.push({ name, fn });
    },
    skip(name: string): void {
      cases.push({ name });
    },

    async run(): Promise<MiniTestResult[]> {
      const results: MiniTestResult[] = [];

      // 串行：for...of + await。
      // 常见错法：cases.map(async ...) + Promise.all -> 全部并发跑，
      // beforeEach/afterEach 会互相踩，共享状态立刻错乱。
      for (const c of cases) {
        if (c.fn === undefined) {
          results.push({ name: c.name, status: 'skip' });
          continue;
        }

        let error: string | undefined;
        try {
          try {
            if (hooks?.beforeEach) await hooks.beforeEach();
          } catch (e) {
            error = `beforeEach: ${normalizeError(e)}`;
          }
          // beforeEach 挂了就不跑测试体（否则前置条件不成立，报错毫无参考价值）。
          if (error === undefined) await c.fn();
        } catch (e) {
          error = normalizeError(e);
        } finally {
          // finally 保证清理一定跑到。这是 afterEach 存在的全部意义 ——
          // 不管测试成功、失败还是抛了非 Error，资源都要放掉。
          try {
            if (hooks?.afterEach) await hooks.afterEach();
          } catch (e) {
            // 已经有错就保留原错：第一个错误信息通常才是根因。
            error ??= `afterEach: ${normalizeError(e)}`;
          }
        }

        // 成功时不要写 `error: undefined`：
        // toEqual 看不出区别，但 toStrictEqual 会因为多了一个 undefined 键而失败。
        results.push(error === undefined ? { name: c.name, status: 'pass' } : { name: c.name, status: 'fail', error });
      }

      return results;
    },
  };
}
