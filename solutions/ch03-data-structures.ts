/**
 * 第 03 章参考答案 · 数据结构
 * 每题都附带「为什么这么写 / 常见错法」的说明，看的时候重点看注释。
 */

// ---------- 3.1 ----------
export function dedupe<T>(values: readonly T[]): T[] {
  // Set 保持插入顺序，展开回数组就得到"首次出现顺序"的去重结果。
  // Set 用 SameValueZero 比较：NaN 等于自己（所以能去重），0 和 -0 视为同一个值。
  // 常见错法：values.filter((v, i) => values.indexOf(v) === i)
  //   —— O(n²)，而且 indexOf 用 ===，永远找不到 NaN，NaN 会全部保留。
  return [...new Set(values)];
}

// ---------- 3.2 ----------
export function chunk<T>(items: readonly T[], size: number): T[][] {
  // 先卡参数：0 会让下面的循环变成死循环，小数会切出重叠的块。
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunk: size 必须是正整数，收到 ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    // slice 返回新数组且自动处理越界（末尾不足时只给剩下的），
    // 所以不需要 Math.min(i + size, items.length)。
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ---------- 3.3 ----------
export interface Player {
  name: string;
  score: number;
  level: number;
}

export function rankPlayers(players: readonly Player[]): Player[] {
  // ① toSorted（ES2023）返回新数组，原数组不动 —— 这是这题的考点。
  //    老写法 [...players].sort(...) 等价；直接 players.sort(...) 会改调用方的数组，
  //    而且参数是 readonly Player[]，编译器根本不给你调 sort。
  // ② 比较器用 `||` 串联：前一项是 0（相等）时才走下一项，
  //    等价于 Java 的 Comparator.comparing(...).thenComparing(...)。
  // ③ 名字用 localeCompare('zh-CN')：中文按拼音，'李' < '王' < '张'；
  //    如果写 a.name < b.name 就是按 UTF-16 码点排，中文顺序是乱的。
  // 常见错法：(a, b) => a.score > b.score —— 返回 boolean，被转成 1/0，
  //    "小于"这个信息永远丢失，排序结果不对。
  return players.toSorted(
    (a, b) => b.score - a.score || b.level - a.level || a.name.localeCompare(b.name, 'zh-CN'),
  );
}

// ---------- 3.4 ----------
export function minMaxAvg(values: readonly number[]): readonly [number, number, number] | null {
  // 空数组必须显式判掉：否则 min 初值只能写 Infinity，返回值毫无意义。
  const head = values[0];
  if (head === undefined) return null; // 先取局部变量再判空，类型自动收窄成 number

  let min = head;
  let max = head;
  let total = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    total += v;
  }

  // 四舍五入到 2 位：先放大再除，避免 0.1+0.2 那种浮点尾巴直接输出。
  const avg = Math.round((total / values.length) * 100) / 100;
  return [min, max, avg];
}

// ---------- 3.5 ----------
export function topWords(words: readonly string[], n: number): Array<[string, number]> {
  if (n <= 0) return [];

  // 计数用 Map 而不是对象：词是外部输入，可能出现 '__proto__' / 'constructor'
  // 这种会撞原型链的键（用对象时 counts['__proto__'] 的行为很诡异）。
  const counts = new Map<string, number>();
  for (const raw of words) {
    const word = raw.trim();
    if (word.length === 0) continue; // 空白词忽略
    // get 回来是 number | undefined，用 ?? 0 兜底；
    // 比 has() + get() 少一次哈希查找。
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    // 次数降序；同分按词升序（这里是 ASCII 场景，直接比字符串即可）
    .toSorted((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n); // slice 超出长度不会报错，天然满足 "n 太大就全返回"
}

// ---------- 3.6 ----------
export function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    // "先 get 再判 undefined" 比 "has + get" 快一半，是 TS 里的惯用写法。
    if (bucket === undefined) out.set(key, [item]);
    else bucket.push(item); // 往 Map 里已存在的数组里 push，不需要 set 回去
  }
  return out;
  // 为什么返回 Map 而不是 Record<string, T[]>：
  //   ① 键可以是 number / 对象 / symbol，不会被强制转成字符串
  //   ② 顺序可靠（对象的整数型键会被引擎重排到最前面）
  //   ③ 键来自数据，不怕 '__proto__' 之类的污染
}

// ---------- 3.7 ----------
export type NestedNumbers = ReadonlyArray<number | NestedNumbers>;

export function flattenDeep(input: NestedNumbers): number[] {
  const out: number[] = [];
  for (const item of input) {
    // 这里先判 number 而不是先判 Array.isArray，是有原因的：
    //   Array.isArray() 的类型守卫签名是 `arg is any[]`，对 ReadonlyArray 不生效，
    //   所以 else 分支里 item 仍然是 `number | NestedNumbers`，编译不过。
    // 判 typeof === 'number' 则能干净地把两个分支都收窄。
    // （运行时判"是不是数组"仍然只能用 Array.isArray —— typeof [] === 'object'。）
    if (typeof item === 'number') out.push(item);
    else out.push(...flattenDeep(item));
  }
  return out;
  // 内置等价物：input.flat(Infinity)（本题要求手写，好处是能顺便控制递归深度）。
  // 注意 flat() 不带参数只展开【一层】，这是很常见的误用。
}

// ---------- 3.8 ----------
export interface SetDiff {
  both: string[];
  onlyA: string[];
  onlyB: string[];
}

