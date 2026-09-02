# 03 · 数据结构：没有 List / Slice 之分，但坑一个都不少

> 本章把 Java 的 `List/Map/Set/Stream` 和 Go 的 `slice/map` 翻译成 TS 写法。重点不是 API 清单
> （能查文档），而是三件会让你出线上事故的事：**`sort` 默认按字符串排**、
> **很多方法是原地修改**、**`Map` 的键永远按引用比**。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 排序 | `list.sort(cmp)` / `sort.Slice` | `arr.sort()` **默认按字符串字典序**：`[10,9,1]` → `[1,10,9]` | 🔴 高 |
| 原地修改 | `Collections.sort` 原地，Stream 不改原集合 | `sort/reverse/splice/push` **原地改**；`map/filter/slice` 返回新数组 | 🔴 高 |
| Map 的键 | `HashMap` 调 `equals`/`hashCode` | **永远按引用比**，没有 `hashCode` 可重写 | 🔴 高 |
| 下标越界 | 抛 `IndexOutOfBounds` / panic | 返回 `undefined`，**不抛异常** | 🔴 高 |
| JSON | Jackson 有类型 | `JSON.parse` 返回 `any`；`Date`/`Map`/`undefined` 全丢 | 🔴 高 |
| 数组类型 | `List`/`ArrayList`/`[]T`/slice | **只有一种** `T[]`（长度可变，等价 `Array<T>`） | 🟡 中 |
| 对象当 map | `HashMap<String,V>` | `Record<string,V>`；键只能 string/number/symbol；**有原型链** | 🟡 中 |
| 深拷贝 | `clone()` / 序列化 | `structuredClone(x)`（Node 17+ 内置） | 🟡 中 |
| 多返回值 | Go 原生 / Java 要 `record` | **元组** `[string, number]` + 解构 | 🟡 中 |
| 不可变 | `List.of` 运行时抛异常 | `readonly`/`as const` **只在编译期**，运行时靠 `Object.freeze` | 🟡 中 |
| 迭代器 | `Iterator` / channel | 迭代协议 + `function*`（天然惰性，但**没有并发**） | 🟢 低 |
| 集合初始化 | `new ArrayList<>()` | 字面量 `[]` / `{}`，不用 `new` | 🟢 低 |

---

## 1. Array：只有一种数组，越界不抛异常

没有 `ArrayList`/`LinkedList`/slice 之分，**就一个 `Array`**，长度可变。

```ts
const a: number[] = [1, 2, 3];                    // ✅ 首选写法
const b: Array<number> = [1, 2, 3];               // 完全等价，泛型嵌套时更清晰
const c: (string | number)[] = [1, 'x'];          // 联合元素类型
const d = new Array<number>(3);                   // 😱 长度 3 的"空洞"数组，几乎永远别用
const e = Array.from({ length: 3 }, (_, i) => i); // ✅ [0,1,2] 才是"初始化 N 个元素"

const list = [1, 2, 3];
list[99];       // undefined  ← Java 抛 IndexOutOfBounds，Go 会 panic
list[-1];       // undefined  😱 负数下标不是"从后往前"，Python 习惯的人会栽
list.at(-1);    // 3          ✅ 要"最后一个"用 at()
```

本项目开了 **`noUncheckedIndexedAccess`**，编译器把这个不安全暴露成类型：

```ts
const nums = [1, 2, 3];
const first = nums[0];       // 类型是 number | undefined，不是 number！ first + 1 会报错
const head = nums[0];        // ① 先取局部变量再判空（最通用，类型收窄会记住结果）
if (head === undefined) return 0;
head + 1;                    // ✅ 这里已经是 number
const port = nums[0] ?? 8080;              // ② ?? 兜底 -> number
const last = nums.at(-1) ?? 0;             // ③ at()：同样是 T | undefined，但语义清楚
for (const [i, v] of nums.entries()) console.log(i, v);   // ④ 遍历时根本别用下标
```

> ⚠️ 别用 `nums[0]!` 关掉报错。`!` 是骗编译器：循环边界写错时你会拿到 `undefined`，
> 然后在离现场很远的下游炸开。

