/**
 * 第 10 章练习 · 测试与质量保障
 * =====================================================================
 * 对应文档：docs/10-testing-and-quality.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch10`  或者 `pnpm vitest tests/ch10`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch10-testing.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 这一章的练习有个特点：**你要实现的东西本身就是测试工具**。
 * 手写一遍 spy / 断言辅助 / 假时钟 / 内存假文件系统之后，
 * 你就明白 `vi.fn()` / `expect` / `vi.useFakeTimers()` 到底在干什么，
 * 也会顺手写出「天生可测」的业务代码。
 * =====================================================================
 */

/**
 * 练习 10.1 ⭐ —— once：只执行一次的包装器
 *
 * 返回一个新函数：
 *   - 第一次调用时执行 fn 并缓存返回值
 *   - 之后每次调用直接返回缓存值，**不再调用 fn**
 *   - 如果第一次调用抛错，则缓存这个错误，后续每次调用都重新抛出**同一个**错误
 *     （不重试 —— 这一点和 Java 的懒加载单例踩过的坑一样）
 *
 * const spy = vi.fn(() => 42);
 * const f = once(spy);
 * f() === 42; f() === 42; spy 只被调用了 1 次
 */
export function once<T>(fn: () => T): () => T {
  throw new Error('TODO 10.1: 实现 once');
}

/**
 * 练习 10.2 ⭐⭐ —— formatDuration：表驱动测试的经典靶子
 *
 * 把毫秒数格式化成人类可读的时长。规则**按顺序**判断：
 *   - ms 不是有限数字、或 ms < 0        -> 抛 RangeError
 *   - ms 不是整数                        -> 先 Math.floor 向下取整
 *   - ms < 1000                          -> `${ms}ms`
 *   - ms < 60_000                        -> 秒，保留 1 位小数（Math.round(ms / 100) / 10），
 *                                            结果为整数时不带小数点
 *   - ms < 3_600_000                     -> `${分}m${秒}s`，分/秒都向下取整，秒为 0 时省略 `0s`
 *   - 否则                                -> `${时}h${分}m`，都向下取整，分为 0 时省略 `0m`
 *
 * formatDuration(0)         === '0ms'
 * formatDuration(999)       === '999ms'
 * formatDuration(1000)      === '1s'
 * formatDuration(1500)      === '1.5s'
 * formatDuration(1050)      === '1.1s'      // 四舍五入到 1 位小数
 * formatDuration(59_999)    === '60s'       // 😱 边界很丑，但规则如此 —— 表驱动测试就是用来暴露它的
 * formatDuration(60_000)    === '1m'
 * formatDuration(90_000)    === '1m30s'
 * formatDuration(3_600_000) === '1h'
 * formatDuration(7_500_000) === '2h5m'
 * formatDuration(-1)        -> 抛 RangeError
 */
export function formatDuration(ms: number): string {
  throw new Error('TODO 10.2: 实现 formatDuration');
}

/**
 * 练习 10.3 ⭐⭐ —— collectAsync：把异步可迭代对象收集成数组
 *
 * 相当于 Java 的 `stream.collect(toList())`，但源是异步的。
 * 测试异步流（SSE / OpenAI 流式输出 / 逐行读文件）时几乎必写这个工具。
 *
 * async function* gen() { yield 1; yield 2; }
 * await collectAsync(gen())            -> [1, 2]
 * 源中途抛错 -> collectAsync 返回的 Promise 也要 reject（不要吞异常）
 */
export function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  throw new Error('TODO 10.3: 实现 collectAsync');
}

/**
 * 练习 10.4 ⭐⭐ —— createSpy：手写一个 spy（不许用 vi.fn）
 *
 * 这就是 `vi.fn()` / Mockito `verify()` 背后的全部秘密：一个闭包 + 两个数组。
 *
 * 要求：
 *   - 返回值本身是可调用的函数
 *   - 每次调用都把参数追加到 `calls`
 *   - 每次调用都把「参数 + 结果」追加到 `records`，结果分两种：
 *       { type: 'return', value } / { type: 'throw', error }
 *   - impl 抛错时：先记录 records，再把错误**原样抛出去**
 *   - 没传 impl 时：调用返回 undefined（用 `undefined as R` 兜住类型）
 *   - callCount() 返回调用次数；lastCall() 返回最后一次的参数（没调用过返回 undefined）
 *   - reset() 清空 calls 和 records（**不改 impl** —— 对应 vitest 的 mockClear 而不是 mockReset）
 *
 * const spy = createSpy<[string, number], string>((s, n) => s.repeat(n));
 * spy('ab', 2) === 'abab'
 * spy.calls          -> [['ab', 2]]
 * spy.callCount()    -> 1
 * spy.records[0]     -> { args: ['ab', 2], outcome: { type: 'return', value: 'abab' } }
 */
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
  throw new Error('TODO 10.4: 实现 createSpy');
}

