/**
 * 第 01 章练习 · 基础语法
 * =====================================================================
 * 对应文档：docs/01-basics.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch01`  或者 `pnpm vitest tests/ch01`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch01-basics.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 * =====================================================================
 */

/**
 * 练习 1.1 ⭐ —— 整数除法
 *
 * 返回 a 除以 b 的【整数部分】，行为要和 Java 的 `int / int` 一致：
 * 也就是向零取整（-7 / 2 === -3，不是 -4）。
 * 当 b 为 0 时返回 null（不要返回 Infinity / NaN）。
 *
 * intDiv(7, 2)   === 3
 * intDiv(-7, 2)  === -3
 * intDiv(7, 0)   === null
 */
export function intDiv(a: number, b: number): number | null {
  throw new Error('TODO 1.1: 实现 intDiv');
}

/**
 * 练习 1.2 ⭐⭐ —— 严格解析整数
 *
 * 只有当整个字符串（允许首尾空白、允许 +/- 号）是一个合法的**安全整数**时才返回该数字，
 * 否则返回 null。要求比 Number() 和 parseInt() 都严格。
 *
 * parseIntStrict('42')      === 42
 * parseIntStrict('  -7 ')   === -7
 * parseIntStrict('+3')      === 3
 * parseIntStrict('42abc')   === null   // parseInt 会返回 42，我们不要
 * parseIntStrict('')        === null   // Number('') 会返回 0，我们不要
 * parseIntStrict('3.5')     === null
 * parseIntStrict('1e3')     === null
 * parseIntStrict('0x1f')    === null
 * parseIntStrict('9007199254740993') === null  // 超出安全整数范围
 */
export function parseIntStrict(input: string): number | null {
  throw new Error('TODO 1.2: 实现 parseIntStrict');
}

/**
 * 练习 1.3 ⭐⭐ —— 判空（考 null vs undefined）
 *
 * 判断一个「可能不存在的字符串」是否为空白：
 * null、undefined、''、'   '、'\t\n' 都算空白。
 *
 * isBlank(null)      === true
 * isBlank(undefined) === true
 * isBlank('')        === true
 * isBlank('  \t ')   === true
 * isBlank('0')       === false   // 注意：'0' 不是空白
 * isBlank(' a ')     === false
 */
export function isBlank(value: string | null | undefined): boolean {
  throw new Error('TODO 1.3: 实现 isBlank');
}

/**
 * 练习 1.4 ⭐⭐⭐ —— ?? 与 || 的区别
 *
 * 从配置里读取端口号：
 *   - 只有当 raw 是 null 或 undefined 时才使用 fallback
 *   - 也就是说 raw = 0 时必须返回 0，**不能**返回 fallback
 *   - raw 为其它 number 时原样返回
 *
 * 这题就是在考你有没有把 `||` 换成 `??`。
 *
 * pickPort(0, 8080)         === 0
 * pickPort(3000, 8080)      === 3000
 * pickPort(null, 8080)      === 8080
 * pickPort(undefined, 8080) === 8080
 */
export function pickPort(raw: number | null | undefined, fallback: number): number {
  throw new Error('TODO 1.4: 实现 pickPort');
}

/**
 * 练习 1.5 ⭐⭐ —— 统计真值个数
 *
 * 统计数组里有多少个「真值」(truthy)。
 * 提醒：假值一共只有 8 个 —— false / 0 / -0 / 0n / '' / null / undefined / NaN
 *
 * truthyCount([0, 1, '', 'a', null, undefined, NaN, [], {}, false, '0'])  === 5
 *   （真值是：1, 'a', [], {}, '0'）
 */
export function truthyCount(values: readonly unknown[]): number {
  throw new Error('TODO 1.5: 实现 truthyCount');
}

