/**
 * 第 02 章练习 · 类型系统
 * =====================================================================
 * 对应文档：docs/02-type-system.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch02`  或者 `pnpm vitest tests/ch02`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch02-types.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 本章有一部分知识点是**纯类型**的（运行时看不见）。这种题的验收分两层：
 *   - 运行时行为 → tests/ch02-types.test.ts 里的 expect
 *   - 类型是否精确 → 本文件底部的 `Expect<...>` 编译期断言，靠 `pnpm typecheck` 保证
 * =====================================================================
 */

/* ------------------------------------------------------------------ *
 * 练习 2.1 ⭐ —— 结构化类型（鸭子类型）
 * ------------------------------------------------------------------ */

/**
 * 注意这个 interface 后面**没有任何 implements**：
 * 任何"形状上"有 `size: number` 的对象都能传进 sumSizes，
 * 这就是 TS 的结构化类型（structural typing）。
 */
export interface HasSize {
  readonly size: number;
}

/**
 * 练习 2.1 ⭐ —— 累加 size
 *
 * 把所有元素的 size 加起来。但要小心：类型标注只在编译期有效，
 * 运行时数据（来自 JSON / 外部 API）可能塞进 NaN / Infinity。
 * 所以**只累加 Number.isFinite(size) 为 true 的项**，其余跳过。
 *
 * sumSizes([{ size: 1 }, { size: 2 }])            === 3
 * sumSizes([{ size: 1 }, { size: NaN }])          === 1
 * sumSizes([])                                    === 0
 *
 * const file = { size: 3, name: 'a.txt' };
 * sumSizes([file])                                === 3   // 多余属性也能传（结构化类型）
 * // 但直接写 sumSizes([{ size: 3, name: 'a.txt' }]) 会编译报错：
 * // 对象字面量会触发多余属性检查（excess property check），细节见文档 §2
 */
export function sumSizes(items: readonly HasSize[]): number {
    let res = 0;
    for (const item of items) {
        if (Number.isFinite(item.size)) {
            res += item.size;
        }
    }
    return res;
}

/* ------------------------------------------------------------------ *
 * 练习 2.2 ⭐⭐ —— 自定义类型守卫 `x is T`
 * ------------------------------------------------------------------ */

/**
 * 练习 2.2 ⭐⭐ —— 判断"是不是字符串数组"
 *
 * 返回类型写成 `value is string[]`（类型谓词 type predicate），
 * 这样调用方 if 之后就能直接把 value 当 string[] 用 —— Java 的 instanceof
 * 只能判断 class，泛型擦除后判断不了 `List<String>`，TS 靠这个守卫来补。
 *
 * ⚠️ 类型谓词是**你对编译器的承诺**，写错了编译器不会拦你，所以要真的逐项检查。
 *
 * isStringArray(['a', 'b'])  === true
 * isStringArray([])          === true    // 空数组算合法
 * isStringArray(['a', 1])    === false
 * isStringArray('abc')       === false   // 字符串不是字符串数组
 * isStringArray(null)        === false
 * isStringArray({ 0: 'a', length: 1 }) === false   // 类数组对象也不算
 */
export function isStringArray(value: unknown): value is string[] {
    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item !== 'string') {
                return false;
            }
        }
        return true;
    }
    return false;
}

/* ------------------------------------------------------------------ *
 * 练习 2.3 ⭐⭐ —— unknown 输入的安全解析
 * ------------------------------------------------------------------ */

/**
 * 练习 2.3 ⭐⭐ —— 从 unknown 里解析端口号
 *
 * 入口参数故意写成 `unknown`（而不是 `any`）：外部数据必须先落到 unknown，
 * 逐步收窄后才能使用。
 *
 * 合法端口 = 1..65535 的整数。number 和 string 两种输入都要接受，
 * 其它一切（boolean / null / undefined / 数组 / 对象 / 小数 / 越界）返回 null。
 *
 * parsePort(8080)      === 8080
 * parsePort('8080')    === 8080
 * parsePort(' 80 ')    === 80      // 允许首尾空白
 * parsePort(0)         === null    // 越界
 * parsePort(65536)     === null
 * parsePort(3.5)       === null
 * parsePort('80abc')   === null
 * parsePort('')        === null    // 😱 Number('') === 0，别掉进去
 * parsePort(true)      === null    // 😱 Number(true) === 1，别掉进去
 * parsePort(null)      === null    // 😱 Number(null) === 0
 * parsePort(['80'])    === null    // 😱 Number(['80']) === 80
 */