---

## 2. Array 方法大全对照表

TS 这些方法直接在数组上调用，不需要 `.stream()`/`.collect()`，**也不惰性**（每步生成完整中间数组）。

| Java Stream / Go | TypeScript | 返回 |
| --- | --- | --- |
| `.map(f).toList()` / `.filter(p)` | `arr.map(f)` / `arr.filter(p)` | 新数组 |
| `.reduce(0, f)` | `arr.reduce(f, 0)`（初始值别省，空数组会抛错） | 累加值 |
| `.findFirst()` / `indexOf` | `arr.find(p)` / `arr.findIndex(p)`（找不到给 `undefined` / `-1`） | 元素 / 下标 |
| 反向查找 | `arr.findLast(p)` / `arr.findLastIndex(p)` | 元素 / 下标 |
| `.anyMatch(p)` / `.allMatch(p)` | `arr.some(p)` / `arr.every(p)` | boolean |
| `.flatMap(f)` / 嵌套拉平 | `arr.flatMap(f)` / `arr.flat(2)` / `arr.flat(Infinity)`（默认只一层） | 新数组 |
| `.contains(x)` | `arr.includes(x)` 能匹配 `NaN`；`arr.indexOf(x)` 用 `===`，**找不到 `NaN`** 😱 | boolean / 下标 |
| `subList(a,b)` / `s[a:b]` | `arr.slice(a, b)`（支持负数，越界自动截断） | 新数组 |
| `list.remove(i)` / 插入 | `arr.splice(start, delCount, ...items)` | **原地改**，返回被删的 |
| `addAll` | `arr.concat(other)` / `[...arr, ...other]` | 新数组 |
| `String.join(",", list)` | `arr.join(',')`（`null`/`undefined` 变空串 😱） | string |
| `Collections.reverse` / `sort` | `arr.reverse()` / `arr.sort(cmp)` / `arr.fill(v)` | **原地改** |
| `list.get(i)` | `arr.at(i)`（支持负数） | `T \| undefined` |
| 带下标遍历 | `arr.entries()` / `arr.keys()` / `arr.values()` | 迭代器 |

### 原地修改 vs 返回新数组 —— TS 新手最高频的 bug

方法名完全看不出区别，只能背：

```
😱 原地修改：push pop shift unshift splice sort reverse fill copyWithin
✅ 返回新数组：map filter slice concat flat flatMap toSorted toReversed toSpliced with
```

```ts
const scores = [3, 1, 2];
const sorted = scores.sort();    // 😱 scores 自己也被排了，sorted === scores（同一个对象）
console.log(scores);             // [1, 2, 3]  ← 调用方的数组被你悄悄改了
const asc = [...scores].sort((a, b) => a - b);   // ✅ 老写法：先拷贝再排

// ES2023 的不可变版本（Node 20+，本项目 target 就是 ES2023）
const nums = [3, 1, 2];
nums.toSorted((a, b) => a - b);  // [1,2,3]      nums.toReversed();  // [2,1,3]
nums.toSpliced(1, 1);            // [3,2]        nums.with(0, 99);   // [99,1,2] 改一个元素
console.log(nums);               // [3,1,2] 全程没动 ✅
```

**规则：只读取入参的函数一律声明 `readonly T[]`，内部只用 `toSorted`/`slice` 这类方法** ——
编译器会直接禁掉 `push`/`sort`。本章练习全部这么要求。

---

## 3. `sort` 的巨坑：默认按字符串字典序

排行榜、金额统计、分页里最常见的线上 bug：

```ts
[10, 9, 1].sort();                  // 😱 [1, 10, 9]  ← 不是 [1, 9, 10]
[10, 9, 1].sort((a, b) => a - b);   // ✅ [1, 9, 10]
```

原因：不传比较器时 `sort` 把元素 `String()` 后按 UTF-16 逐位比较，`'10' < '9'`。
Java 的 `List<Integer>.sort(null)` 用自然序，Go 有 `sort.Ints`，**只有 JS 是这样**。
比较器约定和 Java `Comparator` 一致：**负数 a 在前，0 相等，正数 b 在前**。