/**
 * 练习 1.6 ⭐⭐ —— 运行时类型名
 *
 * 返回一个比 typeof 更实用的类型名：
 *   null        -> 'null'
 *   数组        -> 'array'
 *   其它        -> typeof 的结果（'string' | 'number' | 'boolean' | 'undefined'
 *                                 | 'bigint' | 'symbol' | 'function' | 'object'）
 *
 * kindOf(null)        === 'null'
 * kindOf([1, 2])      === 'array'
 * kindOf({})          === 'object'
 * kindOf('x')         === 'string'
 * kindOf(1n)          === 'bigint'
 * kindOf(() => {})    === 'function'
 */
export function kindOf(value: unknown): string {
  throw new Error('TODO 1.6: 实现 kindOf');
}

/**
 * 练习 1.7 ⭐⭐ —— 按码点数字符
 *
 * 返回字符串真实的「字符（码点）」个数，emoji 只算 1 个。
 *
 * countCodePoints('hello')  === 5
 * countCodePoints('héllo')  === 5
 * countCodePoints('👍')      === 1     // 注意 '👍'.length === 2
 * countCodePoints('a👍b')    === 3
 * countCodePoints('')       === 0
 */
export function countCodePoints(s: string): number {
  throw new Error('TODO 1.7: 实现 countCodePoints');
}

/**
 * 练习 1.8 ⭐⭐ —— 对象参数 + 默认值 + 模板字符串
 *
 * 这是 TS 里代替 Java Builder / Go functional options 的主力写法。
 * 按 RetryOptions 生成一行人类可读的描述，缺省值要生效：
 *   times   默认 3
 *   delayMs 默认 100
 *   label   默认 'task'
 *
 * describeRetry({})                              === 'task: 3 次重试, 间隔 100ms'
 * describeRetry({ times: 5 })                    === 'task: 5 次重试, 间隔 100ms'
 * describeRetry({ label: 'fetch', delayMs: 0 })  === 'fetch: 3 次重试, 间隔 0ms'
 *   ↑ 注意 delayMs 传 0 时必须输出 0ms，不能被默认值覆盖
 */
export interface RetryOptions {
  times?: number;
  delayMs?: number;
  label?: string;
}

export function describeRetry(options: RetryOptions): string {
  throw new Error('TODO 1.8: 实现 describeRetry');
}

/**
 * 练习 1.9 ⭐⭐⭐ —— for...of / entries()，以及不要用 for...in
 *
 * 给定字符串数组，返回 `序号:值` 形式的数组，序号从 1 开始。
 * 空字符串和只含空白的项要**跳过**（但跳过的项不占序号）。
 *
 * numberLines(['a', '', 'b'])        -> ['1:a', '2:b']
 * numberLines([' x ', '  ', 'y'])    -> ['1: x ', '2:y']    // 不要 trim 值本身
 * numberLines([])                    -> []
 */
export function numberLines(lines: readonly string[]): string[] {
  throw new Error('TODO 1.9: 实现 numberLines');
}

/**
 * 练习 1.10 ⭐⭐⭐ —— 综合：解析 CLI 风格的 key=value 参数
 *
 * 输入形如 ['port=8080', 'debug=true', 'name=svc', 'bad', 'empty=']
 * 输出一个 { ok, entries, errors } 结构：
 *   - entries: 解析成功的键值对数组 [key, value]，value 保持字符串原样
 *   - errors:  不合法的原始项（不含 '=' 的，或 '=' 左边为空的）
 *   - ok:      errors.length === 0
 *   - 'empty=' 是合法的，value 为 ''
 *   - 值里如果还有 '='，只按第一个 '=' 切分：'a=b=c' -> ['a', 'b=c']
 *
 * parseKeyValues(['a=1', 'bad', '=2', 'x=y=z'])
 *   -> { ok: false, entries: [['a','1'], ['x','y=z']], errors: ['bad', '=2'] }
 */
export interface KeyValueParseResult {
  ok: boolean;
  entries: Array<[string, string]>;
  errors: string[];
}

export function parseKeyValues(args: readonly string[]): KeyValueParseResult {
  throw new Error('TODO 1.10: 实现 parseKeyValues');
}
