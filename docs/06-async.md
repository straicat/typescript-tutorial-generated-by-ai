# 06 · 异步编程：单线程、事件循环、Promise

> 本章目标：把脑子里的「线程池 + 锁 + 阻塞 IO」模型**整块换掉**。
>
> 这是全书最重要的一章。Java/Go 里你靠"多开线程/协程 + 加锁"解决并发，TS 里
> **只有一个线程**，靠事件循环调度：没有锁可加也不需要锁，但换来一套新的坑
> —— 忘记 `await`、交错、未处理的 rejection、任务无法取消。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 并发模型 | 线程池 / goroutine（多核并行） | **单线程 + 事件循环**（并发但不并行） | 🔴 高 |
| CPU 密集任务 | 占一个线程，别人照跑 | **卡死整个进程**（连健康检查都不响应） | 🔴 高 |
| 阻塞 IO | `InputStream.read()` / `conn.Read()` 阻塞线程 | **没有阻塞 IO 这回事**，全是 Promise | 🔴 高 |
| 忘记等待 | 编译器 / `go vet` 会提醒 | 少写一个 `await` 静默错，`if (promise)` 永远为真 | 🔴 高 |
| 未捕获异常 | 线程死，进程活 | 未处理的 rejection **默认让整个进程退出** | 🔴 高 |
| 加锁 | `synchronized` / `sync.Mutex` / channel | **不需要**（无数据竞争），但要防"交错" | 🟡 中 |
| 睡眠 | `Thread.sleep(1000)` / `time.Sleep` | `await sleep(1000)`（不阻塞线程） | 🟢 低 |
| 异步结果 | `Future` / `CompletableFuture` | `Promise<T>`（**创建即启动**，没有冷 Task） | 🟡 中 |
| 取消 / 超时 | `context.Context` / `Future.cancel` | `AbortController` / `AbortSignal` | 🔴 高 |
| 等一批任务 | `WaitGroup` / `invokeAll` | `Promise.all` / `Promise.allSettled` | 🟢 低 |
| 取消兄弟任务 | `errgroup` 自动 cancel ctx | `Promise.all` **不取消**其它任务，得自己发 signal | 🔴 高 |
| 并发限流 | 线程池大小 / buffered channel | 自己写 worker pool | 🟡 中 |
| 真多线程 | 默认就是 | `worker_threads` / `child_process`（重量级、少用） | 🟡 中 |
| 遍历 + 异步 | `for` 里直接调 | `arr.forEach(async ...)` **不会等** | 🔴 高 |

---

## 1. 事件循环：只有一个线程在跑你的代码

Node 进程里有很多线程（libuv 线程池做文件 IO、DNS、加密），但**你写的 JS 只在一个线程上跑**：

```
┌───────────────────────── 一轮 tick ─────────────────────────┐
│ ① 执行【调用栈】上的同步代码，直到栈空                        │
│ ② 排空【微任务队列】：Promise.then/catch/finally、           │
│      queueMicrotask、await 之后的那半截代码                  │
│      ⚠️ 微任务里再产生微任务，也必须在这一步【全部】跑完        │
│ ③ 走一圈【宏任务】阶段：timers(setTimeout) → pending →       │
│      poll(IO) → check(setImmediate) → close                 │
│      每执行完一个宏任务回调，立刻回到 ② 排空微任务             │
└─────────────────────────────────────────────────────────────┘
```

**结论 1：`setTimeout(fn, 0)` 不是"立刻"。** 它只是排到下一轮 timers 阶段，位于**所有**
微任务之后。想"尽快但让出一次"，微任务用 `queueMicrotask`，宏任务用 `setImmediate`。

**结论 2：CPU 密集会卡死整个进程。**

```ts
setTimeout(() => console.log('我想 1ms 后执行'), 1);
fib(42);   // 😱 纯 CPU 跑几秒。期间定时器不触发、HTTP 不响应、Ctrl+C 也要排队
```

Go 的调度器是**抢占式**的，`fib(42)` 占一个 P，别的 goroutine 照样被调度到别的 P；
Java 里 OS 会把线程切走。**Node 没有任何人能把你切走** —— 不主动 `await` 就永不让出。
所以 IO 密集（HTTP / 文件 / DB）Node 极强，CPU 密集必须挪出主线程（见第 11 节）。

### 经典输出顺序题

```ts
console.log('1');
setTimeout(() => console.log('2 setTimeout'), 0);
Promise.resolve().then(() => console.log('3 then'));
queueMicrotask(() => console.log('4 queueMicrotask'));
setImmediate(() => console.log('5 setImmediate'));
process.nextTick(() => console.log('6 nextTick'));
console.log('7');
```

