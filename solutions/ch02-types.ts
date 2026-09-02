/**
 * 第 02 章参考答案 · 类型系统
 * 每题都附带「为什么这么写 / 常见错法」的说明，看的时候重点看注释。
 */

// ---------- 2.1 ----------
export interface HasSize {
  readonly size: number;
}

export function sumSizes(items: readonly HasSize[]): number {
  let total = 0;
  for (const item of items) {
    // 类型标注只在编译期存在，运行时的 size 可能是 NaN / Infinity（来自 JSON）。
    // 常见错法：直接 items.reduce((a, b) => a + b.size, 0)，一个 NaN 就把整个结果污染成 NaN。
    if (Number.isFinite(item.size)) total += item.size;
  }
  return total;
}

// ---------- 2.2 ----------
export function isStringArray(value: unknown): value is string[] {
  // 三步：先确认是数组（typeof [] === 'object'，只能用 Array.isArray），
  // 再逐项确认元素类型。空数组 every 返回 true，正好符合"空数组算合法"。
  // 常见错法：写 `typeof value === 'object' && 'length' in value`，
  // 会把 { 0: 'a', length: 1 } 这种类数组对象也放进来。
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// ---------- 2.3 ----------
export function parsePort(value: unknown): number | null {
  let n: number;

  // 从 unknown 出发，用 typeof 收窄。只有 number / string 两条路能往下走，
  // 其余（boolean / null / 数组 / 对象）在这里就被挡住了。
  // 常见错法：一上手写 Number(value) —— Number(true)===1、Number(null)===0、
  // Number('')===0、Number(['80'])===80，四个坑一次踩全。
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    // 先用正则把形状卡死，再转数字（同第 01 章的严格解析套路）
    if (!/^\d+$/.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }

  if (!Number.isInteger(n)) return null;
  return n >= 1 && n <= 65_535 ? n : null;
}

// ---------- 2.4 ----------
export type Brand<T, B extends string> = T & { readonly __brand: B };
export type UserId = Brand<string, 'UserId'>;

export function toUserId(raw: string): UserId | null {
  // 整串匹配（^...$），所以 ' u_a1b2 ' 这种带空白的不会通过。
  if (!/^u_[a-z0-9]{4,}$/.test(raw)) return null;
  // 全项目**唯一**允许 `as UserId` 的地方：校验刚刚通过，断言是安全的。
  // 注意 as 没有任何运行时行为，返回的就是原来那个 string。
  return raw as UserId;
}

export function joinUserIds(ids: readonly UserId[]): string {
  // 运行时就是普通 string 数组，join 直接能用；
  // 但类型上挡住了 `joinUserIds(['随便一个字符串'])` 这种调用。
  return ids.join(',');
}

// ---------- 2.5 ----------
export type Expr =
  | { readonly kind: 'lit'; readonly value: number }
  | { readonly kind: 'neg'; readonly operand: Expr }
  | { readonly kind: 'add'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'mul'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'div'; readonly left: Expr; readonly right: Expr };

export function assertNever(value: never): never {
  // 参数写 never 是关键：调用处如果还有没处理的分支，传进来的值就不是 never，编译报错。
  // 运行时把脏数据打出来 —— 类型系统保证不了外部数据，真跑到这里说明数据有问题。
  throw new Error(`unexpected variant: ${JSON.stringify(value)}`);
}

export function evalExpr(expr: Expr): number {
  switch (expr.kind) {
    // switch 一旦以可辨识字段（这里是 kind）为条件，每个 case 里 expr 就被收窄成
    // 对应的那一个成员，所以 expr.value / expr.left 能直接访问，不需要任何强转。
    case 'lit':
      return expr.value;
    case 'neg':
      return -evalExpr(expr.operand);
    case 'add':
      return evalExpr(expr.left) + evalExpr(expr.right);
    case 'mul':
      return evalExpr(expr.left) * evalExpr(expr.right);
    case 'div': {
      const right = evalExpr(expr.right);
      // JS 里 1/0 是 Infinity、0/0 是 NaN，都不抛异常，必须自己拦（第 01 章坑 3）。
      if (right === 0) throw new Error('division by zero');
      return evalExpr(expr.left) / right;
    }
    default:
      // 走到这里 expr 的类型已经是 never。以后给 Expr 加一个 'mod' 成员，
      // 这一行会立刻编译报错，提醒你回来补分支 —— 这是 Java enum switch 做不到的。
      return assertNever(expr);
  }
}

// ---------- 2.6 ----------
export type TaskState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly startedAt: number }
  | { readonly kind: 'done'; readonly durationMs: number }
  | { readonly kind: 'failed'; readonly reason: string };