```ts
[3, 1, 2].toSorted((a, b) => a - b);   // 升序（降序写 b - a）
['b', 'a'].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));    // ASCII 字符串
// 中文/多语言必须用 localeCompare，否则按码点排，顺序是乱的
['张三', '李四', '王五'].toSorted((a, b) => a.localeCompare(b, 'zh-CN'));
// -> ['李四', '王五', '张三']  ✅ 按拼音 li < wang < zhang
['v10', 'v9'].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
// -> ['v9', 'v10'] ✅ 数字型字符串用 numeric

// 多字段排序：比较器用 || 串联，前一项为 0（相等）才走下一项
interface Player { name: string; score: number; level: number }
const ranked = players.toSorted(
  (a, b) =>
    b.score - a.score ||                    // ① 分数降序
    b.level - a.level ||                    // ② 分数相同看等级降序
    a.name.localeCompare(b.name, 'zh-CN'),  // ③ 都相同按名字升序
);   // 比 Java 的 comparing(...).thenComparing(...) 还短
```

- ⚠️ 别写 `(a, b) => a.score > b.score`：boolean 被转成 `1`/`0`，「a 小于 b」这个信息永远丢失。
- **稳定排序**：ES2019 起 `sort` 保证稳定，可以像 Java 那样"先排次要字段再排主要字段"。
- 洗牌别写 `sort(() => Math.random() - 0.5)`（比较器不自洽，分布严重偏斜），用 Fisher–Yates。

---

## 4. 元组 Tuple：TS 版的「多返回值」

Go 有 `func f() (int, error)`，Java 得造 `record Pair<A,B>`。TS 用**元组**：固定长度、每位固定类型。

```ts
type Pair = [string, number];
const p: Pair = ['qps', 120];        // [120, 'qps'] ❌ 顺序错报错；长度不对也报错
type Sample = [name: string, value: number];        // 命名元组：只是标签，运行时仍是数组
type Range = [start: number, end?: number];         // 可选元素
type Command = [cmd: string, ...args: string[]];    // 剩余元素

function minMax(values: readonly number[]): [number, number] | null {
  if (values.length === 0) return null;   // ✅ 空数组显式返回 null，别返回 [Infinity, -Infinity]
  let min = values[0] ?? 0, max = min;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  return [min, max];
}
const r = minMax([3, 1, 2]);
if (r !== null) { const [lo, hi] = r; }   // ✅ 解构，等价于 Go 的 lo, hi := minMax(...)

const x = [1, 'x'];                 // (string | number)[]  ← 长度和顺序信息丢了
const y = [1, 'x'] as const;        // readonly [1, 'x']    ✅ as const 得到只读元组
```

> **什么时候别用元组**：超过 3 个元素、或调用方容易记错顺序时，改用对象 `{ min, max }` ——
> 调用处自带字段名，重构安全。Go 的多返回值能忍，是因为它基本只返回 `(value, error)`。

---

## 5. 对象当 map 用：`Record<string, T>`

对象字面量是最轻量的哈希表，但**它不是干净的 map**（带原型链）。

```ts
const counts: Record<string, number> = { a: 1, b: 2 };
counts['c'] = 3; counts.d = 4;            // 点语法和下标等价
counts['zzz'];                            // undefined（类型也是 number | undefined ✅）
delete counts.a;                          // ≈ map.remove
'b' in counts;                            // true ← 但也会命中原型链上的键！
Object.hasOwn(counts, 'b');               // true ✅ 只看自有属性（ES2022），首选

// 键只能是 string / number / symbol，而 number 键会被自动转成字符串
Object.keys({ 1: 'a' });                  // ['1']      😱 键其实是字符串
Object.keys({ '2': 'x', '1': 'y' });      // ['1','2']  😱 整数型键被引擎重排了
// 想用对象 / Date 当键？对象做不到，必须用 Map（见下一节）

const obj = { a: 1, b: 2 };
Object.keys(obj);                 // ['a','b']          ≈ keySet()
Object.values(obj);               // [1,2]              ≈ values()
Object.entries(obj);              // [['a',1],['b',2]]  ≈ entrySet()，元素就是元组
Object.fromEntries([['a', 1]]);   // { a: 1 }           ≈ 收集回 map
Object.assign({}, obj, { c: 3 }); // 浅合并（**会改第一个参数**，所以传 {}）
Object.freeze(obj);               // 运行时冻结（见第 9 节）

let total = 0;                    // 统计对象的标准写法：entries + 解构
for (const [key, value] of Object.entries(obj)) total += value;
```