export function parsePort(value: unknown): number | null {
    if (typeof value === 'number') {
        if (Number.isFinite(value) && value >= 1 && value <= 65535 && value % 1 === 0) {
            return value;
        }
    } else if (typeof value === 'string') {
        if (/^\s*\d+\s*$/.test(value)) {
            let val: number = Number(value);
            if (val >= 1 && val <= 65535) {
                return val;
            }
        }
    }
    return null;
}

/* ------------------------------------------------------------------ *
 * 练习 2.4 ⭐⭐ —— branded type（模拟名义类型）
 * ------------------------------------------------------------------ */

/** 通用打标工具类型：`__brand` 只存在于类型层面，运行时不存在这个属性。 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** 运行时就是一个 string，但类型上和普通 string **不能互相赋值**。 */
export type UserId = Brand<string, 'UserId'>;

/**
 * 练习 2.4 ⭐⭐ —— 唯一的 UserId 入口
 *
 * 合法 UserId 的格式：`u_` 开头 + 至少 4 位小写字母或数字，整串匹配。
 * 合法则返回该字符串（类型是 UserId），否则返回 null。
 * 这叫 smart constructor：**全项目只有这里能造出 UserId**，
 * 别处想拿 string 当 UserId 用会被编译器拦下来。
 *
 * toUserId('u_a1b2')   === 'u_a1b2'
 * toUserId('u_abc')    === null      // 不足 4 位
 * toUserId('U_ABCD')   === null      // 大写不行
 * toUserId('a1b2')     === null      // 缺前缀
 * toUserId(' u_a1b2 ') === null      // 不做 trim，整串必须匹配
 */
export function toUserId(raw: string): UserId | null {
    if (/^u_[0-9a-z]{4,}$/.test(raw)) {
        return raw as UserId;
    }
    return null;
}

/**
 * 练习 2.4b ⭐ —— 只接受 UserId 的下游函数
 *
 * 用 ',' 连接。注意签名只收 `readonly UserId[]`，
 * 传 `string[]` 进来必须编译报错（这正是 branded type 的价值）。
 *
 * joinUserIds([])                   === ''
 * joinUserIds([id1, id2])           === 'u_a1b2,u_c3d4'
 */
export function joinUserIds(ids: readonly UserId[]): string {
    const arr: string[] = [];
    ids.forEach(id => arr.push(id));
    return arr.join(',');
}

/* ------------------------------------------------------------------ *
 * 练习 2.5 ⭐⭐⭐ —— 可辨识联合 + 穷尽性检查
 * ------------------------------------------------------------------ */

/**
 * 一个极简表达式树。在 Java 里这是 sealed interface + 5 个 record + visitor，
 * 在 Go 里是 interface{} + type switch；TS 里就是一个联合类型，
 * 靠公共字面量字段 `kind` 辨识（discriminated union）。
 */
export type Expr =
  | { readonly kind: 'lit'; readonly value: number }
  | { readonly kind: 'neg'; readonly operand: Expr }
  | { readonly kind: 'add'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'mul'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'div'; readonly left: Expr; readonly right: Expr };

/**
 * 练习 2.5a ⭐ —— assertNever
 *
 * 参数类型是 `never`：只有当调用处的值已经被收窄成 never（= 所有分支都处理完了）
 * 才能编译通过。哪天给 Expr 加了新的 kind 而忘了处理，**编译直接报错**
 * （Java 的 switch on enum 漏分支通常只是警告）。
 *
 * 运行时行为：抛出 Error，message 必须包含传入值的 JSON 形式，方便排查脏数据。
 *
 * assertNever({ kind: 'mod' } as never)  // throws Error，message 含 '{"kind":"mod"}'
 */