**能确定的**：`1` → `7`（同步先跑完）→ `3 then` → `4 queueMicrotask`（微任务，按注册顺序）
→ 最后才轮到宏任务 `2` / `5`。

**不能确定的**（面试题常写错，实测就知道）：

- `6 nextTick` 的位置取决于模块类型：CJS 里在所有 promise 微任务**之前**，
  ESM 里在**之后**（ESM 模块体本身就跑在 promise 上下文里）。
  → **别用 `process.nextTick` 写业务逻辑**，它是 Node 内部机制的遗留物。
- `2 setTimeout`（timers 阶段）和 `5 setImmediate`（check 阶段）谁先，**跑两次就会变**。
  → **任何依赖"宏任务之间相对顺序"的代码都是错的**，包括测试。

---

## 2. 好消息：没有数据竞争。坏消息：有"交错"

单线程意味着**两段 JS 代码永远不会同时执行**，所以这些在 Java/Go 里必须加锁的操作天然安全：

```ts
let counter = 0;
counter += 1;   // ✅ 不需要 synchronized / atomic.AddInt64：读-改-写之间没有 await
```

**但 `await` 是一个明确的让出点**。它前后不是同一个时刻，中间可能跑了几百个别的任务：

```ts
const rows: string[] = [];

async function upsert(name: string): Promise<void> {
  const exists = rows.includes(name);   // ① 检查
  await saveToDb(name);                 // ② 让出！别的任务在这里插进来了
  if (!exists) rows.push(name);         // ③ 用的是【过期】的 exists  😱
}

await Promise.all([upsert('a'), upsert('a')]);
console.log(rows);   // ['a', 'a'] —— 单线程也照样写重了
```

这不是数据竞争（没有撕裂的内存），而是**逻辑交错**。修法是把临界区串行化，
不需要 mutex，一条 Promise 链就够：

```ts
function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(() => task());
      tail = result.catch(() => undefined);   // ✅ 前一个失败不能毒死队列
      return result;
    },
  };
}

const q = createSerialQueue();
await Promise.all([q.run(() => upsert('a')), q.run(() => upsert('a'))]);   // rows === ['a'] ✅
```

> **心法**：Java 里你找 `synchronized` 块，TS 里你找 **`await` 两侧的共享状态**。

---

## 3. Promise：三态 + 立即执行

`Promise<T>` ≈ `CompletableFuture<T>`，**一旦离开 pending 就永远不变**：

```
pending ──resolve(value)──> fulfilled  (拿到 T)
        └─reject(error)───> rejected   (拿到 unknown)
```

重复 `resolve` / `reject` 会被**静默忽略** —— 这是特性：包装回调 API 时不用自己去重。

### 什么时候需要手写 `new Promise`

**只有一种情况：包装回调风格的老 API。** 其它场合都用 `async` 函数。

```ts
import { readFile } from 'node:fs';

function readFileP(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    readFile(path, 'utf8', (err, data) => {
      if (err != null) reject(err);   // err 可能是 null 也可能是 undefined
      else resolve(data);
    });
  });
}

// ❌ 反模式（Promise constructor anti-pattern）：本来就有 Promise 还包一层
//    new Promise((resolve) => { readFileP(p).then(resolve); })  😱 错误被吞了
//    正确做法就是直接 return readFileP(p)
```

> Node 内置模块基本都有 promise 版：`node:fs/promises`、`node:dns/promises`、
> `node:timers/promises`、`node:stream/promises`。优先用它们；实在要包，
> 用 `import { promisify } from 'node:util'`。练习 6.3 会让你手写一遍。

### Promise 是**立即执行**的

```ts
const p = task('A');       // 👈 这一行 task 就已经开始跑了
console.log('主流程继续');
const r = await p;         // await 只决定"在哪里等结果"
```

| | 创建 | 启动 |
| --- | --- | --- |
| Go goroutine | —— | 必须写 `go f()` |
| C# 冷 `Task` | `new Task(...)` | 必须 `.Start()` |
| **TS Promise** | 调用 async 函数 | **同一刻就开始了** |

两个实用推论：

