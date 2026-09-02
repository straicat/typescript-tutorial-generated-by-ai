/**
 * 第 06 章练习 · 异步编程
 * =====================================================================
 * 对应文档：docs/06-async.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch06`  或者 `pnpm vitest tests/ch06`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch06-async.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 本章所有题目都是**可确定性测试**的：延时都在 1~20ms，需要"时间"的地方一律
 * 通过参数注入（`sleep` / `jitter`），不依赖真实网络。你自己写实现时也请遵守
 * 这个约定 —— 这正是生产环境里异步代码可测试的关键。
 * =====================================================================
 */

// =====================================================================
// 公共错误类型（已给出实现，不用改；两处文件保持一致）
// =====================================================================

/** 超时错误。用独立的 error 类而不是字符串，调用方才能 `instanceof` 精确处理。 */
export class TimeoutError extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

/** 取消错误。名字对齐 Web 标准的 `AbortError`（`fetch` 被 abort 时抛的就是它）。 */
export class AbortError extends Error {
  constructor(message = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/**
 * 练习 6.1 ⭐ —— sleep
 *
 * 实现一个 Promise 版的 sleep。这是 `Thread.sleep` / `time.Sleep` 在 TS 里的对应物，
 * 区别是它**不阻塞线程**：事件循环在等待期间继续处理别的任务。
 *
 * await sleep(10)   // 约 10ms 后继续往下走
 * await sleep(0)    // 立刻（下一个宏任务）继续，不报错
 * await sleep(-5)   // 不报错，等价于 0
 *
 * 返回值必须是 undefined（不是数字，别把 setTimeout 的返回值 resolve 出去）。
 */
export function sleep(ms: number): Promise<void> {
  throw new Error('TODO 6.1: 实现 sleep');
}

/**
 * 练习 6.2 ⭐⭐ —— 输出顺序（微任务 vs 宏任务）
 *
 * 请**按下面的源码顺序**依次触发这 5 件事，把标签 push 进一个数组，
 * 最后把数组 resolve 出来：
 *
 *   1) 同步 push 'sync-1'
 *   2) 用 setTimeout(..., 0) 安排 push 'macro'
 *   3) 用 Promise.resolve().then(...) 安排 push 'micro-1'
 *   4) 用 queueMicrotask(...) 安排 push 'micro-2'
 *   5) 同步 push 'sync-2'
 *
 * 然后想清楚：真正的执行顺序是什么？
 *
 * await executionOrder()
 *   -> ['sync-1', 'sync-2', 'micro-1', 'micro-2', 'macro']
 *
 * 要求：数组必须是真的按上面的 API 跑出来的，不许直接 return 硬编码的字面量。
 * 提示：`setTimeout(fn, 0)` 不等于"立刻"，它排在**所有**微任务后面。
 */
export function executionOrder(): Promise<string[]> {
  throw new Error('TODO 6.2: 实现 executionOrder');
}

/**
 * 练习 6.3 ⭐⭐ —— 手写 promisify（包装回调风格 API）
 *
 * Node 里大量老 API 是 `(...args, callback)` 形式，callback 签名固定为
 * `(err, value)`。把它包成返回 Promise 的函数 —— 这是 `new Promise(...)`
 * 少数**必须**手写的场景。
 *
 * const readTwice = (a: number, b: number, cb: NodeCallback<number>) => cb(null, a + b);
 * const p = promisifyCallback(readTwice);
 * await p(1, 2)            // 3
 *
 * const fail = (cb: NodeCallback<number>) => cb(new Error('boom'));
 * await promisifyCallback(fail)()   // reject: Error('boom')
 *
 * 要求：
 *   - err 非 null/undefined 时 reject(err)，否则 resolve(value)
 *   - 回调被调用多次时，只有第一次生效（Promise 天然幂等，别自己加锁）
 */
export type NodeCallback<T> = (err: Error | null | undefined, value?: T) => void;

export function promisifyCallback<A extends unknown[], T>(
  fn: (...args: [...A, NodeCallback<T>]) => void,
): (...args: A) => Promise<T> {
  throw new Error('TODO 6.3: 实现 promisifyCallback');
}

/**
 * 练习 6.4 ⭐⭐ —— withTimeout
 *
 * 给任意 Promise 加超时：ms 毫秒内没 settle 就 reject 一个 TimeoutError。
 *
 * await withTimeout(Promise.resolve(1), 50)                 // 1
 * await withTimeout(sleep(100).then(() => 1), 10)           // reject: TimeoutError('timed out after 10ms')
 * await withTimeout(Promise.reject(new Error('boom')), 50)  // reject: Error('boom')  ← 原错误原样抛出
 *
 * 要求：
 *   - 原 Promise 成功/失败都要原样透传，不要包一层
 *   - 无论哪边先 settle，**都要 clearTimeout**（否则定时器会让 Node 进程多活 ms 毫秒）
 *   - ⚠️ 注意这只是"不再等待"，被超时的任务**仍在后台跑**（真正的取消见 6.6 / 6.10）
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  throw new Error('TODO 6.4: 实现 withTimeout');
}

/**
 * 练习 6.5 ⭐⭐ —— allSettledSummary
 *
 * 用 `Promise.allSettled` 统计一批任务的结果，做成一份汇总。
 * 典型场景：批量抓取 N 个 URL，允许部分失败，最后报告"成功 8 个，失败 2 个"。
 *
 *   - total   : 任务总数
 *   - values  : 成功的值，**按输入顺序**
 *   - reasons : 失败的原因**消息文本**，按输入顺序；
 *               reason 是 Error 就取 `.message`，否则取 `String(reason)`
 *   - ok      : 是否全部成功
 *
 * await allSettledSummary([Promise.resolve('a'), Promise.reject(new Error('x'))])
 *   -> { total: 2, values: ['a'], reasons: ['x'], ok: false }
 * await allSettledSummary([])
 *   -> { total: 0, values: [], reasons: [], ok: true }
 *
 * 注意：不能用 `Promise.all` —— 它一失败就整体失败，拿不到成功的那些值。
 */
export interface SettledSummary<T> {
  total: number;
  values: T[];
  reasons: string[];
  ok: boolean;
}

export function allSettledSummary<T>(
  promises: ReadonlyArray<Promise<T>>,
): Promise<SettledSummary<T>> {
  throw new Error('TODO 6.5: 实现 allSettledSummary');
}

/**
 * 练习 6.6 ⭐⭐⭐ —— 支持取消的延时（AbortSignal ≈ context.Context）
 *
 * 让自己的异步函数支持取消，标准三步：
 *   ① 进函数先检查 `signal.aborted`（可能调用前就已经取消了）
 *   ② 监听 'abort' 事件，触发时 reject
 *   ③ 无论成功还是取消，都要清掉定时器 + 移除监听（否则泄漏）
 *
 * const c = new AbortController();
 * const p = abortableDelay(1000, c.signal);
 * c.abort();
 * await p            // reject: AbortError，且**立刻**返回，不等 1000ms
 *
 * await abortableDelay(5)                       // resolve
 * await abortableDelay(5, AbortSignal.abort())  // 立刻 reject: AbortError
 *
 * 要求：reject 的错误 `name` 必须是 'AbortError'（用上面导出的 AbortError 类）。
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throw new Error('TODO 6.6: 实现 abortableDelay');
}

/**
 * 练习 6.7 ⭐⭐⭐ —— retry：指数退避 + 抖动
 *
 * 反复调用 fn，失败就等一会儿再试。这是 Agent 调 LLM API 的标准姿势。
 *
 * 规则：
 *   - fn 收到的参数是**第几次尝试**，从 1 开始
 *   - 总尝试次数 = retries + 1（retries 是"重试"次数）
 *   - 第 k 次重试（k 从 1 开始）之前的等待时长：
 *       raw   = baseDelayMs * factor ** (k - 1)
 *       delay = jitter(Math.min(raw, maxDelayMs))
 *     默认 factor = 2，maxDelayMs = Infinity，jitter = (d) => d
 *   - 等待用 `options.sleep`（默认用 6.1 的 sleep）——**注入以便测试**
 *   - 最后一次尝试失败后**不要再 sleep**，直接把最后一个错误抛出去
 *   - shouldRetry 返回 false 时立即放弃并抛出该错误（默认全部重试）
 *   - 每次决定重试时调用一次 onRetry（如果传了）
 *
 * const delays: number[] = [];
 * await retry(async (attempt) => { if (attempt < 3) throw new Error('e'); return attempt; }, {
 *   retries: 5, baseDelayMs: 100, sleep: async (ms) => { delays.push(ms); },
 * });
 * // 返回 3，delays === [100, 200]
 */
export interface RetryOptions {
  /** 最多重试几次（总尝试次数 = retries + 1） */
  retries: number;
  /** 第一次重试前的基础等待时长 */
  baseDelayMs: number;
  /** 退避倍数，默认 2 */
  factor?: number;
  /** 等待时长上限，默认 Infinity */
  maxDelayMs?: number;
  /** 抖动函数，默认原样返回（测试时传恒等函数即可确定性断言） */
  jitter?: (delayMs: number) => number;
  /** 等待实现，默认真实 sleep（测试时注入假的） */
  sleep?: (ms: number) => Promise<void>;
  /** 这个错误值不值得重试，默认 true */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** 每次决定重试时回调一次 */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  throw new Error('TODO 6.7: 实现 retry');
}

/**
 * 练习 6.8 ⭐⭐⭐ —— mapConcurrent：并发上限 N 的 worker pool
 *
 * `Promise.all(items.map(fn))` 会**一次性**把 1000 个请求全发出去，直接把对端打挂。
 * 这题实现 Go 里 "buffered channel + N 个 goroutine" 的等价物。
 *
 * 规则：
 *   - 返回值顺序**严格对应输入顺序**（不是完成顺序！）
 *   - 任意时刻正在执行的 fn 不超过 limit 个
 *   - limit <= 0 时按 1 处理
 *   - items 为空时返回 []，且一次都不调用 fn
 *   - 任一任务失败 → 整体 reject（第一个失败的错误）
 *
 * await mapConcurrent([1, 2, 3], 2, async (n) => n * 2)   // [2, 4, 6]
 * await mapConcurrent([], 5, fn)                          // []
 */
export function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  throw new Error('TODO 6.8: 实现 mapConcurrent');
}

/**
 * 练习 6.9 ⭐⭐⭐ —— serialQueue：串行化执行器（解决"交错"）
 *
 * 单线程没有数据竞争，但**有交错**：两个协程在 `await` 之间互相插队，
 * "先查再写"就会写重。这题实现一个 FIFO 串行队列，把临界区排队起来
 * （≈ Java 的 `synchronized` / Go 的 mutex，但实现只需要一条 Promise 链）。
 *
 * 规则：
 *   - 任务按 run() 调用顺序 FIFO 执行，任意时刻只有一个在跑
 *   - run() 返回的 Promise 透传任务的 resolve / reject
 *   - **某个任务抛错不能卡死队列**，后面的任务照常执行
 *   - pending = 排队中 + 正在执行的任务数
 *
 * const q = createSerialQueue();
 * const log: string[] = [];
 * const a = q.run(async () => { log.push('a1'); await sleep(10); log.push('a2'); });
 * const b = q.run(async () => { log.push('b1'); await sleep(1);  log.push('b2'); });
 * q.pending === 2
 * await Promise.all([a, b]);
 * log === ['a1', 'a2', 'b1', 'b2']    // 没有交错！
 * q.pending === 0
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly pending: number;
}

export function createSerialQueue(): SerialQueue {
  throw new Error('TODO 6.9: 实现 createSerialQueue');
}

/**
 * 练习 6.10 ⭐⭐⭐ —— raceWithCleanup：竞速 + 取消输家
 *
 * `Promise.race` 的缺陷：第一个 settle 之后，其它任务**还在继续跑**，
 * 继续占连接、继续写日志、继续花钱。Go 的 errgroup + context 会取消它们。
 *
 * 这题给每个任务发一个 AbortSignal：谁先 settle 就用它的结果，
 * 然后 abort 掉其余所有任务的 signal。
 *
 * 规则：
 *   - 第一个 settle（fulfilled 或 rejected）的任务决定整体结果
 *   - 整体 settle 之后，立刻 abort 所有任务的 signal
 *   - tasks 为空 → reject 一个 Error，message 为 'no tasks'
 *   - 任务本身抛同步错误也要变成 reject（不能把同步异常漏出去）
 *
 * await raceWithCleanup([
 *   async () => { await sleep(1);  return 'fast'; },
 *   async (signal) => { await abortableDelay(500, signal); return 'slow'; },
 * ])   // 'fast'，且第二个任务的 signal.aborted 变成 true
 */
export function raceWithCleanup<T>(
  tasks: ReadonlyArray<(signal: AbortSignal) => Promise<T>>,
): Promise<T> {
  throw new Error('TODO 6.10: 实现 raceWithCleanup');
}

/**
 * 练习 6.11 ⭐⭐⭐ —— 异步生成器分页
 *
 * 把"游标分页的 HTTP 接口"包成一个异步迭代器，调用方只需要写
 * `for await (const item of paginate(fetchPage))`，完全看不见分页细节。
 * 第 09 章的流式 LLM 输出用的就是同一套机制。
 *
 * 规则：
 *   - 第一次调用 fetchPage 时 cursor 传 undefined
 *   - 逐个 yield 当前页的 items（不是整页 yield 出去）
 *   - nextCursor 为 undefined/null 时结束
 *   - **懒加载**：只有迭代到需要下一页时才去 fetch。
 *     调用方提前 break，就不该再发请求 —— 这是它比"先全量拉回来"强的地方
 *
 * const pages = [
 *   { items: ['a', 'b'], nextCursor: 'c2' },
 *   { items: ['c'] },
 * ];
 * for await (const x of paginate(async (cursor) => ...)) { ... }
 *   // 依次拿到 'a', 'b', 'c'
 */
export interface Page<T> {
  items: T[];
  nextCursor?: string | undefined;
}

export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  throw new Error('TODO 6.11: 实现 paginate');
}