⚠️ `Object.keys/values/entries` **只返回自有、可枚举、string 键**（不含 symbol、不含原型链）——
这正是我们想要的，所以统计对象一律用它们，别用 `for...in`。

### 原型链的坑：原型污染，以及为什么老代码写 `hasOwnProperty.call`

```ts
const payload = JSON.parse('{"__proto__": {"isAdmin": true}}');   // 攻击载荷
// 若你的 deepMerge 直接 out[key] = value 且不过滤 key，'__proto__' 会写脏
// Object.prototype —— 全进程所有对象都多了 isAdmin 😱 这就是「原型污染」漏洞。
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);  // 防御一：跳过危险键
const clean = Object.create(null) as Record<string, unknown>;          // 防御二：无原型对象
'toString' in clean;              // false ✅ 干净（但 clean.toString() 会运行时报错）
Object.prototype.hasOwnProperty.call(obj, 'k');   // 老代码这么写，是防对象自己有个叫
Object.hasOwn(obj, 'k');                          // hasOwnProperty 的键；现在用这个 ✅
```

`{}` 天生带 `toString`/`constructor`/`valueOf` 等继承属性 ——
**用对象存用户可控的键是危险的**，这是下一节第一条理由。

---

## 6. `Map` / `Set`：更接近 Java 的集合

```ts
const m = new Map<string, number>([['a', 1], ['b', 2]]);   // 用 entry 数组初始化
m.set('c', 3); m.get('a'); m.has('a'); m.delete('a'); m.clear();
m.size;                              // ⚠️ 是属性，不是 m.size()
for (const [k, v] of m) console.log(k, v);   // Map 可迭代，严格按【插入顺序】
[...m.keys()];                       // keys() / values() / entries() 都是迭代器
Object.fromEntries(m);               // Map -> 对象（键会变字符串）
new Map(Object.entries({ a: 1 }));   // 对象 -> Map

const s = new Set<string>(['a', 'a', 'b']);
s.size;                              // 2（自动去重）
s.add('c'); s.has('a'); s.delete('a'); [...s];   // 转数组，按插入顺序
```

**什么时候必须用 `Map` 而不是对象：**① 键不是字符串（数字要保持数字类型、对象、`Date`、`Symbol`）；
② 键来自用户输入/外部数据，避免撞原型链；③ 需要可靠顺序（对象的整数型键会被重排）；
④ 频繁增删（`delete obj.k` 会让引擎隐藏类退化）；⑤ 需要 `size`（对象得 `Object.keys().length`，O(n)）。
反过来：要 `JSON.stringify` 直接序列化、或字段固定时用对象（`Map` 序列化出来是 `{}`）。

### 🔴 重大差异：`Map` 的键按引用比较，没有 `hashCode`

Java 的 `HashMap` 调 `equals()`/`hashCode()`，内容相同就是同一个键。**TS 没有这套机制**，
`Map`/`Set` 用 SameValueZero（≈ `===`，但 `NaN` 等于自己）：