```ts
// ① 想并发就先全部创建，再一起 await
const a = fetchUser(), b = fetchOrders();          // 两个请求已经同时在飞
const [user, orders] = await Promise.all([a, b]);
const u2 = await fetchUser(); const o2 = await fetchOrders();   // ❌ 这是串行

// ② 想"延迟启动"必须包一层函数（thunk）——这就是并发池 API 收
//    `() => Promise<T>` 而不是 `Promise<T>` 的原因
const tasks: Array<() => Promise<string>> = [() => task('A'), () => task('B')];
```

**`then / catch / finally`**：新代码基本只写 `async/await`，但组合时它们仍好用 ——
`p.then(map)` 映射结果、`p.catch(fn)` 只处理错误、`p.finally(fn)` 清理资源
（**不改变结果、无参数**）；`Promise.resolve(v)` / `Promise.reject(e)` 直接造已 settle 的 Promise。

---

## 4. `async` / `await`

```ts
async function one(): Promise<number> {
  return 1;                 // async 函数【永远】返回 Promise；声明成 `: number` 直接编译报错
}

async function main(): Promise<void> {
  try {
    const user = await fetchUser();   // ✅ 错误用 try/catch，写法和 Java 一样
  } catch (error) {                   // error 类型是 unknown（见第 07 章）
    console.error(error);
  } finally {
    await cleanup();                  // finally 里也能 await
  }
}

const x = await 42;         // 合法（自动包一层），但白花一个微任务

// 顶层 await（top-level await）：只有 ESM 有。本项目 "type": "module"，所以 CLI 入口
// 不需要 `(async () => { ... })()` 这种立即执行函数包装：
const config = await loadConfig();

// for await...of：遍历异步可迭代对象（异步生成器、Node Stream、LLM 流式响应）
for await (const chunk of stream) process.stdout.write(chunk);
```

---

## 5. 最常见的四个 bug

### bug 1：忘记 `await`

```ts
const n = getCount();          // 😱 类型是 Promise<number>，不是 number
if (getCount()) { ... }        // 😱😱 Promise 是对象 → 永远是真值，分支永远进

function handler(): void {
  save();      // 😱「浮动的 Promise」：函数已返回，save 还在跑，失败了也没人知道
}
```

**防御手段**：开 ESLint 规则 `@typescript-eslint/no-floating-promises`（第 10 章配）。
它强制你对每个 Promise 表态，价值等同于 Go 里的 `errcheck`，**新项目第一天就开**：

```ts
await save();              // ✅ 等它
void save();               // ✅ 明确"我故意不等"
save().catch(logError);    // ✅ 最推荐的"故意不等"写法
```

### bug 2：在 `forEach` / `map` 里写 `async`

```ts
ids.forEach(async (id) => { await save(id); });   // 😱 回调返回值被丢弃，这行 0ms 就"跑完"
console.log('全部保存完成');                       // 骗人：一个都没完成

for (const id of ids) await save(id);            // ✅ 串行（有依赖 / 要限流）
await Promise.all(ids.map((id) => save(id)));    // ✅ 并发（互相独立）
```

记住：**`map` 返回的是 `Promise<T>[]` 不是 `T[]`**；`forEach` 更糟，连数组都不返回。
既要并发又要限流 → 第 6 节的 `mapConcurrent`。

### bug 3：`try/catch` 包不住没 `await` 的 Promise

```ts
try { save(); } catch (e) { /* 😱 永远不执行：rejection 发生在 try 块结束之后 */ }
try { await save(); } catch (e) { /* ✅ */ }
```

同理，`try` 块里 `return somePromise` 会**先离开 try 再 settle**，catch 抓不到。
在 `try` 里始终写 `return await`。

### bug 4：未处理的 rejection 会让进程退出

```ts
Promise.reject(new Error('nobody catches me'));
// Node 20+ 默认：打印错误 + 进程以退出码 1 结束
```

Java 里一个线程抛异常别的线程照跑，Node 里这**干掉整个进程**。长生命周期的
CLI / Agent 入口一定要兜底：

```ts
process.on('unhandledRejection', (reason) => { console.error('[fatal]', reason); process.exitCode = 1; });
process.on('uncaughtException', (error) => { console.error('[fatal]', error); process.exitCode = 1; });
```

> ⚠️ 这是**最后一道防线：记日志然后体面退出**，不是"忽略错误继续跑"的许可证 ——
> 此时进程状态已不可信。

---

## 6. 并发控制