export function assertNever(value: never): never {
    throw new Error(`${JSON.stringify(value)}`);
}

/**
 * 练习 2.5b ⭐⭐⭐ —— 表达式求值器
 *
 * 用 switch (expr.kind) 递归求值，default 分支调用 assertNever(expr)。
 * 除法要特殊处理：除数为 0 时抛 `new Error('division by zero')`
 * （别返回 Infinity —— 见第 01 章）。
 *
 * evalExpr({ kind: 'lit', value: 42 })                                     === 42
 * evalExpr({ kind: 'neg', operand: { kind: 'lit', value: 3 } })            === -3
 * evalExpr({ kind: 'add', left: lit(1), right: lit(2) })                   === 3
 * evalExpr({ kind: 'div', left: lit(1), right: lit(0) })                   // throws
 */
export function evalExpr(expr: Expr): number {
    switch (expr.kind) {
        case 'lit': return expr.value;
        case 'neg': return -evalExpr(expr.operand);
        case 'add': return evalExpr(expr.left) + evalExpr(expr.right);
        case 'mul': return evalExpr(expr.left) * evalExpr(expr.right);
        case 'div':
            const right = evalExpr(expr.right);
            if (right === 0) throw new Error('division by zero');
            return evalExpr(expr.left) / right;
        default: return assertNever(expr);
    }
}

/* ------------------------------------------------------------------ *
 * 练习 2.6 ⭐⭐ —— 状态机（可辨识联合的典型用法）
 * ------------------------------------------------------------------ */

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

/**
 * 练习 2.6 ⭐⭐ —— 状态迁移
 *
 * 注意每个状态**携带的数据不同**（idle 没有字段，running 才有 startedAt），
 * 这是联合类型比"一个大 class + 一堆可空字段"强的地方。
 *
 * 规则（只有这几条合法，其余组合原样返回旧 state，不抛异常）：
 *   idle    + start  -> { kind: 'running', startedAt: at }
 *   running + finish -> { kind: 'done',   durationMs: at - startedAt }
 *   running + fail   -> { kind: 'failed', reason }
 *   任意状态 + reset  -> { kind: 'idle' }
 *
 * nextState({ kind: 'idle' }, { kind: 'start', at: 100 })
 *   -> { kind: 'running', startedAt: 100 }
 * nextState({ kind: 'running', startedAt: 100 }, { kind: 'finish', at: 350 })
 *   -> { kind: 'done', durationMs: 250 }
 * nextState({ kind: 'idle' }, { kind: 'finish', at: 1 })
 *   -> { kind: 'idle' }              // 非法迁移，原样返回
 */
export function nextState(state: TaskState, event: TaskEvent): TaskState {
    if (event.kind === 'reset') return { kind: 'idle' };
    switch (state.kind) {
        case 'idle':
            if (event.kind === 'start') return { kind: 'running', startedAt: event.at };
            return state;
        case 'running':
            if (event.kind === 'finish') return { kind: 'done', durationMs: event.at - state.startedAt };
            else if (event.kind === 'fail') return { kind: 'failed', reason: event.reason };
    }
    return state;
}

/* ------------------------------------------------------------------ *
 * 练习 2.7 / 2.8 ⭐⭐ —— Result<T, E>：用类型代替异常
 * ------------------------------------------------------------------ */

/**
 * TS 的异常不在函数签名里（没有 checked exception），
 * 所以"可预期的失败"惯用法是把它编码进返回类型。
 */
export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E };

/**
 * 练习 2.7a ⭐ —— 构造 ok
 *
 * 返回类型是 `Result<T, never>`：never 是所有类型的子类型，
 * 所以 `ok(1)` 能直接赋给 `Result<number, string>`。
 *
 * ok(1)  -> { kind: 'ok', value: 1 }
 */
export function ok<T>(value: T): Result<T, never> {
    return { kind: 'ok', value: value };
}

/**
 * 练习 2.7b ⭐ —— 构造 err
 *
 * err('boom') -> { kind: 'err', error: 'boom' }
 */
export function err<E>(error: E): Result<never, E> {
    return { kind: 'err', error: error };
}