```ts
const m = new Map<{ id: number }, string>();
m.set({ id: 1 }, 'first');
m.get({ id: 1 });                // undefined 😱 不同对象 = 不同键，Java 直觉完全失效
const key = { id: 1 };
m.set(key, 'ok'); m.get(key);     // 'ok' ✅ 必须拿着同一个引用来取

new Set([[1], [1]]).size;        // 2 😱 两个不同数组
new Set(['a', 'a']).size;        // 1 ✅ 原始值按值比
new Set([NaN, NaN]).size;        // 1 ✅ SameValueZero 下 NaN 等于自己（0 和 -0 同理算一个）

// 解法：把复合键序列化成字符串（TS 生态的通用做法）
const cache = new Map<string, number>();
const cacheKey = (userId: number, day: string) => `${userId}|${day}`;   // ✅ 稳定、可读
cache.set(cacheKey(1, '2024-01-01'), 42);
// 分隔符要选字段里不会出现的字符，否则 ('a|b','c') 和 ('a','b|c') 会撞
```

> `WeakMap`/`WeakSet`：键只能是对象且**不阻止垃圾回收**，用来给外部对象挂私有元数据
> （不可迭代、没有 `size`）；日常业务基本用不到。

---

## 7. 解构 destructuring：本章最该练熟的语法

```ts
const [a, b] = [1, 2];                     // 数组解构（按位置）
const [first, , third] = [1, 2, 3];        // 逗号跳过中间的
const [head, ...rest] = [1, 2, 3];         // rest = [2,3]，一定是数组不会是 undefined
const [x = 10] = [];                       // 默认值（只在值为 undefined 时生效）
let p = 1, q = 2;
[p, q] = [q, p];                           // 交换变量，≈ Go 的 a, b = b, a

const user = { id: 1, name: 'ann', addr: { city: 'SH' } };
const { id, name } = user;                 // 对象解构（按属性名）
const { name: userName } = user;           // 重命名        const { addr: { city } } = user;  // 嵌套
const { id: theId, ...others } = user;     // rest：天然的"去掉某个字段"

// 函数参数解构 + 默认值（第 01 章的对象参数风格，本教程主力写法）
function connect({ host = 'localhost', port = 5432 }: { host?: string; port?: number } = {}) {}
connect();                                 // ✅ 参数整体可选，靠末尾的 = {}

for (const [i, v] of ['a', 'b'].entries()) console.log(i, v);      // 遍历时解构，最常见
for (const [k, v] of Object.entries({ a: 1 })) console.log(k, v);

// const { a } = null;                     // ❌ 解构 null/undefined 直接抛 TypeError
const { z } = maybeNull ?? {};             // ✅ 先兜底
const { timeout = 3000 } = { timeout: null } as { timeout?: number | null };
console.log(timeout);                      // null 😱 默认值只对 undefined 生效，对 null 不生效
```

---

## 8. 展开 spread 与拷贝

```ts
const arr = [1, 2, 3];
[...arr];                        // 浅拷贝（≈ new ArrayList<>(list)）
[...arr, ...[4, 5]];             // 拼接        [...new Set(arr)];  // ✅ 去重的标准写法
[...'ab👍'];                     // 字符串按【码点】展开

const base = { host: 'localhost', port: 80 };
const merged = { ...base, port: 8080 };                          // ✅ 后面覆盖前面（≈ putAll）
const opts = { ...base, ...(debug ? { verbose: true } : {}) };    // 条件加字段的地道写法

// spread 只拷一层，嵌套对象仍是同一个引用
const a1 = { db: { host: 'x' } };
const a2 = { ...a1 };
a2.db.host = 'changed';
a1.db.host;                      // 'changed' 😱 内层被共享
const deep = structuredClone(a1);          // ✅ Node 17+ 内置深拷贝，a1 不再受影响
```

对照：`new ArrayList<>(list)` → `[...list]`；`map.putAll(other)` → `{ ...map, ...other }`；
`obj.clone()`（浅）→ `{ ...obj }`；序列化深拷贝 → `structuredClone(obj)`
（不用再写 `JSON.parse(JSON.stringify(x))`）。

> `structuredClone` 能处理循环引用、`Date`、`Map`、`Set`，但**不能拷函数、`Symbol`、class 原型**
> （抛 `DataCloneError` 或退化成普通对象）。拷纯数据没问题，拷"带方法的对象"不行。