| 方法 | 何时 settle | 结果 | Java/Go 类比 |
| --- | --- | --- | --- |
| `Promise.all` | 全部成功，或**任一失败**（快速失败） | `T[]`（顺序 = 输入顺序） | `WaitGroup` + 第一个 error |
| `Promise.allSettled` | **全部** settle（永不 reject） | `{status, value?, reason?}[]` | 收集每个任务的结果 |
| `Promise.race` | **第一个** settle（成功失败都算） | 那一个的结果 | `select` 第一个就绪的 case |
| `Promise.any` | 第一个**成功**；全失败才 reject | 值 / `AggregateError` | 任一副本可用即可 |

```ts
const [a, b] = await Promise.all([fetchA(), fetchB()]);        // 全都得成功

const results = await Promise.allSettled([fetchA(), fetchB()]); // 允许部分失败
for (const r of results) {
  if (r.status === 'fulfilled') console.log('ok', r.value);
  else console.error('failed', r.reason);                       // reason 不一定是 Error
}

const fastest = await Promise.any([fromCache(), fromOrigin()]); // 主备双活，谁快用谁
```

### ⚠️ `Promise.all` 失败时，其它任务**不会被取消**

```ts
await Promise.all([
  fetchA(),   // 3s 后成功
  fetchB(),   // 100ms 后失败
]);
// 100ms 时整体就 reject 了，但 fetchA 还在后台跑完那 3 秒：
// 连接占着、日志还打、token 还烧钱、可能还会写库  😱
```

Go 的 `errgroup.WithContext` 会在第一个 error 时 cancel 整个 ctx，兄弟任务立刻收到信号。
**TS 里没有这个机制**，必须自己把 `AbortSignal` 传下去（第 7 节 + 练习 6.10）。

### 并发上限 N：worker pool

`Promise.all(items.map(fn))` 对 1000 个 item 会**同时**发 1000 个请求：对端限流、
`EMFILE`、内存爆。Go 里用 buffered channel 当信号量
（`sem := make(chan struct{}, 5)`），TS 里的等价物是"固定开 N 个 worker，从同一个游标抢活"：

```ts
export function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return Promise.resolve([]);

  const jobs = items.map((item, index) => ({ item, index }));
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, jobs.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const job = jobs[cursor];
      cursor += 1;                       // ✅ 单线程，自增不需要锁
      if (job === undefined) return;     // 兼作终止条件（noUncheckedIndexedAccess）
      results[job.index] = await fn(job.item, job.index);   // ✅ 按下标写回
    }
  }

  return Promise.all(Array.from({ length: width }, () => worker())).then(() => results);
}

const bodies = await mapConcurrent(urls, 5, (url) => fetchText(url));
```

`results[job.index] = ...` 保证**返回顺序 = 输入顺序**，而不是完成顺序。

---

## 7. 超时与取消：`AbortSignal` 就是 `context.Context`

| Go | TypeScript |
| --- | --- |
| `ctx, cancel := context.WithCancel(ctx)` | `const c = new AbortController()` |
| `cancel()` | `c.abort()` |
| 参数 `ctx context.Context` | 选项字段 `signal?: AbortSignal` |
| `<-ctx.Done()` | `signal.addEventListener('abort', ...)` |
| `ctx.Err() != nil` | `signal.aborted === true` |
| `context.WithTimeout(ctx, 5*time.Second)` | `AbortSignal.timeout(5000)` |
| 合并多个 ctx（要手写） | `AbortSignal.any([a, b])` ✅ 内置 |

```ts
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());                  // Ctrl+C → 取消在跑的任务

const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
const res = await fetch(url, { signal });                        // fetch 原生支持
signal.throwIfAborted();                                          // 想主动检查点就调它
```

### 让**自己的**异步函数支持取消（三步套路）

```ts
export class AbortError extends Error {
  constructor(message = 'The operation was aborted') {
    super(message);
    this.name = 'AbortError';        // ✅ 对齐 Web 标准，调用方靠 name 判断
  }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) return reject(new AbortError());   // ① 进门先检查

    const onAbort = (): void => { clearTimeout(timer); reject(new AbortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);                 // ③ 成功也要摘监听
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });       // ② 监听 abort
  });
}
```

漏掉 ① 会让"已取消的 signal"白等一整个超时；漏掉 ③ 会在长生命周期 signal 上攒一堆闭包。

### `Promise.race` 做超时的缺陷

```ts
const result = await Promise.race([slowQuery(), rejectAfter(5000)]);
```

`race` 只改变**你什么时候拿到结果**，不改变**对端还在处理**：连接、查询、LLM token
都不会停。所以：只想"给个上限别卡住" → `race` 够用（练习 6.4 的 `withTimeout`）；
想真正释放资源 → 必须把 `signal` 传到最底层的 IO。