export type TaskEvent =
  | { readonly kind: 'start'; readonly at: number }
  | { readonly kind: 'finish'; readonly at: number }
  | { readonly kind: 'fail'; readonly reason: string }
  | { readonly kind: 'reset' };

export function nextState(state: TaskState, event: TaskEvent): TaskState {
  // reset 与当前状态无关，先处理掉，剩下的分支就干净了。
  if (event.kind === 'reset') return { kind: 'idle' };

  switch (event.kind) {
    case 'start':
      // 注意这里两层收窄：event 收窄成 start（有 at），state 收窄成 idle。
      return state.kind === 'idle' ? { kind: 'running', startedAt: event.at } : state;
    case 'finish':
      // 只有 running 才带 startedAt —— 联合类型让"字段随状态存在"这件事被编译器强制。
      // 常见错法：写一个大 class（status + startedAt? + durationMs? + reason?），
      // 然后到处 `!` 断言非空。
      return state.kind === 'running'
        ? { kind: 'done', durationMs: event.at - state.startedAt }
        : state;
    case 'fail':
      return state.kind === 'running' ? { kind: 'failed', reason: event.reason } : state;
    default:
      return assertNever(event);
  }
}

// ---------- 2.7 ----------
export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  // 返回 Result<T, never>：never 是"不可能有值"，所以它能被塞进任何 E 的位置，
  // 于是 ok(1) 可以直接赋给 Result<number, string>，不用写第二个类型参数。
  return { kind: 'ok', value };
}

export function err<E>(error: E): Result<never, E> {
  return { kind: 'err', error };
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  // 必须按 kind 判断。常见错法：`return result.value || fallback`
  // —— 一是 err 分支上没有 value（编译就过不了），二是 ok(0)/ok('') 会被 fallback 吃掉。
  return result.kind === 'ok' ? result.value : fallback;
}

// ---------- 2.8 ----------
export function mapResult<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.kind === 'err') return result; // err 分支原样透传，fn 一次都不调用
  return { kind: 'ok', value: fn(result.value) };
}

export function andThen<T, E, U, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  // 返回类型 Result<U, E | F>：把两段的错误类型**合并成联合类型**，
  // 这样调用方 switch 时能同时看到两种错误 —— Java 里得靠共同父类或包装异常。
  if (result.kind === 'err') return result;
  return fn(result.value);
}

// ---------- 2.9 ----------
export function groupBy<T, K extends string>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Record<K, T[]> {
  // 内部先用宽松的 Record<string, T[]>（因为运行时 key 是逐个冒出来的），
  // 最后再断言成 Record<K, T[]> 给调用方。这是 as 的一个合理用途。
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyOf(item);
    // ??= 一步搞定"没有就建桶"。因为开了 noUncheckedIndexedAccess，
    // out[key] 的类型是 T[] | undefined，编译器会强迫你处理这种情况。
    (out[key] ??= []).push(item);
  }
  return out as Record<K, T[]>;
}

// ---------- 2.10 ----------
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    // Object.hasOwn 只看自有属性，不看原型链（比 `key in obj` 安全）。
    // 常见错法：无条件 out[key] = obj[key]，会给"根本不存在的可选属性"
    // 造出一个 value 为 undefined 的键，之后 JSON.stringify / Object.keys 行为就不对了。
    if (Object.hasOwn(obj, key)) out[key] = obj[key];
  }
  return out;
}