---

## 9. 不可变：编译期 vs 运行时是两套东西

TS 的 `readonly` **只在类型层面存在，编译完就没了**；Java 的 `List.of()` 是运行时真抛异常。

```ts
// ① 编译期：readonly 把所有 mutating 方法从类型上删掉
function totalOf(values: readonly number[]): number {
  // values.push(1); values.sort();   // ❌ 编译报错 —— 这正是我们要的保护
  return values.reduce((s, v) => s + v, 0);
}
type A = readonly string[];   // 等价 ReadonlyArray<string>；还有 ReadonlyMap / ReadonlySet
// ✅ 经验法则：只读取入参的函数，参数都写 readonly T[]（普通数组能传进来，反向不行）

// ② 编译期：as const —— 递归 readonly + 字面量类型
const LEVELS = ['debug', 'info', 'warn'] as const;
type Level = (typeof LEVELS)[number];      // 'debug' | 'info' | 'warn' ✅ 从值生成类型

// ③ 运行时：Object.freeze —— 真的改不了（ESM 默认严格模式，赋值抛 TypeError）
const config = Object.freeze({ port: 8080, db: { host: 'x' } });
// config.port = 1;                        // ❌ 编译期报错 + 运行时 TypeError
config.db.host = 'changed';                // 😱 freeze 也是浅的！内层没冻住
```

**`readonly` 防的是"团队写错代码"，`Object.freeze` 防的是"运行时真被改"。**
公共常量两个一起上，内部函数参数写 `readonly` 就够。

---

## 10. 迭代协议与生成器：TS 的惰性序列

只要对象有 `[Symbol.iterator]()` 就能用 `for...of`/spread/`Array.from`；数组、字符串、`Map`、`Set`
都可迭代（≈ Java 的 `Iterable`）。**生成器 `function*`** 是写迭代器最省事的方式，
`yield` 在这里暂停、下次 `next()` 继续。它对应 Java 的手写 `Iterator`、Go 的 `for range ch`，
但**没有并发**，只是"把函数暂停在中间"的语法糖（真并发见[第 06 章](./06-async.md)）。

```ts
function* idGenerator(start = 1): Generator<number, void, undefined> {
  let id = start;
  while (true) yield id++;         // 无限序列，惰性所以不会爆内存
}
const ids = idGenerator();
ids.next().value;                  // 1        ids.next().value;  // 2

// 惰性例子 ①：分块，只在需要时才切
function* chunks<T>(items: readonly T[], size: number): Generator<T[], void, undefined> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
for (const batch of chunks([1, 2, 3, 4, 5], 2)) console.log(batch);   // [1,2] [3,4] [5]

// 惰性例子 ②：分页拉取 —— 调用方 break 就不会再发下一个请求
async function* fetchPages(size = 100): AsyncGenerator<string[], void, undefined> {
  for (let page = 0; ; page++) {
    const rows = await queryDb(page, size);
    if (rows.length === 0) return;
    yield rows;
  }
}
// for await (const rows of fetchPages()) { ... }   // 见第 06 章

function take<T>(source: Iterable<T>, n: number): T[] {   // 截断无限序列 ≈ stream.limit(n)
  const out: T[] = [];
  for (const v of source) { if (out.length >= n) break; out.push(v); }
  return out;   // take(idGenerator(), 3) -> [1,2,3] ✅ 不会死循环
}
```

> 注意区分：**生成器惰性，数组方法不惰性**。`arr.map().filter()` 会生成两个完整中间数组。

---

## 11. JSON：坑最密集的地方