### `setTimeout` 的 `unref`

Node 只要还有活跃定时器就不会退出 —— 这是"活都干完了 CLI 却卡着不退"的头号原因：

```ts
const timer = setTimeout(onTick, 60_000);
timer.unref();          // ✅ 告诉事件循环：别为了我一直活着
// 或者在所有出口 clearTimeout(timer)（withTimeout 里的 .finally 就是干这个的）
```

---

## 8. 重试与退避

调 LLM / 第三方 API 必备：指数退避（exponential backoff）+ 抖动（jitter，
避免一群客户端同时重试形成尖峰）。

```ts
async function retry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  const {
    retries, baseDelayMs, factor = 2, maxDelayMs = Infinity,
    jitter = (d: number) => d * (0.5 + Math.random() * 0.5),   // full jitter
    sleep: sleepFn = abortableDelay, shouldRetry = () => true, signal,
  } = o;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    signal?.throwIfAborted();                   // 每轮开头检查取消
    try {
      return await fn(attempt);                 // ✅ 必须 await，否则 catch 抓不到
    } catch (error) {
      lastError = error;
      if (attempt > retries) break;             // ✅ 最后一次失败后不要再等
      if (!shouldRetry(error)) break;           // 4xx 重试没意义
      await sleepFn(jitter(Math.min(baseDelayMs * factor ** (attempt - 1), maxDelayMs)), signal);
    }
  }
  throw lastError;
}
```

三个容易写错的点，练习 6.7 全都会测：

1. `return fn(attempt)` 少个 `await` → 错误逃出 `catch`，重试形同虚设
2. 最后一次失败后还 `sleep` 一轮 → 白等好几秒
3. 把 `sleep` / `jitter` 写死 → 单测要跑 7 秒还 flaky。**做成可注入参数**

---

## 9. `node:timers/promises`：别自己写 sleep

```ts
import { setTimeout as sleep, setInterval as tick, scheduler } from 'node:timers/promises';

await sleep(1000);                            // ✅ Thread.sleep 的对应物（不阻塞线程）
await sleep(1000, undefined, { signal });     // ✅ 原生支持 AbortSignal
const v = await sleep(1000, 'done');          // 可以顺带 resolve 一个值

for await (const _ of tick(500, undefined, { signal })) {   // 异步 interval，比 setInterval 可控
  await pollOnce();
}

await scheduler.wait(50);                     // 等价于 sleep(50)
await scheduler.yield();                      // 让出一次，给事件循环喘口气
```

`scheduler.yield()` 是"半 CPU 密集"循环的救命工具：长循环里每处理 1000 条 yield 一次，
进程就还能响应信号和健康检查。

---

## 10. 异步迭代器与流

### `async function*`

异步生成器 = **惰性的异步序列**，是"游标分页 API"和"流式 LLM 输出"的统一抽象：

```ts
interface Page<T> { items: T[]; nextCursor?: string }

async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.items) yield item;      // 一个个吐出去，不是整页
    if (page.nextCursor == null) return;
    cursor = page.nextCursor;
  }
}

for await (const issue of paginate(fetchIssuesPage)) {
  if (shouldStop) break;      // ✅ 惰性：break 之后的页永远不会被请求
}
```

调用方完全看不到分页逻辑。这就是练习 6.11；第 09 章消费 OpenAI 流式响应用**同一套语法**。

### Node Stream

```ts
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';

const stream = Readable.from(paginate(fetchIssuesPage));   // 任何异步可迭代对象 → 流

await pipeline(                     // ✅ promise 版 pipeline：自动传播错误、关闭资源
  createReadStream('big.log'), createGzip(), createWriteStream('big.log.gz'),
);                                  // ❌ 别手写 a.pipe(b).pipe(c)：中间出错会泄漏 fd

// 按行读大文件 / 读管道输入（日志处理、CLI 的标准写法）
const rl = createInterface({
  input: createReadStream('big.log', 'utf8'),   // 换成 process.stdin 就是读管道
  crlfDelay: Infinity,                          // 正确处理 \r\n
});
for await (const line of rl) {                  // ✅ 内存占用恒定，10GB 文件也不怕
  if (line.includes('ERROR')) count += 1;
}
```

**背压（backpressure）一句话**：`for await` 和 `pipeline` 会自动在下游处理不过来时暂停
上游读取；只有手写 `on('data')` 才需要自己管 `pause()` / `resume()` —— 所以别手写。

---

## 11. 真正的多线程：`worker_threads` 与 `child_process`