/**
 * 练习 2.7c ⭐⭐ —— unwrapOr
 *
 * ok 就取 value，err 就取 fallback。
 * ⚠️ 坑：ok(0) / ok('') / ok(false) 也必须原样返回，不能被 fallback 吃掉
 * （所以不能写 `r.value || fallback`）。
 *
 * unwrapOr(ok(5), 9)        === 5
 * unwrapOr(ok(0), 9)        === 0
 * unwrapOr(err('x'), 9)     === 9
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
    if (result.kind === 'ok') return result.value;
    return fallback;
}

/**
 * 练习 2.8a ⭐⭐ —— mapResult
 *
 * 只在 ok 时变换 value，err 原样透传（error 类型不变）。
 *
 * mapResult(ok(2), (n) => n * 3)          -> { kind: 'ok', value: 6 }
 * mapResult(ok(2), String)                -> { kind: 'ok', value: '2' }
 * mapResult(err('bad'), (n: number) => n) -> { kind: 'err', error: 'bad' }
 *   ↑ err 分支里 fn 一次都不能被调用
 */
export function mapResult<T, E, U>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    if (result.kind === 'ok') return { kind: 'ok', value: fn(result.value) };
    return result;
}

/**
 * 练习 2.8b ⭐⭐⭐ —— andThen（flatMap）
 *
 * fn 自己也返回 Result，用来把多个可能失败的步骤串起来而**不嵌套**。
 * 注意错误类型合并成 `E | F`：这正是联合类型的日常用法。
 *
 * andThen(ok('8080'), (s) => { const p = parsePort(s); return p == null ? err('bad port') : ok(p); })
 *   -> { kind: 'ok', value: 8080 }
 * andThen(err('no input'), ...)     -> { kind: 'err', error: 'no input' }   // fn 不被调用
 */
export function andThen<T, E, U, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
    if (result.kind === 'ok') return fn(result.value);
    return result;
}

/* ------------------------------------------------------------------ *
 * 练习 2.9 ⭐⭐ —— 泛型 + keyof：groupBy
 * ------------------------------------------------------------------ */

/**
 * 练习 2.9 ⭐⭐ —— groupBy
 *
 * 按 keyOf 的返回值分组，**保持原数组顺序**。
 * 返回类型是 `Record<K, T[]>`。
 *
 * ⚠️ 这里有个必须知道的坑：`Record<K, T[]>` 在类型上宣称"每个 K 都有值"，
 * 但运行时只会存在真正出现过的 key。所以拿到结果后取某个分组，
 * 仍然要当成"可能 undefined"处理（本项目开了 noUncheckedIndexedAccess 会提醒你）。
 *
 * groupBy(['a', 'bb', 'c'], (s) => String(s.length))
 *   -> { '1': ['a', 'c'], '2': ['bb'] }
 * groupBy([], (s: string) => s)      -> {}
 */
export function groupBy<T, K extends string>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Record<K, T[]> {
    const res = {} as Record<K, T[]>;
    for (const item of items) {
        const key = keyOf(item);
        if (res[key] === undefined) {
            res[key] = [];
        }
        res[key].push(item);
    }
    return res;
}

/* ------------------------------------------------------------------ *
 * 练习 2.10 ⭐⭐ —— 泛型约束 + 工具类型：pick
 * ------------------------------------------------------------------ */

/**
 * 练习 2.10 ⭐⭐ —— pick
 *
 * 运行时行为：只复制**自有属性且实际存在**的 key（用 Object.hasOwn 判断），
 * 不存在的 key 不要在结果里造出一个 `undefined` 值的属性。
 * 类型行为：返回 `Pick<T, K>`，`K extends keyof T` 保证传错 key 编译期就报错。
 *
 * pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])   -> { a: 1, c: 3 }
 * pick({ a: 1, b: 2 }, [])                 -> {}
 * Object.keys(pick({ a: 1, b: undefined as number | undefined }, ['a', 'b'])) -> ['a', 'b']
 * // 但对于"属性根本不存在"的可选属性：
 * 'b' in pick({ a: 1 } as { a: number; b?: number }, ['a', 'b'])  === false
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
    const res = {} as Pick<T, K>;
    for (const key of keys) {
        if (Object.hasOwn(obj, key)) {
            res[key] = obj[key];
        }
    }
    return res;
}

/* ------------------------------------------------------------------ *
 * 练习 2.11 ⭐⭐ —— satisfies + keyof typeof
 * ------------------------------------------------------------------ */