```ts
JSON.stringify({ a: 1 });              // '{"a":1}'      第三个参数是缩进
JSON.parse('{"a":1}');                 // 返回 any 😱

// 序列化时【静默丢失】的东西
JSON.stringify({ u: undefined, f: () => {}, s: Symbol('x'), d: new Date(0),
                 m: new Map([['a', 1]]), set: new Set([1]), n: NaN, inf: Infinity });
// '{"d":"1970-01-01T00:00:00.000Z","m":{},"set":{},"n":null,"inf":null}'
// undefined/函数/symbol 的键消失；Date 变字符串（parse 回来不是 Date）；
// Map/Set 变 {}；NaN/Infinity 变 null
JSON.stringify([undefined, () => {}]);      // '[null,null]'  ← 数组里变 null
const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
// JSON.stringify(cyclic);                  // ❌ TypeError: 循环引用
// JSON.stringify({ id: 1n });              // ❌ TypeError: 不知道怎么序列化 BigInt
JSON.parse('{"id": 9007199254740993}').id;  // 9007199254740992 😱 静默丢精度
// ↑ Java 后端的 Long 主键一定要序列化成字符串，JSON.parse 没法配置成 bigint

// replacer / reviver / 白名单
JSON.stringify({ m: new Map([['a', 1]]) }, (_k, v) =>
  v instanceof Map ? { __type: 'Map', entries: [...v] } : v);        // 定制序列化
JSON.parse('{"at":"2024-01-01T00:00:00.000Z"}', (_k, v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v);   // 还原 Date
JSON.stringify({ a: 1, secret: 'x' }, ['a']);                        // '{"a":1}' 白名单
```

**🔴 `JSON.parse` 返回 `any`，是类型系统里最大的洞：**

```ts
const data = JSON.parse(raw);               // any —— 后面你写什么编译器都不管
data.user.name.toUpperCase();               // 编译通过，运行时可能直接 TypeError 💥
const value: unknown = JSON.parse(raw);     // ✅ 先当 unknown + 手写守卫（练习 3.11）
// const user = UserSchema.parse(JSON.parse(raw));   // ✅ 姿势二：zod，见第 07 章
```

> **铁律：来自网络/文件/环境变量的 JSON，一律先按 `unknown` 处理。**
> [第 07 章](./07-errors-and-validation.md)会把这件事系统化。

---

## 12. Java Stream → TypeScript 写法对照

```ts
// ① 分组 Collectors.groupingBy
function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, [item]);   // ✅ 先 get 再判，比 has+get 快一半
    else bucket.push(item);
  }
  return out;
}

// ② 去重 distinct
[...new Set(nums)];                                  // 原始值一行搞定
function uniqueBy<T, K>(items: readonly T[], keyOf: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((it) => { const k = keyOf(it); return seen.has(k) ? false : !!seen.add(k); });
}

// ③ 求和 / 平均 summingInt
const total = orders.reduce((sum, o) => sum + o.amount, 0);   // 初始值 0 别省
const avg = orders.length === 0 ? 0 : total / orders.length;  // 先防除零

// ④ TopN sorted(...).limit(n)
const top3 = [...counts.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);

// ⑤ 拼接 Collectors.joining / ⑥ 综合链：filter -> sorted -> limit -> joining
users.map((u) => u.name).join(', ');
const report = orders.filter((o) => o.amount > 100).toSorted((a, b) => b.amount - a.amount)
  .slice(0, 10).map((o) => `${o.id}:${o.amount}`).join(',');
```

> 和 Stream 的唯一实质差别：**TS 链式调用每一步都生成完整中间数组**（不惰性）。
> 百万级数据要省内存就用第 10 节的生成器手写管道；日常几千条随便链。

---

## 本章练习

```bash
# 1. 打开 exercises/ch03-data-structures.ts，把所有 TODO 填掉
pnpm test tests/ch03      # 2. 跑测试
pnpm vitest tests/ch03    # 3. watch 模式；卡住了看 solutions/ch03-data-structures.ts
```

练习覆盖：不可变去重、`chunk`、多字段排序（`localeCompare` + 不改入参）、元组多返回值、
`Map` 计数 + TopN、`groupBy` 返回 `Map`、递归扁平化、`Set` 求交集/差集、`Object.entries` 统计、
深合并 + 防原型污染、`JSON.parse` 安全解析、生成器实现惰性滑动窗口。

---

**下一章** → [04 · 函数与面向对象：闭包、`this` 和"可选的" class](./04-functions-and-oop.md)
