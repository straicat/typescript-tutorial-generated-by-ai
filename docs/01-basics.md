# 01 · 基础语法：先看和 Java / Go 不一样的地方

> 本章目标：把「写得出能跑的代码」这一步过掉。凡是和 Java/Go 一模一样的东西（`if`、
> `for`、`while`、`+ - * /`、`&& || !`）本章一律跳过，只讲**会让你踩坑**的差异。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 数字类型 | `int/long/float/double` | **只有一个 `number`**（IEEE 754 双精度） | 🔴 高 |
| 空值 | 只有 `null` / `nil` | **`null` 和 `undefined` 两个** | 🔴 高 |
| 相等判断 | `==` / `.equals()` | `===`（`==` 会隐式转换，别用） | 🔴 高 |
| 条件判断 | 必须是 boolean | 任何值都能当条件，`0` 和 `''` 是**假值** | 🔴 高 |
| 遍历数组 | `for (x : arr)` / `for i, v := range` | `for...of` 拿值，`for...in` 拿**键**（字符串！） | 🔴 高 |
| 方法重载 | 支持 | **不支持**（只能一个实现 + 联合类型/可选参数） | 🟡 中 |
| 命名参数 | 无（用 Builder） | 无，但**约定用对象字面量参数** | 🟡 中 |
| 字符类型 | `char` / `rune` | **没有**，单字符就是长度 1 的 string | 🟡 中 |
| 字符串长度 | Java UTF-16 / Go 字节 | UTF-16 码元数，emoji 算 2 | 🟡 中 |
| 声明 | `int x = 1;` / `x := 1` | `const x = 1` / `let x = 1`（**永远别用 `var`**） | 🟢 低 |
| 类型标注位置 | `int x` | `x: number`（后置，像 Go 但带冒号） | 🟢 低 |
| 分号 | 必须 | 可选（但建议统一加，靠 formatter 管） | 🟢 低 |

---

## 1. 变量声明：只用 `const` 和 `let`

```ts
const port = 8080;        // 不可重新赋值（≈ Java 的 final，Go 没有对应物）
let retries = 0;          // 可重新赋值
// var oldStyle = 1;      // ❌ 永远不要用：函数作用域 + 变量提升，纯历史包袱
```

**关键区别：`const` 保护的是「绑定」，不是「值」。** 这点和 Java 的 `final` 完全一致，
但新手最容易搞错：

```ts
const config = { host: 'localhost', port: 8080 };
config.port = 9090;       // ✅ 合法！对象内容可以改
// config = {};           // ❌ 报错：不能重新赋值

const list = [1, 2, 3];
list.push(4);             // ✅ 合法
```

> 想要真正的不可变，需要 `readonly` / `as const`，见 [第 03 章](./03-data-structures.md)。

**类型标注是可选的**，TS 的类型推断非常强，能推出来就别写：

```ts
const name = 'ts';                    // 推断为 string（其实是字面量类型 'ts'）
let count = 0;                        // 推断为 number
const users: string[] = [];           // ✅ 空数组必须标注，否则推成 never[]
const timeout: number | null = null;  // ✅ 想让它以后能赋别的值，需要标注
```

**经验法则**：函数的**参数和返回值**写类型（等于文档 + 边界检查），
函数**内部的局部变量**基本靠推断。这和 Go 的 `x := ...` 习惯是一样的。

---

## 2. `number`：只有一个数字类型，坑最多

TS/JS **没有** `int`、`long`、`float`、`double`，只有 `number`，底层是 IEEE 754 双精度浮点。

```ts
const a = 42;        // number
const b = 42.5;      // number
const c = 0xff;      // 255
const d = 1_000_000; // 数字分隔符，和 Java 一样
```

### 坑 1：整数除法不存在

```ts
console.log(7 / 2);              // 3.5   ← Java/Go 里是 3！
console.log(Math.trunc(7 / 2));  // 3     ← 想要整除用这个
console.log(Math.floor(-7 / 2)); // -4    ← 注意负数：floor 向下取整
console.log(Math.trunc(-7 / 2)); // -3    ← trunc 向零取整（和 Java/Go 的 / 一致）
```

### 坑 2：安全整数只有 53 位