export interface CommandSpec {
  readonly summary: string;
  /** 位置参数的名字，长度即"必需参数个数" */
  readonly args: readonly string[];
  readonly aliases?: readonly string[];
}

/**
 * `as const satisfies Record<string, CommandSpec>` 是本章最实用的一招：
 *   - satisfies：检查每一项都符合 CommandSpec（写错字段立刻报错）
 *   - 同时**不把类型擦宽**，所以 `keyof typeof COMMANDS` 还能拿到
 *     'init' | 'run' | 'copy' 这种精确的字面量联合。
 * 如果写成 `const COMMANDS: Record<string, CommandSpec> = {...}`，keyof 就只剩 string 了。
 */
export const COMMANDS = {
  init: { summary: '生成默认配置文件', args: [] },
  run: { summary: '执行一个任务', args: ['task'], aliases: ['r'] },
  copy: { summary: '复制文件', args: ['src', 'dest'], aliases: ['cp'] },
} as const satisfies Record<string, CommandSpec>;

/** 'init' | 'run' | 'copy' —— 由数据自动推导出来的类型，不用手写第二遍 */
export type CommandName = keyof typeof COMMANDS;

/**
 * 练习 2.11 ⭐⭐ —— 命令名类型守卫
 *
 * 判断任意字符串是不是合法命令名（**只认正式名字，不认别名**）。
 * 提示：`Object.hasOwn(COMMANDS, input)`，注意返回类型谓词。
 *
 * isCommandName('run')   === true
 * isCommandName('r')     === false    // 别名不算
 * isCommandName('nope')  === false
 * isCommandName('toString') === false // 😱 别用 `input in COMMANDS`，原型链上的属性会误判
 */
export function isCommandName(input: string): input is CommandName {
    return Object.hasOwn(COMMANDS, input);
}

/* ------------------------------------------------------------------ *
 * 练习 2.12 ⭐⭐⭐ —— 综合：Result + 可辨识联合 + 穷尽性检查
 * ------------------------------------------------------------------ */

export type CliError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unknown-command'; readonly input: string }
  | {
      readonly kind: 'missing-args';
      readonly command: CommandName;
      readonly expected: number;
      readonly got: number;
    };

/**
 * 练习 2.12a ⭐⭐⭐ —— 解析并"执行"一行命令
 *
 * argv[0] 是命令名或别名，其余是位置参数。规则：
 *   - argv 为空                      -> err({ kind: 'empty' })
 *   - 名字既不是正式名也不是别名      -> err({ kind: 'unknown-command', input })
 *   - 参数个数少于 spec.args.length   -> err({ kind: 'missing-args', command, expected, got })
 *   - 否则 ok(`名字(参数名=值, ...)`)，多余参数忽略
 *
 * 别名要解析成**正式名字**再输出。
 *
 * runCommandLine([])                    -> { kind: 'err', error: { kind: 'empty' } }
 * runCommandLine(['init'])              -> { kind: 'ok', value: 'init()' }
 * runCommandLine(['init', 'x'])         -> { kind: 'ok', value: 'init()' }
 * runCommandLine(['run', 'build'])      -> { kind: 'ok', value: 'run(task=build)' }
 * runCommandLine(['r', 'build'])        -> { kind: 'ok', value: 'run(task=build)' }
 * runCommandLine(['cp', 'a', 'b'])      -> { kind: 'ok', value: 'copy(src=a, dest=b)' }
 * runCommandLine(['copy', 'a'])
 *   -> { kind: 'err', error: { kind: 'missing-args', command: 'copy', expected: 2, got: 1 } }
 * runCommandLine(['nope'])
 *   -> { kind: 'err', error: { kind: 'unknown-command', input: 'nope' } }
 */
