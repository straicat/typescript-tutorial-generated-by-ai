/**
 * 第 04 章练习 · 函数与面向对象
 * =====================================================================
 * 对应文档：docs/04-functions-and-oop.md
 *
 * 玩法：
 *   1. 把每个函数/方法里的 TODO 换成你的实现（**不要修改签名和导出名**）
 *   2. 跑 `pnpm test tests/ch04`  或者 `pnpm vitest tests/ch04`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch04-functions-oop.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 * =====================================================================
 */

/**
 * 练习 4.1 ⭐ —— compose：函数组合（从右往左）
 *
 * 返回一个新函数，先跑 f 再把结果喂给 g。注意泛型参数的串联：A -> B -> C。
 * 这是 Java 里 `f.andThen(g)` / `g.compose(f)` 的等价物，但不需要函数式接口。
 *
 * const shout = compose((s: string) => s + '!', (n: number) => String(n));
 * shout(41)  === '41!'
 */
export function compose<A, B, C>(g: (b: B) => C, f: (a: A) => B): (a: A) => C {
  throw new Error('TODO 4.1: 实现 compose');
}

/**
 * 练习 4.2 ⭐⭐ —— pipeAll：变长管道（从左往右）
 *
 * 把任意多个「同类型进出」的函数串成一条流水线，从左往右依次执行。
 * 特殊要求：一个函数都不传时，返回的函数必须是恒等函数（原样返回入参）。
 * 提示：一行 reduce 就够了，不要写 for 循环拼字符串那种笨办法。
 *
 * const slugify = pipeAll<string>((s) => s.trim(), (s) => s.toLowerCase());
 * slugify('  Hi ')       === 'hi'
 * pipeAll<number>()(7)   === 7
 * pipeAll<number>((n) => n + 1, (n) => n * 2)(3) === 8   // 先加后乘：(3+1)*2
 */
export function pipeAll<T>(...steps: ReadonlyArray<(value: T) => T>): (value: T) => T {
  throw new Error('TODO 4.2: 实现 pipeAll');
}

/**
 * 练习 4.3 ⭐⭐ —— curry3：三参函数柯里化
 *
 * 把 (a, b, c) => R 变成 a => b => c => R。
 * 每一层都要能被单独保存下来复用（也就是偏应用 partial application）。
 *
 * const add = (a: number, b: number, c: number) => a + b + c;
 * const c = curry3(add);
 * c(1)(2)(3)      === 6
 * const add1 = c(1);
 * add1(2)(3)      === 6
 * add1(10)(100)   === 111    // add1 可以复用，互不影响
 */
export function curry3<A, B, C, R>(
  fn: (a: A, b: B, c: C) => R,
): (a: A) => (b: B) => (c: C) => R {
  throw new Error('TODO 4.3: 实现 curry3');
}

/**
 * 练习 4.4 ⭐⭐ —— once：只执行一次（闭包做私有状态）
 *
 * 返回一个包装函数：无论调用多少次，原函数最多执行一次，
 * 后续调用直接返回第一次的结果（参数被忽略）。
 * 坑：原函数返回 undefined / 0 / null 时也算"已经执行过"，不能再执行第二次。
 *
 * let n = 0;
 * const init = once((label: string) => { n += 1; return `${label}#${n}`; });
 * init('a')   === 'a#1'
 * init('b')   === 'a#1'    // 没有再执行，参数 'b' 被忽略
 * n           === 1
 */
export function once<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  throw new Error('TODO 4.4: 实现 once');
}

/**
 * 练习 4.5 ⭐⭐ —— memoize：带闭包缓存的记忆化
 *
 * 缓存单参函数的结果。缓存键由 keyOf 生成，默认用 String(arg)。
 * 要求：
 *   - 同一个键只调用底层函数一次
 *   - 缓存值为 undefined / 0 / '' 时也必须命中缓存（提示：用 Map.has，别用 if (cache.get(k))）
 *   - 缓存必须藏在闭包里，外部拿不到
 *
 * let calls = 0;
 * const slow = memoize((n: number) => { calls += 1; return n * 2; });
 * slow(2)  === 4;  slow(2) === 4;  calls === 1
 *
 * const byId = memoize((u: { id: string }) => u.id.length, (u) => u.id);
 * byId({ id: 'ab' }) === 2   // 自定义键，避免 String(object) 变成 '[object Object]'
 */
export function memoize<A, R>(
  fn: (arg: A) => R,
  keyOf: (arg: A) => string = (value) => String(value),
): (arg: A) => R {
  throw new Error('TODO 4.5: 实现 memoize');
}

