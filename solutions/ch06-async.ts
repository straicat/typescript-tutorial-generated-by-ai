/**
 * 第 06 章参考答案 · 异步编程
 * 每题都附带「为什么这么写 / 常见错法是什么」的说明，看的时候重点看注释。
 */

// =====================================================================
// 公共错误类型（与 exercises 保持完全一致）
// =====================================================================

export class TimeoutError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    // 继承 Error 时必须手动设 name：class 名在运行时不会自动变成 name。
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

export class AbortError extends Error {
  constructor(message = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

// ---------- 6.1 ----------
export function sleep(ms: number): Promise<void> {
  // new Promise 的执行器是【同步】跑的：调用 sleep 的那一刻 setTimeout 就注册了。
  // 这点和 Go 的 goroutine 要 `go` 一下、C# 的冷 Task 要 Start 完全不同。
  return new Promise<void>((resolve) => {
    // 常见错法①：`setTimeout(resolve, ms)` —— 看起来没问题，但 Node 会把
    // 定时器的额外参数传给回调，虽然这里没有，仍建议包一层，避免以后被
    // `Promise<void>` 变成 `Promise<number>` 这类意外。
    // 常见错法②：写 `resolve(setTimeout(...))`，那就变成立刻 resolve 了。
    setTimeout(() => resolve(), Math.max(0, ms));
  });
}

// ---------- 6.2 ----------
export function executionOrder(): Promise<string[]> {
  const out: string[] = [];

  return new Promise<string[]>((resolve) => {
    out.push('sync-1');

    // 宏任务（macrotask）：要等【调用栈清空 + 微任务队列排空】之后才轮到它。
    // 所以 setTimeout(fn, 0) 绝不等于"立刻执行"。
    setTimeout(() => {
      out.push('macro');
      resolve(out);
    }, 0);

    // 微任务（microtask）：当前同步代码跑完就立刻排空整个微任务队列。
    Promise.resolve().then(() => {
      out.push('micro-1');
    });
    queueMicrotask(() => {
      out.push('micro-2');
    });

    out.push('sync-2');
  });
  // 结果：['sync-1', 'sync-2', 'micro-1', 'micro-2', 'macro']
  // 记忆口诀：同步 → 微任务（全部排空）→ 一个宏任务 → 再排空微任务 → ...
}

// ---------- 6.3 ----------
export type NodeCallback<T> = (err: Error | null | undefined, value?: T) => void;

export function promisifyCallback<A extends unknown[], T>(
  fn: (...args: [...A, NodeCallback<T>]) => void,
): (...args: A) => Promise<T> {
  return (...args: A): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const cb: NodeCallback<T> = (err, value) => {
        // `err != null` 一次命中 null 和 undefined —— 老 API 两种都可能传。
        if (err != null) {
          reject(err);
          return;
        }
        // 回调签名里 value 是可选的，但契约上 err 为空时它一定有值。
        resolve(value as T);
      };
      // 变参元组 [...A, NodeCallback<T>]：TS 4.0+ 才能这样精确表达
      // "最后一个参数是回调"。这是手写 promisify 唯一有点难度的地方。
      fn(...args, cb);
      // 注意：这里【不需要】自己防重复调用。Promise 是一次性状态机，
      // 第二次 resolve/reject 会被静默忽略。
    });
}

// ---------- 6.4 ----------
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Promise<never> 表示"只会失败，永不产出值"，这样 race 的结果类型仍是 T。
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    // 必须清定时器！常见错法是只 race 不 clearTimeout：
    // 任务 1ms 就成功了，但 30s 的定时器还挂着，CLI 会"跑完了却不退出"。
    if (timer !== undefined) clearTimeout(timer);
  });
  // ⚠️ 本质缺陷：race 只是"我不等了"，原 promise 背后的任务仍在跑。
  // 想真正停下来，必须把 AbortSignal 传进去（见 6.6 / 6.10）。
}

// ---------- 6.5 ----------
export interface SettledSummary<T> {
  total: number;
  values: T[];
  reasons: string[];
  ok: boolean;
}