/**
 * 练习 10.5 ⭐⭐ —— assertThrows：手写断言辅助
 *
 * 执行 fn，要求它必须抛错，并按 matcher 校验；校验通过就把抛出的值**返回**给调用方
 * （这样调用方还能继续断言 error 上的字段，比 try/catch 干净得多）。
 *
 * matcher 的四种形态（运行时要能区分）：
 *   - string          -> error.message 必须【包含】该子串
 *   - RegExp          -> error.message 必须匹配
 *   - Error 的子类     -> error 必须是它的实例
 *   - 谓词函数         -> 调用它，必须返回 true
 *   - 不传             -> 只要求抛了错
 *
 * 失败时抛出 Error，消息要求：
 *   - fn 没抛错          -> 消息以 'expected function to throw' 开头
 *   - matcher 不匹配      -> 消息以 'thrown error did not match' 开头
 *
 * 提示：怎么区分「Error 子类」和「谓词函数」？两者 typeof 都是 'function'。
 *       看 `m === Error || m.prototype instanceof Error`。
 *
 * assertThrows(() => { throw new TypeError('bad input'); }, TypeError) -> 那个 TypeError
 * assertThrows(() => { throw new Error('bad input'); }, 'bad')          -> 那个 Error
 * assertThrows(() => 1)  -> 抛 Error('expected function to throw...')
 */
export type ErrorClass = new (...args: never[]) => Error;

export type ErrorMatcher = string | RegExp | ErrorClass | ((error: unknown) => boolean);

export function assertThrows(fn: () => unknown, matcher?: ErrorMatcher): unknown {
  throw new Error('TODO 10.5: 实现 assertThrows');
}

/**
 * 练习 10.6 ⭐⭐ —— createInMemoryFs + saveReport：依赖注入代替模块 mock
 *
 * 第一部分：实现一个满足 MiniFs 接口的内存假文件系统。
 *   - readFile：路径不存在时 reject，错误消息必须包含 'ENOENT'（对齐 node:fs 的行为）
 *   - writeFile：覆盖写
 *   - exists：存在与否
 *   - snapshot()：返回当前所有文件的浅拷贝，方便测试直接 toEqual
 *   - initial 参数：预置文件内容
 *
 * 第二部分：实现 saveReport —— 一个**只依赖 MiniFs 接口**的业务函数。
 *   这就是本章的核心主张：不要 `import { writeFile } from 'node:fs/promises'`，
 *   而是把 fs 当参数传进来。这样测试连 mock 都不需要。
 *   行为：
 *     - 如果 path 已存在：先把旧内容写到 `${path}.bak`，再写新内容
 *     - 如果不存在：直接写
 *     - 写入内容是 JSON.stringify(data, null, 2)
 *
 * const fs = createInMemoryFs({ '/r.json': 'old' });
 * await saveReport(fs, '/r.json', { ok: true });
 * fs.snapshot() -> { '/r.json': '{\n  "ok": true\n}', '/r.json.bak': 'old' }
 */
export interface MiniFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface InMemoryFs extends MiniFs {
  snapshot(): Record<string, string>;
}

export function createInMemoryFs(initial?: Record<string, string>): InMemoryFs {
  throw new Error('TODO 10.6: 实现 createInMemoryFs');
}

export function saveReport(fs: MiniFs, path: string, data: unknown): Promise<void> {
  throw new Error('TODO 10.6: 实现 saveReport');
}