单线程扛不住时才动这两个。它们都是**重量级**手段，不是 goroutine 的替代品：
Go 里开 10 万个 goroutine 很正常，Node 里 worker 开到 CPU 核数就该到顶了。

| 场景 | 用什么 |
| --- | --- |
| CPU 密集**纯计算**：加密/哈希、压缩、解析 100MB JSON | `worker_threads` |
| 调**外部命令**：`git` / `ffmpeg` / `docker`（CLI 最常见） | `child_process.execFile` |

```ts
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// ① CPU 密集 → worker_threads：同进程、独立 V8 隔离区、消息传递（不共享内存）
const worker = new Worker(new URL('./heavy-worker.ts', import.meta.url));
worker.postMessage({ n: 42 });
worker.on('message', (r: number) => console.log(r));
await worker.terminate();

// ② 调外部命令 → execFile（promise 版）
const run = promisify(execFile);
const { stdout } = await run('git', ['rev-parse', 'HEAD']);  // ✅ 参数是数组，不走 shell
// ❌ 别用 exec()：它走 shell，有命令注入风险
```

> 主线程和 worker 之间的数据是**拷贝**的（结构化克隆），大对象拷贝本身就贵。
> 所以 worker 只适合"传一点参数、算很久、返回一点结果"。
> 没有"共享内存 + 锁"这套模型（`SharedArrayBuffer` 有，但你几乎不会需要）。

---

## 12. 实践：CLI / Agent 里的异步套路

一个真实的批量抓取任务，五件事一次配齐：并发限流 + 超时 + 重试 + 取消 + 优雅退出。

```ts
async function main(): Promise<void> {
  // ① 优雅退出：SIGINT / SIGTERM 转成 AbortSignal 往下传
  const controller = new AbortController();
  const shutdown = (): void => { console.error('\n收到中断信号，正在收尾...'); controller.abort(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // ② 兜底：未处理的 rejection 只记日志 + 设退出码
  process.on('unhandledRejection', (reason) => { console.error('[fatal]', reason); process.exitCode = 1; });

  // ③ 用户取消 + ④ 全局超时，合并成一个 signal
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);

  // ⑤ 并发限流 + 重试退避，用 ok/error 包装成"永不 reject"，允许部分失败
  const results = await mapConcurrent(urls, 5, (url) =>
    retry((attempt) => fetchText(url, { signal }), {
      retries: 3,
      baseDelayMs: 200,
      signal,
      shouldRetry: (e) => !(e instanceof Error && e.name === 'AbortError'),  // 取消不重试
    }).then(
      (value) => ({ url, ok: true as const, value }),
      (error: unknown) => ({ url, ok: false as const, error }),
    ),
  );

  const failed = results.filter((r) => !r.ok);
  console.error(`完成 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) process.exitCode = 1;   // ✅ 用 exitCode，让输出 flush 完再退
}

await main();     // ✅ 顶层 await（ESM）
```

上线前 checklist，每条都对应本章一个坑：

- [ ] 所有 Promise 都 `await` 或 `.catch()` 了？（lint: `no-floating-promises`）
- [ ] 没有 `forEach(async ...)`？
- [ ] 每个"可能等很久"的函数都接受 `signal?: AbortSignal`？
- [ ] 每个 `setTimeout` 都有 `clearTimeout` 或 `unref()`？
- [ ] 批量任务有并发上限？
- [ ] 有 `unhandledRejection` 和 `SIGINT` 处理？
- [ ] CPU 密集部分挪出主线程，或至少 `scheduler.yield()` 了？

---

## 本章练习

```bash
# 1. 打开 exercises/ch06-async.ts，把所有 TODO 填掉
# 2. 跑测试
pnpm test tests/ch06

# 3. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch06

# 4. 卡住了看 solutions/ch06-async.ts
```

练习覆盖：`sleep`、微任务/宏任务输出顺序、手写 `promisify`、`withTimeout`、
`Promise.allSettled` 汇总、`AbortSignal` 三步套路、指数退避重试（注入 `sleep`）、
并发上限 worker pool、串行队列消除交错、竞速并取消输家、异步生成器分页、`debounceAsync`。

> 12 题全部是**确定性测试**：延时都在 1~20ms，需要"时间"和"随机"的地方一律做成可注入
> 参数。这不只是为了做题方便 —— 生产环境的异步代码想被测试，就得这么设计。

---

**下一章** → [07 · 错误处理与数据校验：异常不在签名里](./07-errors-and-validation.md)