export function runCommandLine(argv: readonly string[]): Result<string, CliError> {
    if (argv.length === 0) return { kind: 'err', error: { kind: 'empty' } };
    const cmdName = argv[0] as string;
    let targetCmdName: string | undefined;
    for (const cmd of Object.getOwnPropertyNames(COMMANDS)) {
        if (cmd === cmdName) targetCmdName = cmd;
        else if ((COMMANDS[cmd as CommandName] as CommandSpec).aliases?.includes(cmdName)) targetCmdName = cmd;
    }
    if (targetCmdName === undefined) {
        return { kind: 'err', error: { kind: 'unknown-command', input: cmdName } };
    }
    let argValArr: string[] = [];
    for (let [i, argName] of COMMANDS[targetCmdName as CommandName].args.entries()) {
        if (argv[i+1] === undefined) return { kind: 'err', error: { kind: 'missing-args', command: targetCmdName,
                expected: COMMANDS[targetCmdName as CommandName].args.length, got: argv.length - 1} as CliError };
        argValArr.push(argName+'='+argv[i+1]);
    }
    return { kind: 'ok', value: targetCmdName + '(' + argValArr.join(', ') + ')' };
}

/**
 * 练习 2.12b ⭐⭐ —— 把 CliError 渲染成人话
 *
 * 必须用 switch + assertNever 做穷尽性检查（以后给 CliError 加成员时编译器会提醒你）。
 *
 * formatCliError({ kind: 'empty' })
 *   === '缺少命令，可用命令: init, run, copy'
 * formatCliError({ kind: 'unknown-command', input: 'nope' })
 *   === '未知命令: nope'
 * formatCliError({ kind: 'missing-args', command: 'copy', expected: 2, got: 1 })
 *   === 'copy 需要 2 个参数，实际收到 1 个'
 */
export function formatCliError(error: CliError): string {
    switch (error.kind) {
        case 'empty': return '缺少命令，可用命令: init, run, copy';
        case 'unknown-command': return '未知命令: ' + error.input;
        case 'missing-args': return error.command + ` 需要 ${error.expected} 个参数，实际收到 ${error.got} 个`;
        default: assertNever(error);
    }
}

/* ==================================================================== *
 * 编译期断言（不参与运行时，靠 `pnpm typecheck` 验收）
 *
 * 这是纯类型题的"单元测试"：`Expect<T extends true>` 只接受 true，
 * 所以只要某个 Equals<...> 算出 false，tsc 就会报错。
 * 你实现完上面的函数后，这些断言应该全部通过（它们只看类型，不看实现）。
 * ==================================================================== */

type Expect<T extends true> = T;
/** 严格相等：靠函数参数的逆变位置比较，避免 `any` / 联合类型蒙混过关 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

// UserId 可以当 string 用（单向），但 string 不能当 UserId 用 —— 这就是"模拟名义类型"
type _BrandIsString = Expect<Equals<UserId extends string ? true : false, true>>;
type _StringIsNotUserId = Expect<Equals<string extends UserId ? true : false, false>>;

// keyof typeof + as const 之后拿到的是精确字面量联合，而不是 string
type _CommandNameIsLiteralUnion = Expect<Equals<CommandName, 'init' | 'run' | 'copy'>>;

// 2.10 pick 的返回类型必须精确到 Pick<T, K>，不能是 T，也不能是 Partial<T>
type _Sample = { a: number; b: string; c?: boolean };
type _PickedShape = Expect<Equals<ReturnType<typeof pick<_Sample, 'a'>>, Pick<_Sample, 'a'>>>;
type _PickedIsNotWhole = Expect<Equals<ReturnType<typeof pick<_Sample, 'a'>> extends _Sample ? true : false, false>>;

// 2.8b andThen 的错误类型必须是两个错误类型的联合
type _AndThenError = Expect<
  Equals<ReturnType<typeof andThen<number, 'e1', string, 'e2'>>, Result<string, 'e1' | 'e2'>>
>;

// 2.5b 穷尽性检查的前提：Expr 的 kind 集合是封闭的
type _ExprKinds = Expect<Equals<Expr['kind'], 'lit' | 'neg' | 'add' | 'mul' | 'div'>>;
