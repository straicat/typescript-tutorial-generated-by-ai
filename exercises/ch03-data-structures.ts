/**
 * 第 03 章练习 · 数据结构
 * =====================================================================
 * 对应文档：docs/03-data-structures.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch03`  或者 `pnpm vitest tests/ch03`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch03-data-structures.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 贯穿本章的两条硬要求（测试会专门检查）：
 *   - **绝不修改入参**：所有函数参数都声明成 readonly，内部用 toSorted / slice / 展开
 *   - **越界访问返回 undefined**：本项目开了 noUncheckedIndexedAccess，下标结果要判空
 * =====================================================================
 */

/**
 * 练习 3.1 ⭐ —— 不可变去重
 *
 * 去掉重复元素，**保持每个值第一次出现的顺序**，返回新数组（入参不能被改）。
 * 提示：Set 用的是 SameValueZero，所以 NaN 会被正确去重，0 和 -0 视为同一个值。
 *
 * dedupe([3, 1, 3, 2, 1])        -> [3, 1, 2]
 * dedupe(['a', 'a'])             -> ['a']
 * dedupe([])                     -> []
 * dedupe([NaN, NaN, 0, -0])      -> [NaN, 0]      // NaN 只留一个，-0 被 0 吸收
 */
export function dedupe<T>(values: readonly T[]): T[] {
  throw new Error('TODO 3.1: 实现 dedupe');
}

/**
 * 练习 3.2 ⭐ —— 分块 chunk
 *
 * 把数组按固定长度切成若干块，最后一块可以不满。返回新数组，入参不动。
 * size 不是正整数（0、负数、小数）时抛 Error，**消息里要包含「正整数」三个字**（测试会检查）。
 *
 * chunk([1, 2, 3, 4, 5], 2)  -> [[1, 2], [3, 4], [5]]
 * chunk([1, 2, 3], 3)        -> [[1, 2, 3]]
 * chunk([1, 2, 3], 10)       -> [[1, 2, 3]]
 * chunk([], 2)               -> []
 * chunk([1], 0)              -> 抛 Error
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  throw new Error('TODO 3.2: 实现 chunk');
}

/**
 * 练习 3.3 ⭐⭐ —— 正确的多字段排序（本章最容易写错的一题）
 *
 * 排序规则，依次比较：
 *   ① score 降序
 *   ② score 相同时 level 降序
 *   ③ 都相同时 name 升序，用 `localeCompare(other, 'zh-CN')`（中文要按拼音，不能按码点）
 *
 * 要求：
 *   - 返回**新数组**，绝不能修改传进来的 players（用 toSorted，或先 [...players] 再 sort）
 *   - 不要写 `a.score > b.score`（返回 boolean 会让比较结果丢信息）
 *
 * rankPlayers([
 *   { name: 'bob', score: 10, level: 1 },
 *   { name: 'amy', score: 100, level: 1 },
 *   { name: 'cid', score: 10, level: 9 },
 * ])
 *   -> [amy(100), cid(10, lv9), bob(10, lv1)]
 */
export interface Player {
  name: string;
  score: number;
  level: number;
}

export function rankPlayers(players: readonly Player[]): Player[] {
  throw new Error('TODO 3.3: 实现 rankPlayers');
}

/**
 * 练习 3.4 ⭐⭐ —— 元组做多返回值
 *
 * 一次遍历返回 [最小值, 最大值, 平均值]，空数组返回 null（不要返回 [Infinity, -Infinity, NaN]）。
 * 平均值四舍五入到 2 位小数（用 Math.round(x * 100) / 100，避免浮点尾巴）。
 *
 * 注意：因为开了 noUncheckedIndexedAccess，`values[0]` 的类型是 `number | undefined`，
 * 请用「先取到局部变量再判空」或 `at()` + `??` 处理，不要用 `!`。
 *
 * minMaxAvg([3, 1, 2])      -> [1, 3, 2]
 * minMaxAvg([5])            -> [5, 5, 5]
 * minMaxAvg([1, 2])         -> [1, 2, 1.5]
 * minMaxAvg([-3, 0, 1])     -> [-3, 1, -0.67]
 * minMaxAvg([])             -> null
 */
export function minMaxAvg(values: readonly number[]): readonly [number, number, number] | null {
  throw new Error('TODO 3.4: 实现 minMaxAvg');
}