```ts
console.log(Number.MAX_SAFE_INTEGER);      // 9007199254740991  (2^53 - 1)
console.log(9007199254740992 === 9007199254740993); // true 😱 精度丢了

// 需要 64 位整数（雪花 ID、数据库 bigint 主键）用 bigint：
const big = 9007199254740993n;             // 注意后缀 n
console.log(big + 1n);                     // 9007199254740994n
// console.log(big + 1);                   // ❌ 报错：bigint 不能和 number 混算
```

> **实战提醒**：后端返回 Java `Long` 类型的 ID 时，`JSON.parse` 会静默丢精度。
> 标准做法是**让后端把 ID 序列化成字符串**。这是 Java 后端 + TS 前端/CLI 最经典的线上事故。

### 坑 3：浮点误差 + 除零不抛异常

```ts
console.log(0.1 + 0.2);          // 0.30000000000000004（和 Java double 一样）
console.log(0.1 + 0.2 === 0.3);  // false

console.log(1 / 0);              // Infinity   ← Java 的 int 除零会抛 ArithmeticException
console.log(-1 / 0);             // -Infinity
console.log(0 / 0);              // NaN        ← 不抛异常！
console.log(NaN === NaN);        // false 😱
console.log(Number.isNaN(0 / 0)); // true      ← 判断 NaN 只能用这个
console.log(Number.isFinite(1 / 0)); // false  ← 判断"是个正常数字"
```

**所以：任何做除法/解析的函数，都要显式检查 `Number.isFinite(result)`。**

### 坑 4：字符串转数字有三种方式，行为都不同

```ts
Number('42');      // 42
Number('42abc');   // NaN     ← 严格
Number('');        // 0       😱 空串变 0
Number(' 42 ');    // 42      （忽略首尾空白）
Number(null);      // 0       😱
Number(undefined); // NaN

parseInt('42abc'); // 42      ← 宽松，读到非法字符就停
parseInt('abc');   // NaN
parseInt('0x1f');  // 31      （自动识别十六进制）
parseFloat('3.9m');// 3.9

// 想要 Java 的 Integer.parseInt 那种"严格解析"，得自己写：
function parseIntStrict(s: string): number | null {
  if (!/^[+-]?\d+$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
```

> 实际项目里这类解析交给 `zod`（[第 07 章](./07-errors-and-validation.md)），不用手写。

---

## 3. `string`：没有 `char`，注意 UTF-16

```ts
const s = 'single';           // 单引号、双引号完全等价，团队统一即可
const t = `模板字符串: ${1 + 1}`;   // 反引号，等价于 Java 的 String.format / Go 的 Sprintf
const multi = `第一行
第二行`;                       // 反引号天然支持多行（≈ Java 15 的 """ 文本块）
```

**没有 `char` / `rune` 类型**：

```ts
const first = 'hello'[0];     // 'h'，类型是 string（在本项目开了 noUncheckedIndexedAccess，
                              // 实际类型是 string | undefined，见第 03 章）
```

**`.length` 是 UTF-16 码元数，不是字符数**（和 Java 的 `String.length()` 一样的坑，
但比 Go 的字节数直观一点）：

```ts
'héllo'.length;      // 5
'👍'.length;          // 2 😱  一个 emoji 占两个码元
[...'👍'].length;     // 1 ✅  展开成码点数组（≈ Go 的 for range 按 rune）
Array.from('a👍b').length; // 3 ✅
```

**Java → TS 常用方法对照**：

| Java | TypeScript |
| --- | --- |
| `s.isEmpty()` | `s.length === 0` |
| `s.isBlank()` | `s.trim().length === 0` |
| `s.equals(t)` | `s === t`（字符串是值语义，直接比！） |
| `s.equalsIgnoreCase(t)` | `s.toLowerCase() === t.toLowerCase()` |
| `s.contains(t)` | `s.includes(t)` |
| `s.indexOf(t)` | `s.indexOf(t)` |
| `s.substring(a, b)` | `s.slice(a, b)`（推荐；`substring` 也有但对负数行为不同） |
| `s.replace(a, b)` | `s.replaceAll(a, b)`（`replace` **只换第一个**！） |
| `s.split(",")` | `s.split(',')` |
| `String.join(",", list)` | `list.join(',')` |
| `s.strip()` | `s.trim()` |
| `s.repeat(3)` | `s.repeat(3)` |
| `String.format("%s", x)` | `` `${x}` `` |
| `s.startsWith(p)` | `s.startsWith(p)` |
| `s.chars()` | `[...s]` |