// ---------- 2.11 ----------
export interface CommandSpec {
  readonly summary: string;
  readonly args: readonly string[];
  readonly aliases?: readonly string[];
}

export const COMMANDS = {
  init: { summary: '生成默认配置文件', args: [] },
  run: { summary: '执行一个任务', args: ['task'], aliases: ['r'] },
  copy: { summary: '复制文件', args: ['src', 'dest'], aliases: ['cp'] },
} as const satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(input: string): input is CommandName {
  // Object.hasOwn 而不是 `input in COMMANDS`：后者会命中原型链，
  // isCommandName('toString') 会错判成 true。
  return Object.hasOwn(COMMANDS, input);
}

// ---------- 2.12 ----------
export type CliError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unknown-command'; readonly input: string }
  | {
      readonly kind: 'missing-args';
      readonly command: CommandName;
      readonly expected: number;
      readonly got: number;
    };

/** 把"正式名或别名"解析成正式名。非导出的内部辅助函数。 */
function resolveCommandName(input: string): CommandName | null {
  if (isCommandName(input)) return input;
  // Object.entries 的键类型是 string，这里断言回精确的字面量类型。
  for (const [name, spec] of Object.entries(COMMANDS) as Array<[CommandName, CommandSpec]>) {
    if (spec.aliases?.includes(input) === true) return name;
  }
  return null;
}

export function runCommandLine(argv: readonly string[]): Result<string, CliError> {
  const [head, ...rest] = argv;
  // noUncheckedIndexedAccess 下，解构出来的 head 类型是 string | undefined，
  // 编译器逼着你先处理"空数组"这条路。
  if (head === undefined) return err<CliError>({ kind: 'empty' });

  const name = resolveCommandName(head);
  if (name === null) return err<CliError>({ kind: 'unknown-command', input: head });

  const spec: CommandSpec = COMMANDS[name];
  if (rest.length < spec.args.length) {
    return err<CliError>({
      kind: 'missing-args',
      command: name,
      expected: spec.args.length,
      got: rest.length,
    });
  }

  // err<CliError>(...) 显式写类型参数：否则 TS 会把 { kind: 'empty' } 的 kind
  // 推断成 string（字面量被放宽），结果对不上 CliError。
  const parts = spec.args.map((argName, i) => `${argName}=${rest[i] ?? ''}`);
  return ok(`${name}(${parts.join(', ')})`);
}

export function formatCliError(error: CliError): string {
  switch (error.kind) {
    case 'empty':
      return `缺少命令，可用命令: ${Object.keys(COMMANDS).join(', ')}`;
    case 'unknown-command':
      return `未知命令: ${error.input}`;
    case 'missing-args':
      return `${error.command} 需要 ${error.expected} 个参数，实际收到 ${error.got} 个`;
    default:
      // 同 2.5：给 CliError 加成员而忘记这里，编译期就会失败。
      return assertNever(error);
  }
}

/* ==================================================================== *
 * 与 exercises 文件同一份编译期断言：用来保证参考答案的**类型**也没写歪。
 * ==================================================================== */

type Expect<T extends true> = T;
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type _BrandIsString = Expect<Equals<UserId extends string ? true : false, true>>;
type _StringIsNotUserId = Expect<Equals<string extends UserId ? true : false, false>>;
type _CommandNameIsLiteralUnion = Expect<Equals<CommandName, 'init' | 'run' | 'copy'>>;

type _Sample = { a: number; b: string; c?: boolean };
type _PickedShape = Expect<Equals<ReturnType<typeof pick<_Sample, 'a'>>, Pick<_Sample, 'a'>>>;
type _PickedIsNotWhole = Expect<
  Equals<ReturnType<typeof pick<_Sample, 'a'>> extends _Sample ? true : false, false>
>;

type _AndThenError = Expect<
  Equals<ReturnType<typeof andThen<number, 'e1', string, 'e2'>>, Result<string, 'e1' | 'e2'>>
>;

type _ExprKinds = Expect<Equals<Expr['kind'], 'lit' | 'neg' | 'add' | 'mul' | 'div'>>;