/**
 * 练习 6.12 ⭐⭐⭐ —— 综合：debounceAsync
 *
 * 尾部去抖（trailing debounce）：CLI 的 watch 模式、Agent 的"用户还在打字"
 * 场景都要用。密集调用只在**安静 waitMs 之后**真正执行一次。
 *
 * 规则：
 *   - waitMs 内的多次调用合并为一次：只用**最后一次**的参数调用 fn
 *   - 这段时间内的**所有**调用方都拿到同一次 fn 的结果（成功或失败都共享）
 *   - fn 失败时，所有等待中的调用方都 reject 同一个错误
 *   - cancel() 让还在等待的调用方 reject 一个 AbortError，并取消这次执行
 *   - 一轮结束后再调用，会开启新的一轮
 *
 * const calls: number[] = [];
 * const d = debounceAsync(async (n: number) => { calls.push(n); return n * 2; }, 20);
 * const [a, b, c] = await Promise.all([d(1), d(2), d(3)]);
 * // calls === [3]（只调了一次，用的是最后一次的参数）
 * // a === b === c === 6
 */
export interface DebouncedAsync<A extends unknown[], R> {
  (...args: A): Promise<R>;
  /** 取消尚未执行的那一次调用，等待中的 Promise 会 reject AbortError */
  cancel(): void;
}

export function debounceAsync<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  waitMs: number,
): DebouncedAsync<A, R> {
  throw new Error('TODO 6.12: 实现 debounceAsync');
}