/**
 * 练习 10.7 ⭐⭐⭐ —— deepEqual：手写结构相等
 *
 * 这题是为了让你彻底搞懂 `toBe`（引用相等）和 `toEqual`（结构相等）的区别 ——
 * 从 Java 过来最容易在这里想当然。
 *
 * 规则：
 *   - 非对象（原始值、函数）用 Object.is 语义：
 *       deepEqual(NaN, NaN)  === true   （注意 NaN === NaN 是 false！）
 *       deepEqual(0, -0)     === false  （注意 0 === -0 是 true！）
 *   - null 只等于 null
 *   - Date 比较 getTime()；两个 Invalid Date（getTime 是 NaN）算相等
 *   - 数组：长度相同 + 逐项 deepEqual；数组和非数组永远不相等
 *   - 普通对象：自身可枚举键的**集合**相同（顺序无关）+ 逐值 deepEqual
 *   - 其它对象（Map / Set / class 实例 / RegExp…）不要求深比较，用 Object.is 兜底
 *   - **循环引用**：结构相同的自引用对象要返回 true，不能栈溢出
 *     （提示：用一对 WeakMap/Set 记录「正在比较中的 a-b 组合」）
 *
 * deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }) === true
 * deepEqual({ a: 1 }, { a: 1, b: undefined })           === false  // 键集合不同
 * const x: any = { self: null }; x.self = x;
 * const y: any = { self: null }; y.self = y;
 * deepEqual(x, y) === true
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  throw new Error('TODO 10.7: 实现 deepEqual');
}

/**
 * 练习 10.8 ⭐⭐⭐ —— sanitizeSnapshot：让快照稳定下来
 *
 * 快照测试（snapshot testing）最大的敌人是「每次都变的东西」：时间戳、绝对路径、
 * 随机 ID、耗时。实战做法是在断言前把它们替换成占位符。
 *
 * 按**这个顺序**做 4 次全局替换：
 *   1. ISO 时间戳  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/  -> '<TIMESTAMP>'
 *   2. UUID        8-4-4-4-12 的十六进制（大小写不敏感）              -> '<UUID>'
 *   3. 绝对路径     以 / 开头、**至少两段**的 Unix 路径（段内只含 \w . -）-> '<PATH>'
 *   4. 耗时         整数或小数后面紧跟 ms / s（前后是单词边界）        -> '<DURATION>'
 *
 * 顺序很重要：先替时间戳，否则 '12:34:56' 里的数字会被后面的规则啃掉。
 * 相对路径（如 'docs/01.md'）和单段路径（如 '/tmp'）**不替换**。
 *
 * sanitizeSnapshot('[2024-03-01T12:34:56.789Z] ok in 1.5s -> /home/j/out/r.json')
 *   === '[<TIMESTAMP>] ok in <DURATION> -> <PATH>'
 * sanitizeSnapshot('timeout after 30000ms') === 'timeout after <DURATION>'
 * sanitizeSnapshot('id=3f2504e0-4f89-11d3-9a0c-0305e82c3301') === 'id=<UUID>'
 */
export function sanitizeSnapshot(text: string): string {
  throw new Error('TODO 10.8: 实现 sanitizeSnapshot');
}