/**
 * 练习 3.5 ⭐⭐ —— 用 Map 计数 + TopN
 *
 * 统计每个词出现的次数，返回出现次数最多的前 n 个 `[词, 次数]` 元组。
 * 规则：
 *   - trim 后为空的词直接忽略；其余词按 trim 后的结果统计（'a ' 和 'a' 是同一个词）
 *   - 次数降序；次数相同按词升序（ASCII 比较即可，用 < / >）
 *   - n <= 0 返回 []；n 超过词种类数就全返回
 *
 * topWords(['a', 'b', 'a', 'c', 'b', 'a'], 2)  -> [['a', 3], ['b', 2]]
 * topWords(['x', 'y'], 5)                      -> [['x', 1], ['y', 1]]   // 同分按词升序
 * topWords(['  ', ' a ', 'a'], 3)              -> [['a', 2]]
 * topWords(['a'], 0)                           -> []
 */
export function topWords(words: readonly string[], n: number): Array<[string, number]> {
  throw new Error('TODO 3.5: 实现 topWords');
}

/**
 * 练习 3.6 ⭐⭐ —— groupBy，返回 Map（对应 Java 的 Collectors.groupingBy）
 *
 * 按 keyOf 计算的键分组。要求：
 *   - 返回 Map（不是普通对象），这样键可以是 number / 对象等非字符串类型
 *   - **键的顺序 = 该键第一次出现的顺序**（Map 保证插入顺序）
 *   - 每组内部保持元素在原数组中的相对顺序
 *   - 入参不能被修改
 *
 * groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'even' : 'odd'))
 *   -> Map { 'odd' => [1, 3], 'even' => [2, 4] }
 * groupBy([], (n: number) => n)  -> Map {}
 */
export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  throw new Error('TODO 3.6: 实现 groupBy');
}

/**
 * 练习 3.7 ⭐⭐ —— 递归扁平化任意深度的嵌套数组
 *
 * 不允许直接用 `arr.flat(Infinity)`（那样就不用你写了），请用递归实现。
 * 顺序要保持深度优先、从左到右。
 *
 * 类型提示：元素类型是 `number | NestedNumbers`，请用 `typeof item === 'number'` 分流。
 * 用 `Array.isArray(item)` 判断在这里过不了编译 —— 它的守卫签名是 `arg is any[]`，
 * 对 ReadonlyArray 不生效，else 分支收窄不掉（运行时判数组仍然只能用 Array.isArray）。
 *
 * flattenDeep([1, [2, [3, [4]]], 5])  -> [1, 2, 3, 4, 5]
 * flattenDeep([])                     -> []
 * flattenDeep([[], [[]], [[[1]]]])    -> [1]
 */
export type NestedNumbers = ReadonlyArray<number | NestedNumbers>;

export function flattenDeep(input: NestedNumbers): number[] {
  throw new Error('TODO 3.7: 实现 flattenDeep');
}

/**
 * 练习 3.8 ⭐⭐ —— 交集 / 差集（Set 的典型用法）
 *
 * 返回三个数组，全部去重：
 *   both:  同时出现在 a 和 b 里的元素，按【在 a 中第一次出现的顺序】
 *   onlyA: 只在 a 里的，按在 a 中的顺序
 *   onlyB: 只在 b 里的，按在 b 中的顺序
 *
 * 提示：把 b 转成 Set 再判断，避免 O(n*m) 的 includes 嵌套循环。
 *
 * compareSets(['a', 'b', 'c', 'a'], ['c', 'd', 'b'])
 *   -> { both: ['b', 'c'], onlyA: ['a'], onlyB: ['d'] }
 * compareSets([], ['x'])  -> { both: [], onlyA: [], onlyB: ['x'] }
 */
export interface SetDiff {
  both: string[];
  onlyA: string[];
  onlyB: string[];
}

export function compareSets(a: readonly string[], b: readonly string[]): SetDiff {
  throw new Error('TODO 3.8: 实现 compareSets');
}

/**
 * 练习 3.9 ⭐⭐ —— 用 Object.entries 做统计
 *
 * 输入：每个服务名 -> 若干次耗时采样（毫秒）。
 * 输出：每个服务的统计结果数组，按 total 降序，total 相同按 name 升序。
 *   count = 采样个数
 *   total = 总和
 *   avg   = 平均值，四舍五入到 2 位小数；count 为 0 时 avg 和 total 都是 0
 *
 * serviceStats({ auth: [10, 20], db: [100], idle: [] })
 *   -> [ { name: 'db', count: 1, total: 100, avg: 100 },
 *        { name: 'auth', count: 2, total: 30, avg: 15 },
 *        { name: 'idle', count: 0, total: 0, avg: 0 } ]
 */
export interface ServiceStat {
  name: string;
  count: number;
  total: number;
  avg: number;
}