> ⚠️ 最容易踩的：**`replace` 只替换第一个匹配**，要全部替换用 `replaceAll`。

字符串和 Java 一样**不可变**，所有方法都返回新串。

---

## 4. `null` vs `undefined`：TS 独有的双空值

这是 Java/Go 开发者最不习惯的一点。**两个都表示"没有值"，但语义不同**：

| | 含义 | 典型来源 |
| --- | --- | --- |
| `undefined` | "**从来没有赋过值**" | 未初始化变量、缺失的对象属性、越界数组下标、无 `return` 的函数 |
| `null` | "**显式地表示空**" | 你自己写的 `= null`、`JSON.parse('null')`、数据库 NULL |

```ts
let x;                        // undefined
const obj: { a?: number } = {};
obj.a;                        // undefined（属性不存在）
[1, 2, 3][99];                // undefined（越界不抛异常！Java 会 IndexOutOfBounds）
function noReturn() {}
noReturn();                   // undefined

const y = null;               // null，你主动写的
JSON.stringify({ a: undefined, b: null }); // '{"b":null}' ← undefined 的键被丢掉了！
```

### 实践约定（业界主流）

1. **自己的代码统一只用 `undefined`** 表示"没有"，`null` 只在对接外部数据（JSON / 数据库）时出现。
2. **判空用 `== null`**——这是**唯一**推荐使用 `==` 的场合，因为它同时命中 `null` 和 `undefined`：

```ts
if (value == null) { /* value 是 null 或 undefined */ }
if (value != null) { /* value 一定有值 */ }
```

### 三个救命语法糖

```ts
// ① 可选链 ?. —— 相当于 Java 的 Optional 链式调用，但零成本
const city = user?.address?.city;          // 任一环是 null/undefined 就整体得 undefined
const name = user?.getName?.();            // 方法也能可选调用
const item = list?.[0];                    // 下标也能

// ② 空值合并 ?? —— 只在左边是 null/undefined 时取右边
const port = config.port ?? 8080;
// 对比 ||：|| 在左边是"假值"时取右边，会把 0 / '' / false 也吃掉！
const wrong = config.port || 8080;         // 😱 config.port = 0 时也会变成 8080

// ③ 空值合并赋值 ??=
config.timeout ??= 3000;                   // 只在 timeout 是 null/undefined 时赋值
```

> **`??` vs `||` 是面试和线上事故的双料常客。默认写 `??`。**

---

## 5. 真值 / 假值：`if` 里能放任何东西

Java 的 `if` 必须是 `boolean`，Go 也一样。TS 里任何值都行，按下表转换：

**只有这 8 个是「假值」(falsy)，其余全是真值：**

```
false   0   -0   0n   ''   null   undefined   NaN
```

```ts
if ('') console.log('不会执行');
if ('0') console.log('会执行！非空字符串都是真值');
if ([]) console.log('会执行！空数组是真值 😱');
if ({}) console.log('会执行！空对象是真值 😱');
```

**新手最常见的 bug**：

```ts
function greet(count?: number) {
  if (!count) return '没传';   // 😱 count = 0 时也走这里
  return `${count} 次`;
}

// ✅ 正确写法
function greetFixed(count?: number) {
  if (count == null) return '没传';
  return `${count} 次`;
}
```

判断数组/对象是否为空，**必须显式写**：

```ts
if (arr.length === 0) { /* 空数组 */ }
if (Object.keys(obj).length === 0) { /* 空对象 */ }
```

---

## 6. `===` vs `==`

```ts
1 === '1';        // false ✅ 严格：类型不同直接 false
1 == '1';         // true  😱 会隐式转换
0 == '';          // true  😱
0 == false;       // true  😱
null == undefined; // true  ← 唯一有用的一条
null === undefined; // false

// 对象比较的是引用（和 Java 的 == 一样）
{ a: 1 } === { a: 1 };  // false
[1] === [1];            // false
```

**规则：永远用 `===` / `!==`，唯一例外是 `x == null`。**

深比较（相当于 Java 的 `equals`）没有内置的，用：

```ts
// Node 内置
import { isDeepStrictEqual } from 'node:util';
isDeepStrictEqual({ a: 1 }, { a: 1 });   // true

// 测试里直接用 vitest 的 toEqual
expect({ a: 1 }).toEqual({ a: 1 });
```

---

## 7. 运行时类型判断：`typeof` / `instanceof`