export async function allSettledSummary<T>(
  promises: ReadonlyArray<Promise<T>>,
): Promise<SettledSummary<T>> {
  // allSettled 永不 reject，返回的是判别联合（discriminated union）：
  // { status: 'fulfilled', value } | { status: 'rejected', reason }
  const results = await Promise.allSettled(promises);

  const values: T[] = [];
  const reasons: string[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      values.push(r.value);
    } else {
      // reason 类型是 any/unknown：抛出来的东西不一定是 Error（JS 允许 throw 任何值）。
      reasons.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }

  return { total: results.length, values, reasons, ok: reasons.length === 0 };
  // 常见错法：用 Promise.all + try/catch —— 一失败就整体失败，
  // 成功的那 8 个结果全丢了，而且失败的那个还把其它任务的信息盖掉。
}

// ---------- 6.6 ----------
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // ① 先检查：调用之前就可能已经取消了（AbortSignal.abort() 就是这种）。
    //    漏了这一步，"已取消的 signal" 会白等一整个 ms。
    if (signal?.aborted === true) {
      reject(new AbortError());
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };

    const timer = setTimeout(() => {
      // ③ 正常完成也要摘监听，否则长生命周期的 signal 会攒一堆闭包 → 内存泄漏。
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));

    // ② 监听 abort。{ once: true } 保证只触发一次，触发后自动摘掉。
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  // AbortSignal 就是 TS 世界的 context.Context：
  // 自己写的每个"可能等很久"的函数，都应该接受一个可选 signal 并遵守这三步。
}

// ---------- 6.7 ----------
export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  factor?: number;
  maxDelayMs?: number;
  jitter?: (delayMs: number) => number;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  // 解构 + 默认值：把"策略"全部做成可注入的参数，测试就不需要真的等 3 秒。
  const {
    retries,
    baseDelayMs,
    factor = 2,
    maxDelayMs = Number.POSITIVE_INFINITY,
    jitter = (d: number): number => d,
    sleep: sleepFn = sleep,
    shouldRetry = (): boolean => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      // 一定要 await！写成 `return fn(attempt)` 的话，
      // fn 的 rejection 就不会被本函数的 catch 抓到（try/catch 包不住没 await 的 Promise）。
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // 已经是最后一次尝试：不要再 sleep，直接跳出去抛错。
      // 常见错法是无条件 sleep，导致最后白等一轮退避时间。
      if (attempt > retries) break;
      // 4xx 这类错误重试没意义，交给调用方判断。
      if (!shouldRetry(error, attempt)) break;

      const raw = baseDelayMs * factor ** (attempt - 1);
      const delayMs = jitter(Math.min(raw, maxDelayMs));
      onRetry?.({ attempt, delayMs, error });
      await sleepFn(delayMs);
    }
  }

  throw lastError;
}

// ---------- 6.8 ----------
export function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const jobs = items.map((item, index) => ({ item, index }));
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.trunc(limit) || 1, jobs.length));
  let cursor = 0;

  // 每个 worker 是一个 async 函数，它们共享 cursor。
  // 因为是单线程，`cursor++` 不需要锁：两次自增之间不可能被打断（没有 await）。
  // 这就是"没有数据竞争"的实际好处 —— Go 里这里要用 channel 或 atomic。
  async function worker(): Promise<void> {
    for (;;) {
      const job = jobs[cursor];
      cursor += 1;
      // noUncheckedIndexedAccess 下下标访问是 T | undefined，必须判空。
      // 这个判空同时也是循环终止条件。
      if (job === undefined) return;
      results[job.index] = await fn(job.item, job.index);
    }
  }

  if (jobs.length === 0) return Promise.resolve([]);

  // 启动固定数量的 worker，等它们全部干完 —— 等价于 Go 的
  // "N 个 goroutine 从同一个 channel 取活 + WaitGroup"。
  // 常见错法：Promise.all(items.map(fn))，1000 个请求瞬间全发出去。
  return Promise.all(Array.from({ length: width }, () => worker())).then(() => results);
}

// ---------- 6.9 ----------
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly pending: number;
}