export function serviceStats(samples: Readonly<Record<string, readonly number[]>>): ServiceStat[] {
  throw new Error('TODO 3.9: 实现 serviceStats');
}

/**
 * 练习 3.10 ⭐⭐⭐ —— 深合并对象 + 防原型污染
 *
 * 把 patch 合并进 base，返回**新对象**（base 和 patch 都不能被修改）。规则：
 *   - 两边同一个键的值**都是"普通对象"**时 -> 递归深合并
 *   - 否则 patch 的值直接覆盖（数组按整体替换，不做逐元素合并）
 *   - patch 里值为 undefined 的键**跳过**（保留 base 的值）
 *   - 🔴 安全：键名是 '__proto__' / 'constructor' / 'prototype' 时**直接忽略**，
 *     否则 `JSON.parse('{"__proto__":{"isAdmin":true}}')` 能污染全进程的 Object.prototype
 *   - "普通对象"的判定：typeof === 'object' && !== null && !Array.isArray(v)
 *
 * deepMerge({ a: 1, db: { host: 'x', port: 1 } }, { db: { port: 2 }, c: 3 })
 *   -> { a: 1, db: { host: 'x', port: 2 }, c: 3 }
 * deepMerge({ list: [1, 2] }, { list: [9] })       -> { list: [9] }
 * deepMerge({ a: 1 }, { a: undefined })            -> { a: 1 }
 * deepMerge({}, JSON.parse('{"__proto__":{"bad":1}}'))  -> {}
 */
export type PlainObject = Record<string, unknown>;

export function deepMerge(base: Readonly<PlainObject>, patch: Readonly<PlainObject>): PlainObject {
  throw new Error('TODO 3.10: 实现 deepMerge');
}

/**
 * 练习 3.11 ⭐⭐⭐ —— 安全解析 JSON（JSON.parse 返回 any 的正确处理方式）
 *
 * 实现一个不会抛异常的 JSON 解析器：
 *   - 语法错误（JSON.parse 抛异常）        -> { ok: false, error: 'invalid json' }
 *   - 解析成功但 isValid 守卫返回 false    -> { ok: false, error: 'invalid shape' }
 *   - 解析成功且守卫通过                   -> { ok: true, value }
 *
 * 关键点：`JSON.parse` 的返回值类型是 any，直接往外传会让整条调用链失去类型保护。
 * 请**先把它当成 unknown**，再交给守卫函数收窄。
 *
 * const isNums = (v: unknown): v is number[] =>
 *   Array.isArray(v) && v.every((x) => typeof x === 'number');
 *
 * safeJsonParse('[1,2]', isNums)   -> { ok: true, value: [1, 2] }
 * safeJsonParse('[1,"a"]', isNums) -> { ok: false, error: 'invalid shape' }
 * safeJsonParse('{oops', isNums)   -> { ok: false, error: 'invalid json' }
 * safeJsonParse('', isNums)        -> { ok: false, error: 'invalid json' }
 */
export type JsonParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function safeJsonParse<T>(raw: string, isValid: (value: unknown) => value is T): JsonParseResult<T> {
  throw new Error('TODO 3.11: 实现 safeJsonParse');
}

/**
 * 练习 3.12 ⭐⭐⭐ —— 综合：用生成器实现惰性滑动窗口
 *
 * 从任意可迭代对象（数组、Set、字符串、甚至**无限生成器**）里产出滑动窗口。
 *   - size：窗口大小，step：每次前进几个元素（默认 1）
 *   - 元素不够一个完整窗口时不产出（末尾的残缺窗口丢掉）
 *   - size / step 不是正整数时抛 Error，消息里要包含「正整数」（生成器体里抛，
 *     所以异常发生在第一次 next() 时，这也是生成器和普通函数的一个区别）
 *   - 🔴 必须**惰性**：不能先把 source 全部读进数组，否则遇到无限生成器会死循环。
 *     测试里会传一个无限自增序列，只取前两个窗口。
 *   - 每次 yield 出去的必须是**新数组**（不能复用同一个 buffer，否则调用方存下来的窗口会一起变）
 *
 * [...windows([1, 2, 3, 4], 2)]       -> [[1,2], [2,3], [3,4]]
 * [...windows([1, 2, 3, 4, 5], 2, 2)] -> [[1,2], [3,4]]        // 末尾 [5] 不足丢掉
 * [...windows([1, 2], 3)]             -> []
 * [...windows('abc', 2)]              -> [['a','b'], ['b','c']]
 */
export function* windows<T>(
  source: Iterable<T>,
  size: number,
  step = 1,
): Generator<T[], void, undefined> {
  throw new Error('TODO 3.12: 实现 windows');
}