```ts
typeof 42;           // 'number'
typeof 'x';          // 'string'
typeof true;         // 'boolean'
typeof undefined;    // 'undefined'
typeof 10n;          // 'bigint'
typeof Symbol();     // 'symbol'
typeof (() => {});   // 'function'
typeof {};           // 'object'
typeof [];           // 'object'  😱 数组也是 object
typeof null;         // 'object'  😱 史上最著名的 JS bug，改不了了

// 判断数组
Array.isArray([]);   // true ✅ 唯一正确方式

// 判断 class 实例（和 Java 的 instanceof 一致）
class HttpError extends Error {}
new HttpError() instanceof Error;  // true
```

一个通用的运行时类型判断函数：

```ts
function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;   // 'object' | 'string' | 'number' | ...
}
```

> 注意：**`typeof` 只能判断 8 种基础类型**。要判断"这个对象是不是 `User` 形状"，
> 靠 `typeof` 是做不到的（类型在运行时不存在），必须用 `zod`
> 或手写类型守卫，见 [第 07 章](./07-errors-and-validation.md)。

---

## 8. 控制流：`for...of` 和 `for...in` 是两码事

```ts
const arr = ['a', 'b', 'c'];

// ✅ for...of：拿【值】，≈ Java 的 for(String x : arr) / Go 的 for _, v := range
for (const v of arr) console.log(v);            // a b c

// 😱 for...in：拿【键】，而且是【字符串】，还会遍历继承来的属性
for (const i in arr) console.log(i, typeof i);  // '0' string, '1' string, '2' string

// ✅ 要下标 + 值：
for (const [i, v] of arr.entries()) console.log(i, v);   // 0 'a' ...

// ✅ 传统 for 也在
for (let i = 0; i < arr.length; i++) console.log(i, arr[i]);

// ✅ 遍历对象（for...in 唯一还算合理的场景，但更推荐下面这些）
const obj = { a: 1, b: 2 };
for (const key of Object.keys(obj)) console.log(key);
for (const [k, v] of Object.entries(obj)) console.log(k, v);
```

**记住：数组用 `for...of`，对象用 `Object.entries()`，`for...in` 基本可以忘掉。**

### `switch`：有 fallthrough（像 Java，不像 Go）

```ts
switch (cmd) {
  case 'start':
  case 'run':                  // 多个 case 合并靠 fallthrough
    doStart();
    break;                     // ⚠️ 别忘了 break！Go 里默认 break，这里不是
  case 'stop':
    doStop();
    break;
  default:
    throw new Error(`unknown: ${cmd}`);
}
```

> 本项目 tsconfig 开了 `noFallthroughCasesInSwitch`，忘写 `break` 编译器会提醒你。
> 另外，配合联合类型和 `never`，TS 能做**穷尽性检查**（比 Java 的 enum switch 更强），
> 见 [第 02 章](./02-type-system.md)。

### 循环控制

```ts
outer: for (const a of xs) {          // 标签，和 Java/Go 一样
  for (const b of ys) {
    if (a === b) continue outer;
    if (a > b) break outer;
  }
}
```

---

## 9. 函数：三种写法，没有重载，用对象传参

### 三种定义方式

```ts
// ① 函数声明（会提升，可以在定义前调用）
function add(a: number, b: number): number {
  return a + b;
}

// ② 函数表达式赋给 const
const sub = function (a: number, b: number): number {
  return a - b;
};

// ③ 箭头函数（最常用；表达式体自动 return）
const mul = (a: number, b: number): number => a * b;
const noop = (): void => {};
const makeObj = (id: number) => ({ id });   // ⚠️ 返回对象字面量要加括号！
```

> `=>` 和 Java 的 lambda 很像，但有个**关键区别**：箭头函数不绑定自己的 `this`，
> 这恰好是它最有用的性质，见 [第 04 章](./04-functions-and-oop.md)。

### 参数：默认值、可选、剩余

```ts
// 默认值（Java 没有，Go 也没有！）
function retry(times = 3, delayMs = 100): void {}
retry();          // 3, 100
retry(5);         // 5, 100

// 可选参数 ?（类型自动变成 T | undefined）
function log(msg: string, prefix?: string): void {
  console.log(`${prefix ?? '[info]'} ${msg}`);
}

// 剩余参数（≈ Java 的 String... / Go 的 ...string）
function sum(...nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}
sum(1, 2, 3);
const list = [1, 2, 3];
sum(...list);     // 展开，≈ Go 的 sum(list...)
```