/**
 * 练习 4.6 ⭐⭐⭐ —— throttle：节流（注入时钟，不依赖真实计时器）
 *
 * 返回一个包装函数（前沿节流 / leading edge）：
 *   - 第一次调用：执行 fn，返回 true
 *   - 距离上次【实际执行】不足 intervalMs 的调用：不执行 fn，返回 false
 *   - 达到或超过 intervalMs：再次执行 fn，返回 true
 *   - "现在几点"必须通过 now() 获取，**不许用 Date.now()**（否则没法测）
 *
 * let t = 1000;
 * const hits: string[] = [];
 * const log = throttle((m: string) => hits.push(m), 100, () => t);
 * log('a')            === true    // hits: ['a']
 * log('b')            === false   // 被丢掉
 * t = 1099; log('c')  === false   // 差 99ms，还不够
 * t = 1100; log('d')  === true    // hits: ['a', 'd']
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
  now: () => number,
): (...args: Args) => boolean {
  throw new Error('TODO 4.6: 实现 throttle');
}

/**
 * 练习 4.7 ⭐⭐⭐ —— withRetry：装饰器式包装（TS 版的 @Retryable）
 *
 * 返回一个包装函数：调用 fn，失败（抛异常）就重试，最多尝试 maxAttempts 次。
 *   - 成功就立刻返回结果
 *   - 每次失败后调用 onRetry?.(attempt, error)，attempt 从 1 开始计数
 *   - 全部失败后，把【最后一次】的异常原样抛出（不要包一层新 Error）
 *   - maxAttempts < 1 时：**创建包装函数时就立刻**抛 RangeError（不是等到调用时）
 *
 * let n = 0;
 * const flaky = withRetry(() => { n += 1; if (n < 3) throw new Error(`fail${n}`); return 'ok'; }, 3);
 * flaky()  === 'ok'   // n === 3
 */
export function withRetry<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  maxAttempts: number,
  onRetry?: (attempt: number, error: unknown) => void,
): (...args: Args) => R {
  throw new Error('TODO 4.7: 实现 withRetry');
}

/**
 * 练习 4.8 ⭐⭐⭐ —— 修复 this 丢失
 *
 * Greeter 的 greet 必须满足：**被解构出来单独调用、或者直接当回调传给 map 时也不能丢 this**。
 * greetAll 必须写成 `names.map(this.greet)` 这种「方法引用」的形式（不许写 `(n) => this.greet(n)`），
 * 用它来证明你真的修好了 this。
 *
 * const g = new Greeter('Hi');
 * g.greet('Bob')                    === 'Hi, Bob!'
 * const { greet } = g; greet('Ann') === 'Hi, Ann!'     // 😱 普通方法在这里会炸
 * g.greetAll(['a', 'b'])            -> ['Hi, a!', 'Hi, b!']
 *
 * 提示：文档 §3 给了三种修法，这里只有一种能同时满足上面两条。
 */
export class Greeter {
  constructor(private readonly prefix: string) {}

  greet(name: string): string {
    throw new Error('TODO 4.8: 让 greet 在被解构 / 当回调传递时也能工作');
  }

  greetAll(names: readonly string[]): string[] {
    throw new Error('TODO 4.8: 用 names.map(this.greet) 实现 greetAll');
  }
}

/**
 * 练习 4.9 ⭐⭐ —— 用 #private 实现真封装的定容栈
 *
 * 要求：
 *   - 容量和内部数组都用 `#` 私有字段（**不是** TS 的 private），
 *     使得 Object.keys(stack) 是 []、JSON.stringify(stack) 是 '{}'
 *   - constructor(capacity)：capacity 不是正整数时抛 RangeError
 *   - push：满了抛 RangeError；pop / peek：空栈返回 undefined
 *   - toArray()：返回【栈底到栈顶】顺序的**拷贝**，改它不影响栈内部
 *   - capacity / size 用 getter 暴露（只读）
 *
 * const s = new BoundedStack<number>(2);
 * s.push(1); s.push(2);
 * s.size            === 2
 * s.peek()          === 2
 * s.toArray()       -> [1, 2]
 * s.push(3)         throws RangeError
 * s.pop()           === 2
 * Object.keys(s)    -> []            // 真私有的证据
 * new BoundedStack(0)  throws RangeError
 */
export class BoundedStack<T> {
  #items: T[] = [];
  #capacity = 0;

  constructor(capacity: number) {
    throw new Error('TODO 4.9: 校验 capacity 并保存到 #capacity');
  }

  get capacity(): number {
    throw new Error('TODO 4.9: 实现 capacity getter');
  }

  get size(): number {
    throw new Error('TODO 4.9: 实现 size getter');
  }

  push(item: T): void {
    throw new Error('TODO 4.9: 实现 push（满了抛 RangeError）');
  }

  pop(): T | undefined {
    throw new Error('TODO 4.9: 实现 pop');
  }

  peek(): T | undefined {
    throw new Error('TODO 4.9: 实现 peek');
  }

  toArray(): T[] {
    throw new Error('TODO 4.9: 实现 toArray（返回拷贝）');
  }
}