/**
 * 练习 10.9 ⭐⭐⭐ —— createStubClock：可手动推进的假时钟
 *
 * 这是本章最有价值的一题。有了它，测「重试退避 / debounce / 超时」这类逻辑
 * 就不需要 `vi.useFakeTimers()`，也不需要真的 sleep 3 秒。
 *
 * Clock 是给生产代码用的**最小接口**（只有 now + sleep）；
 * StubClock 多出来的 advance / pending 只给测试用。
 *
 * 语义：
 *   - now() 初始为 startMs（默认 0）
 *   - sleep(ms) 返回一个 Promise，在时钟被推进到 `调用时的 now() + ms` 或更晚时 resolve。
 *     ms < 0 抛 RangeError。
 *   - advance(ms)：ms < 0 抛 RangeError。把时间推进 ms，并按到期时间**从早到晚**依次唤醒
 *     所有到期的 sleep。两个关键细节：
 *       a) **进入循环之前先 `await` 一次宏任务**（`setImmediate`），让调用 advance 之前
 *          就已经在排队的代码有机会先注册它们的 sleep（否则那些 sleep 会以推进后的
 *          时间为基准注册，永远等不到唤醒，测试直接超时挂死 😱）
 *       b) 每唤醒一个 sleep 之后再 `await` 一次宏任务，让被唤醒的代码有机会注册
 *          下一个 sleep —— 所以连续的 `await sleep()` 链能在一次 advance 里级联跑完
 *          （对应 vitest 的 advanceTimersByTimeAsync）
 *     全部处理完后 now() 等于目标时间。
 *   - pending() 返回还没被唤醒的 sleep 个数
 *
 * const clock = createStubClock();
 * const log: number[] = [];
 * void (async () => { await clock.sleep(100); log.push(1); await clock.sleep(100); log.push(2); })();
 * await clock.advance(100);  // log -> [1]，now() -> 100
 * await clock.advance(100);  // log -> [1, 2]，now() -> 200
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface StubClock extends Clock {
  advance(ms: number): Promise<void>;
  pending(): number;
}

export function createStubClock(startMs?: number): StubClock {
  throw new Error('TODO 10.9: 实现 createStubClock');
}

/**
 * 练习 10.10 ⭐⭐⭐ —— debounce：只依赖 Clock 接口
 *
 * 返回一个包装函数：
 *   - 每次调用都重新开始计时
 *   - 距离**最后一次**调用过了 ms 之后，用**最后一次**的参数调用 fn 一次
 *   - ms < 0 抛 RangeError
 *
 * 难点：clock.sleep() 没有 cancel。提示：用一个自增序号当「代」标记，
 * sleep 醒来后发现自己不是最新的一代就直接返回。
 *
 * const clock = createStubClock();
 * const spy = createSpy<[string]>();
 * const d = debounce(spy, 100, clock);
 * d('a'); await clock.advance(50);
 * d('b'); await clock.advance(50);   // 距 'b' 只过了 50ms，还不该触发
 * spy.callCount() === 0
 * await clock.advance(50);
 * spy.calls -> [['b']]               // 只触发一次，参数是最后一次的
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  clock: Clock,
): (...args: A) => void {
  throw new Error('TODO 10.10: 实现 debounce');
}

/**
 * 练习 10.11 ⭐⭐⭐ —— retryWithClock：指数退避重试
 *
 * 和第 06 章的重试呼应，但这次时钟是注入的，所以测试跑起来是 0 毫秒。
 *
 * 语义：
 *   - attempt 从 1 开始传给 fn；总尝试次数 = retries + 1
 *   - fn 成功就立刻返回它的结果
 *   - fn 失败：若还有剩余次数，等待 `baseDelayMs * 2 ** (attempt - 1)` 再重试
 *   - 次数用尽后抛出**最后一次**的错误（不要包装、不要吞掉）
 *   - retries < 0 或 baseDelayMs < 0 抛 RangeError
 *
 * retries=3, baseDelayMs=100 时，四次尝试发生在 t = 0, 100, 300, 700
 * （延迟依次是 100 / 200 / 400）—— 测试就断言这个时间序列。
 */
export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  clock: Clock;
}

export function retryWithClock<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  throw new Error('TODO 10.11: 实现 retryWithClock');
}

/**
 * 练习 10.12 ⭐⭐⭐ 综合 —— createMiniRunner：写一个迷你测试框架
 *
 * 把整章串起来：闭包收集 + 串行 async 执行 + try/finally 清理 + 错误归一化。
 * 写完你就知道 vitest 的 describe/it/beforeEach 是怎么工作的了。
 *
 * 要求：
 *   - test(name, fn) 注册一个测试；skip(name) 注册一个跳过的测试
 *   - run() 按**注册顺序串行**执行（不是并发！），返回每个测试的结果
 *   - 每个测试前跑 hooks.beforeEach，后跑 hooks.afterEach
 *   - afterEach **即使测试失败也必须执行**（try/finally）
 *   - 测试抛错 -> { status: 'fail', error: 归一化后的消息 }
 *     归一化：`e instanceof Error ? e.message : String(e)`
 *   - beforeEach 抛错 -> 该测试记为 fail，error 前缀 'beforeEach: '，
 *     并且**不执行**测试体，但仍要执行 afterEach
 *   - afterEach 抛错 -> 该测试记为 fail，error 前缀 'afterEach: '
 *     （如果测试体已经失败了，保留测试体的错误，afterEach 的错误丢掉）
 *   - skip 的测试：{ status: 'skip' }，不跑测试体也不跑任何 hook
 *   - 成功：{ status: 'pass' }，且**没有 error 字段**（用 toEqual 断言得住）
 *   - run() 可以反复调用，每次都完整重跑
 *
 * const r = createMiniRunner();
 * r.test('ok', () => {});
 * r.test('bad', () => { throw new Error('boom'); });
 * r.skip('later');
 * await r.run()
 *   -> [{ name: 'ok', status: 'pass' },
 *       { name: 'bad', status: 'fail', error: 'boom' },
 *       { name: 'later', status: 'skip' }]
 */
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

export function createMiniRunner(hooks?: MiniHooks): MiniRunner {
  throw new Error('TODO 10.12: 实现 createMiniRunner');
}