export function compareSets(a: readonly string[], b: readonly string[]): SetDiff {
  // 两边先转 Set：查找从 O(n) 的 includes 变成 O(1)，
  // 同时顺手完成"去重"这个需求。
  const setA = new Set(a);
  const setB = new Set(b);

  const both: string[] = [];
  const onlyA: string[] = [];
  // 遍历 Set 而不是原数组，这样重复元素只会被处理一次，顺序仍是首次出现顺序。
  for (const v of setA) {
    if (setB.has(v)) both.push(v);
    else onlyA.push(v);
  }

  const onlyB = [...setB].filter((v) => !setA.has(v));
  return { both, onlyA, onlyB };
}

// ---------- 3.9 ----------
export interface ServiceStat {
  name: string;
  count: number;
  total: number;
  avg: number;
}

export function serviceStats(samples: Readonly<Record<string, readonly number[]>>): ServiceStat[] {
  // Object.entries 只返回【自有、可枚举、string 键】，正好是我们要统计的东西；
  // 用 for...in 会连原型链上的属性一起遍历，是老代码里的经典 bug。
  const stats = Object.entries(samples).map(([name, values]): ServiceStat => {
    const total = values.reduce((sum, v) => sum + v, 0); // 初始值 0 不能省，空数组会抛错
    const count = values.length;
    // 先防除零：count === 0 时 total/count 是 NaN，NaN 会污染后面所有比较。
    const avg = count === 0 ? 0 : Math.round((total / count) * 100) / 100;
    return { name, count, total, avg };
  });

  // total 降序，同分按名字升序。map 已经返回新数组了，这里用 sort 也不会碰到入参。
  return stats.sort((x, y) => y.total - x.total || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

// ---------- 3.10 ----------
export type PlainObject = Record<string, unknown>;

// 这三个键会写到原型链上，是「原型污染」漏洞的入口，合并外部数据时必须拦掉。
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is PlainObject {
  // 注意 typeof null === 'object'，数组也是 object，两个都要排除。
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge(base: Readonly<PlainObject>, patch: Readonly<PlainObject>): PlainObject {
  const out: PlainObject = {};

  // 先把 base 拷一层进新对象。不能写 const out = base（那是同一个引用，
  // 后面的赋值就直接改了调用方的对象）。
  for (const [key, value] of Object.entries(base)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = value;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    // undefined 表示"这次没提供这个字段"，不应该把 base 的值抹掉。
    // 用 `value === undefined` 而不是 `!value`，否则 0 / '' / false 会被当成没提供。
    if (value === undefined) continue;

    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) {
      out[key] = deepMerge(prev, value); // 两边都是普通对象才递归
    } else {
      out[key] = value; // 数组 / 原始值 / null：整体覆盖，不做逐元素合并
    }
  }

  return out;
  // 说明：base 里没有被 patch 覆盖的嵌套对象是按【引用】复用的（浅共享）。
  // 需要彻底切断关系时在外面套一层 structuredClone(deepMerge(a, b))。
}

// ---------- 3.11 ----------
export type JsonParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function safeJsonParse<T>(
  raw: string,
  isValid: (value: unknown) => value is T,
): JsonParseResult<T> {
  let parsed: unknown;
  try {
    // 关键一行：JSON.parse 的返回类型是 any，会污染整条调用链
    // （any 上访问任何属性编译器都不管）。这里立刻把它降级成 unknown，
    // 强制后面必须先收窄才能用。
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // JSON.parse 语法错误抛的是 SyntaxError；这里不关心细节，
    // 只把"失败"变成返回值（≈ Go 的 (value, err)），调用方不用写 try/catch。
    return { ok: false, error: 'invalid json' };
  }

  // 类型守卫 `value is T` 让 TS 在 true 分支里把 unknown 收窄成 T。
  if (!isValid(parsed)) return { ok: false, error: 'invalid shape' };
  return { ok: true, value: parsed };
  // 生产环境别自己写守卫，用 zod：UserSchema.safeParse(parsed)（见第 07 章）。
}

// ---------- 3.12 ----------
export function* windows<T>(
  source: Iterable<T>,
  size: number,
  step = 1,
): Generator<T[], void, undefined> {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`windows: size 必须是正整数，收到 ${size}`);
  }
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`windows: step 必须是正整数，收到 ${step}`);
  }

  const buffer: T[] = [];
  let skip = 0; // step > size 时需要丢掉中间的元素

  // for...of 消费 Iterable：一次只拉一个元素，所以传无限生成器也不会卡死。
  // 常见错法：先 const all = [...source] —— 遇到无限序列直接 OOM。
  for (const item of source) {
    if (skip > 0) {
      skip -= 1;
      continue;
    }

    buffer.push(item);
    if (buffer.length < size) continue;

    // yield 出去必须是拷贝：直接 yield buffer 的话，调用方存下来的窗口
    // 会随着后续 push/splice 一起变（[...windows(x, 2)] 会得到一堆相同的数组）。
    yield [...buffer];

    if (step >= size) {
      buffer.length = 0; // 清空，并跳过 step - size 个元素
      skip = step - size;
    } else {
      buffer.splice(0, step); // 窗口重叠：只丢掉最前面 step 个（splice 是原地改，这里改的是自己的 buffer）
    }
  }
  // 循环自然结束时 buffer 里剩下的不足一个窗口，按要求丢弃 —— 所以这里没有收尾的 yield。
}