/**
 * 练习 4.10 ⭐⭐ —— 抽象类 + 模板方法 + 两个子类
 *
 * ReportFormatter.render 是【模板方法】，逻辑对所有子类一致：
 *   - rows 为空          -> `${id}: (empty)`
 *   - 否则               -> `${id}:` + 换行 + 每行 formatRow 的结果，用 '\n' 连接
 * 子类只实现 formatRow（protected，外部调不到）：
 *   - CsvFormatter       -> `name,count`
 *   - JsonLinesFormatter -> JSON.stringify({ name, count })，即 {"name":"a","count":1}
 *
 * new CsvFormatter().render([{ name: 'a', count: 1 }, { name: 'b', count: 2 }])
 *   === 'csv:\na,1\nb,2'
 * new JsonLinesFormatter().render([{ name: 'a', count: 1 }])
 *   === 'json:\n{"name":"a","count":1}'
 * new CsvFormatter().render([]) === 'csv: (empty)'
 */
export interface ReportRow {
  readonly name: string;
  readonly count: number;
}

export abstract class ReportFormatter {
  abstract readonly id: string;

  /** 子类必须实现；protected 表示只有类体系内部能调 */
  protected abstract formatRow(row: ReportRow): string;

  render(rows: readonly ReportRow[]): string {
    throw new Error('TODO 4.10: 实现模板方法 render');
  }
}

export class CsvFormatter extends ReportFormatter {
  override readonly id = 'csv';

  protected override formatRow(row: ReportRow): string {
    throw new Error('TODO 4.10: 实现 CsvFormatter.formatRow');
  }
}

export class JsonLinesFormatter extends ReportFormatter {
  override readonly id = 'json';

  protected override formatRow(row: ReportRow): string {
    throw new Error('TODO 4.10: 实现 JsonLinesFormatter.formatRow');
  }
}

/**
 * 练习 4.11 ⭐⭐⭐ —— Error 子类 + instanceof 分派
 *
 * AppError 已经写好（照着它的写法做）。你要做两件事：
 *
 * (a) 实现 NotFoundError extends AppError：
 *       message === `${resource} not found: ${id}`
 *       code    === 'NOT_FOUND'
 *       name    === 'NotFoundError'
 *       并保留 resource / id 两个只读属性
 *
 * (b) 实现 describeError(err: unknown): string，按下面的优先级分派：
 *       NotFoundError -> `404 ${resource}#${id}`
 *       AppError      -> `app[${code}] ${message}`
 *       Error         -> `error ${message}`
 *       其它任何值     -> `unknown ${String(err)}`
 *     ⚠️ 坑：instanceof 判断必须【子类在前、父类在后】，顺序写反了 404 永远进不去。
 *     ⚠️ 坑：catch 到的东西不一定是 Error，字符串/undefined 都可能，最后一条必须兜住。
 *
 * describeError(new NotFoundError('user', '7'))  === '404 user#7'
 * describeError(new AppError('boom', 'E_IO'))    === 'app[E_IO] boom'
 * describeError(new TypeError('bad'))            === 'error bad'
 * describeError('oops')                          === 'unknown oops'
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    // ⚠️ 必须手动设置 name，否则日志/堆栈里显示的是 'Error'
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(
    readonly resource: string,
    readonly id: string,
  ) {
    // TODO 4.11(a): 用正确的 message / code 调用 super，并设置 this.name
    super('', '');
    throw new Error('TODO 4.11(a): 实现 NotFoundError');
  }
}

export function describeError(err: unknown): string {
  throw new Error('TODO 4.11(b): 实现 describeError');
}

/**
 * 练习 4.12 ⭐⭐⭐ —— 综合：参数属性 + 依赖注入 + 重载签名
 *
 * 用【参数属性简写】写一个内存 Repository，同时 implements 两个接口
 * （TS 里 extends 只能一个，implements 可以多个）。
 * 时间从注入的 now() 拿 —— 这就是"不需要框架的依赖注入"。
 *
 * 要求：
 *   - constructor(now: () => number, maxUsers = 100)：两个参数都用参数属性写成 private readonly
 *   - add(id, name)：返回 { id, name, createdAt: now() }；
 *       id 重复      -> throw new Error(`duplicate id: ${id}`)
 *       超过 maxUsers -> throw new RangeError('repository is full')
 *   - count()：当前用户数
 *   - find 有两个【重载签名】（一个实现）：
 *       find(id: string)              -> User | undefined
 *       find(ids: readonly string[])  -> User[]（跳过不存在的 id，保持传入顺序）
 *
 * const repo = new InMemoryUserRepository(() => 1000);
 * repo.add('u1', 'ann').createdAt  === 1000
 * repo.find('u1')?.name            === 'ann'
 * repo.find('nope')                === undefined
 * repo.find(['u1', 'nope'])        -> [{ id: 'u1', name: 'ann', createdAt: 1000 }]
 * repo.count()                     === 1
 */
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

  constructor(
    private readonly now: () => number,
    private readonly maxUsers: number = 100,
  ) {}

  add(id: string, name: string): User {
    throw new Error('TODO 4.12: 实现 add');
  }

  count(): number {
    throw new Error('TODO 4.12: 实现 count');
  }

  find(id: string): User | undefined;
  find(ids: readonly string[]): User[];
  find(arg: string | readonly string[]): User | User[] | undefined {
    throw new Error('TODO 4.12: 实现 find（一个实现服务两个重载签名）');
  }
}