⚠️ **可选参数必须放在必填参数后面**（和 Java 的 varargs 规则类似）。

### 没有方法重载 —— 这是最需要改变习惯的地方

Java 里你会这样：

```java
// Java
public String format(int x) { ... }
public String format(Date x) { ... }
public String format(int x, Locale l) { ... }
```

TS 里**一个名字只能有一个实现**。三种替代方案：

```ts
// 方案 A：联合类型 + 收窄（最常用）
function format(x: number | Date): string {
  if (typeof x === 'number') return x.toFixed(2);
  return x.toISOString();
}

// 方案 B：可选参数 / 默认值
function format2(x: number, digits = 2): string {
  return x.toFixed(digits);
}

// 方案 C：重载签名（只是给调用方更精确的类型，实现仍然只有一个）
function parse(input: string): object;
function parse(input: string, raw: true): string;
function parse(input: string, raw?: boolean): object | string {
  return raw === true ? input : (JSON.parse(input) as object);
}
```

### 没有命名参数 —— 用「对象参数 + 解构」

Java 里参数多了你会写 Builder，Go 里会写 Options struct 或 functional options。
TS 的惯用法是**直接传一个对象字面量**，可读性最好：

```ts
interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  retries?: number;
}

// 解构 + 默认值一起写，非常常见
function request({ url, method = 'GET', timeoutMs = 5000, retries = 0 }: RequestOptions): void {
  console.log(url, method, timeoutMs, retries);
}

request({ url: '/api', method: 'POST' });   // 调用处自带"参数名"，无需 Builder
```

**这是本教程后面所有代码的主力风格，务必习惯它。**

### 返回值：`void` / `undefined` / `never`

```ts
function a(): void {}          // 不关心返回值
function b(): undefined { return undefined; }
function c(): never {          // 永远不正常返回：一定抛异常或死循环
  throw new Error('boom');
}
```

`never` 在类型系统里非常有用（穷尽性检查），[第 02 章](./02-type-system.md)细讲。

---

## 10. 输出与退出码（CLI 必备）

```ts
console.log('普通输出');          // → stdout
console.error('错误输出');        // → stderr（重要：日志走 stderr，数据走 stdout）
console.warn('警告');            // → stderr
console.table([{ a: 1 }]);       // 表格，调试很好用
console.dir(obj, { depth: null }); // 打印深层嵌套对象

// 不带换行（进度条、流式输出）
process.stdout.write('loading...');

// 退出码（≈ Java System.exit / Go os.Exit）
process.exitCode = 1;    // ✅ 推荐：等事件循环跑完再退出，不会截断输出
process.exit(1);         // ⚠️ 立即退出，可能丢掉还没 flush 的输出
```

> **CLI 铁律**：程序的「结果」写 stdout，「日志/进度」写 stderr。
> 这样 `mytool | jq` 才能正常工作。第 08 章会反复用到。

---

## 11. 一个完整的小例子

把本章内容串起来（可以直接 `pnpm ex docs/snippets/ch01-demo.ts` 运行）：

```ts
interface ParseResult {
  ok: boolean;
  value?: number;
  reason?: string;
}

function parseNumberArg(raw: string | undefined, fallback?: number): ParseResult {
  if (raw == null || raw.trim() === '') {
    return fallback == null
      ? { ok: false, reason: '缺少参数且无默认值' }
      : { ok: true, value: fallback };
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: `不是合法数字: ${raw}` };
  }
  return { ok: true, value: n };
}

for (const input of ['42', '', '  ', 'abc', '1e3']) {
  const r = parseNumberArg(input, 10);
  console.log(JSON.stringify(input), '=>', r.ok ? r.value : `失败(${r.reason})`);
}
```

---

## 本章练习

```bash
# 1. 打开 exercises/ch01-basics.ts，把所有 TODO 填掉
# 2. 跑测试
pnpm test tests/ch01

# 3. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch01

# 4. 卡住了看 solutions/ch01-basics.ts
```

练习覆盖：`number` 陷阱、严格解析、`null`/`undefined` 处理、`??` vs `||`、
falsy 判断、码点计数、对象参数 + 默认值、`for...of`。

---

**下一章** → [02 · 类型系统：结构化类型才是 TS 的灵魂](./02-type-system.md)