export function createSerialQueue(): SerialQueue {
  // 整个串行队列就是"一条不断加长的 Promise 链"。不需要 mutex、不需要条件变量。
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  return {
    get pending(): number {
      return pending;
    },

    run<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;

      // 关键：把 task 挂在 tail 之后，而不是立刻执行。
      const result = tail.then(() => task());

      // 关键②：tail 必须是"被 catch 过"的版本，否则前一个任务失败
      // 会让后面所有任务都直接失败（队列被毒死）。
      tail = result.catch(() => undefined);

      // 调用方拿到的是原始 result（错误照常透传给它自己）。
      return result.finally(() => {
        pending -= 1;
      });
    },
  };
}

// ---------- 6.10 ----------
export function raceWithCleanup<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
): Promise<T> {
  if (tasks.length === 0) return Promise.reject(new Error('no tasks'));

  // 每个任务一个独立的 controller —— 这样"取消输家"不会连带取消赢家。
  const entries = tasks.map((task) => ({ task, controller: new AbortController() }));

  // 用 async 包一层：即使 task 同步 throw，也会变成 rejected Promise
  // 而不是把异常直接扔到 raceWithCleanup 的调用栈上。
  const runs = entries.map(async ({ task, controller }) => task(controller.signal));

  const cleanup = (): void => {
    for (const { controller } of entries) controller.abort();
  };

  // Promise.race 给每个 run 都挂了处理器，所以输家后来 reject 也不会
  // 触发 unhandledRejection。这一点很容易被忽略。
  return Promise.race(runs).then(
    (value) => {
      cleanup();
      return value;
    },
    (error: unknown) => {
      cleanup();
      throw error;
    },
  );
}

// ---------- 6.11 ----------
export interface Page<T> {
  items: T[];
  nextCursor?: string | undefined;
}

export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;

  for (;;) {
    const page = await fetchPage(cursor);

    // 逐个 yield：调用方写 `for await (const item of ...)` 就像在遍历本地数组。
    for (const item of page.items) {
      yield item;
    }

    // 生成器天然是惰性的：卡在 yield 上不动，调用方 break 就永远不会
    // 走到下面这行 → 不会发出多余的请求。这是它 vs "先全量拉回来" 的核心优势。
    if (page.nextCursor == null) return;
    cursor = page.nextCursor;
  }
}

// ---------- 6.12 ----------
export interface DebouncedAsync<A extends unknown[], R> {
  (...args: A): Promise<R>;
  cancel(): void;
}

export function debounceAsync<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  waitMs: number,
): DebouncedAsync<A, R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  // 攒着的调用方：一次 fn 的结果要分发给所有人。
  let waiters: Array<{ resolve: (value: R) => void; reject: (error: unknown) => void }> = [];

  const fire = (): void => {
    timer = undefined;
    // 先把 batch/args 取出来并清空状态，再去 await。
    // 否则 await 期间进来的新调用会被算进这一批（这就是典型的"交错"bug）。
    const batch = waiters;
    const args = lastArgs as A;
    waiters = [];
    lastArgs = undefined;

    // void + async IIFE：明确表示"这个 Promise 我不再等待"，
    // 同时保证内部 try/catch 兜住了所有错误，不会产生未处理的 rejection。
    void (async () => {
      try {
        const value = await fn(...args);
        for (const w of batch) w.resolve(value);
      } catch (error) {
        for (const w of batch) w.reject(error);
      }
    })();
  };

  const debounced = ((...args: A): Promise<R> => {
    lastArgs = args;
    // 每次新调用都把上一个定时器推掉 —— 这就是"尾部去抖"。
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(fire, waitMs);
    return new Promise<R>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }) as DebouncedAsync<A, R>;

  debounced.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const batch = waiters;
    waiters = [];
    lastArgs = undefined;
    // 必须显式 reject：否则调用方的 await 会永远挂着（Promise 泄漏，
    // 比抛错难查得多，因为进程既不报错也不退出）。
    for (const w of batch) w.reject(new AbortError('debounced call cancelled'));
  };

  return debounced;
}
