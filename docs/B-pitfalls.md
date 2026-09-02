# B · 后端工程师最容易踩的 28 个坑

> 每条的格式：**症状 → 原因 → 正确写法**。
> 建议在写完前几章后通读一遍，然后在真的踩到时回来查。

---

## 一、类型与运行时的边界

### 坑 1 · 以为类型能在运行时保护你

```ts
const data = JSON.parse(raw) as User;   // ❌ 编译通过，运行时可能是任何东西
console.log(data.name.toUpperCase());   // 💥 TypeError: Cannot read properties of undefined
```

**原因**：`as` 是纯编译期断言，**不产生任何运行时代码**（和 Java 的 cast 完全不同，Java 的 cast 会 `ClassCastException`）。

**正确**：所有外部数据（HTTP、文件、环境变量、CLI 参数、LLM 输出）必须运行时校验。

```ts
const data = UserSchema.parse(JSON.parse(raw)); // ✅ zod 校验，失败即抛
```

---

### 坑 2 · 用 `as` 消灭报错

```ts
const cfg = {} as Config;      // ❌ 骗过编译器，把炸弹留到运行时
```

**正确**：`as` 只在你确实比编译器知道更多时用（例如刚校验过）。日常应该改类型或补校验。
需要临时忽略时用 `// @ts-expect-error`（比 `@ts-ignore` 好：如果错误消失了它会报错提醒你删掉）。

---

### 坑 3 · `any` 会传染

```ts
const raw: any = JSON.parse(s);
const port = raw.server.port;   // port 也是 any，后面全线失去保护
```

**正确**：外部数据一律先落到 **`unknown`**，逼自己校验后再用。
`unknown` 是"我不知道"，`any` 是"我不想让你检查"。

---

## 二、空值与真假值

### 坑 4 · `||` 吃掉了合法的 `0` / `''` / `false`

```ts
const port = opts.port || 8080;      // ❌ opts.port === 0 时变成 8080
const retries = opts.retries || 3;   // ❌ 显式传 0 次重试失效
const name = opts.name || 'anon';    // ❌ 传空串时被替换
```

**正确**：默认写 `??`，它只对 `null` / `undefined` 生效。

---

### 坑 5 · `if (!count)` 把 0 当成"没传"

```ts
function f(count?: number) {
  if (!count) return 'none';    // ❌ count = 0 走这里
}
```

**正确**：`if (count == null) return 'none';`

---

### 坑 6 · `if (arr)` 判断不了空数组

```ts
if (list) doSomething();                 // ❌ 空数组 [] 是【真值】
if (Object.keys(obj).length) ...         // ✅ 对象非空
if (list.length > 0) doSomething();      // ✅
```

---

### 坑 7 · `null` 和 `undefined` 混用导致判断遗漏

```ts
if (x !== undefined) { ... }   // ❌ x === null 时也会进来
if (x != null) { ... }         // ✅ 一次挡住两个
```

**约定**：自己的代码只用 `undefined`，`null` 只允许出现在外部数据边界。

---

### 坑 8 · `JSON.stringify` 悄悄丢字段

```ts
JSON.stringify({ a: undefined, b: () => {}, c: new Map([[1, 2]]), d: 1n });
// '{"c":{}}'  —— undefined 和函数被删，Map 变成空对象，bigint 直接抛错
```

**正确**：序列化前把数据转成纯 JSON 结构（`Object.fromEntries(map)`、`Number(bigint)` 或字符串）。

---

## 三、数字

### 坑 9 · 整数除法

```ts
const pages = total / pageSize;             // ❌ 3.5
const pages2 = Math.ceil(total / pageSize); // ✅ 分页要向上取整
const half = Math.trunc(n / 2);             // ✅ 等价 Java 的 n / 2
```

---

### 坑 10 · 后端返回的 Long 主键精度丢失

```ts
JSON.parse('{"id": 9007199254740993}').id;  // 9007199254740992 😱 静默错了一位
```

**正确**：让服务端把 64 位 ID 序列化为**字符串**。这是 Java 后端 + TS 客户端最经典的线上事故。

---

### 坑 11 · 除零不抛异常

```ts
const rate = ok / total;             // total = 0 时得到 NaN 或 Infinity，一路传下去
if (!Number.isFinite(rate)) ...      // ✅ 显式检查
```

---

### 坑 12 · `Number('')` 是 0

```ts
Number('');          // 0    😱
Number(null);        // 0    😱
Number('  ');        // 0    😱
parseInt('12abc');   // 12   😱
```

**正确**：用 `z.coerce.number()` 或自己写严格解析（见第 01 章练习 1.2）。

---

## 四、数组与对象

### 坑 13 · `sort()` 默认按字符串排

```ts
[10, 9, 1].sort();                  // [1, 10, 9] 😱
[10, 9, 1].sort((a, b) => a - b);   // [1, 9, 10] ✅
```

---

### 坑 14 · `sort` / `reverse` 原地修改原数组

```ts
function topN(list: number[], n: number) {
  return list.sort((a, b) => b - a).slice(0, n);  // ❌ 把调用方的数组改了
}
return list.toSorted((a, b) => b - a).slice(0, n); // ✅ ES2023 不可变版本
```

同类原地方法：`push` `pop` `shift` `unshift` `splice` `fill` `copyWithin` `reverse` `sort`。

---

### 坑 15 · 数组越界返回 `undefined` 而不是抛异常

```ts
const first = list[0];        // 类型 T | undefined（开了 noUncheckedIndexedAccess）
first.trim();                 // ❌ 编译器会拦你，别用 ! 绕过
const first = list[0];
if (first != null) first.trim();   // ✅
const last = list.at(-1);          // ✅ 负数下标
```

---

### 坑 16 · 对象/数组扩展是**浅拷贝**

```ts
const copy = { ...config };        // 嵌套对象仍然是同一个引用
copy.db.host = 'x';                // 💥 原对象也被改了
const deep = structuredClone(config);  // ✅ 真深拷贝（Node 17+）
```

---

### 坑 17 · `Map` 用对象当键时按引用比较

```ts
const m = new Map<{ id: number }, string>();
m.set({ id: 1 }, 'a');
m.get({ id: 1 });      // undefined 😱 不同引用
```

**原因**：JS 没有 `hashCode`/`equals` 协议。
**正确**：用可序列化的原始值当键（`m.set(user.id, ...)` 或 `` `${a}:${b}` ``）。

---

### 坑 18 · 用 `for...in` 遍历数组

```ts
for (const i in ['a', 'b']) console.log(i);  // '0' '1' —— 字符串！还会带上继承属性
for (const v of ['a', 'b']) console.log(v);  // ✅ 拿值
for (const [i, v] of arr.entries()) ...      // ✅ 拿下标+值
```

---

## 五、函数与 `this`

### 坑 19 · 方法作为回调传出去后 `this` 丢了

```ts
class Service {
  private name = 'svc';
  run() { console.log(this.name); }
}
const s = new Service();
setTimeout(s.run, 0);        // 💥 this 是 undefined
setTimeout(() => s.run(), 0);// ✅
setTimeout(s.run.bind(s), 0);// ✅
class Service2 { run = () => { ... } }  // ✅ 类字段箭头函数，永久绑定
```

---

### 坑 20 · 箭头函数当对象方法用

```ts
const obj = {
  name: 'x',
  greet: () => `hi ${this.name}`,   // ❌ 箭头函数没有自己的 this
  greet2() { return `hi ${this.name}`; },  // ✅ 简写方法
};
```

---

### 坑 21 · 返回对象字面量忘了加括号

```ts
const make = (id: number) => { id };     // ❌ 这是函数体 + 一个表达式语句，返回 undefined
const make2 = (id: number) => ({ id });  // ✅
```

---

## 六、异步

### 坑 22 · 忘了 `await`

```ts
const user = getUser(id);          // ❌ user 是 Promise<User>
if (user) { }                      // Promise 永远是真值
console.log(user.name);            // undefined
```

**防御**：开 ESLint 的 `@typescript-eslint/no-floating-promises` 和 `no-misused-promises`。

---

### 坑 23 · 在 `forEach` / `map` 里 `await`

```ts
list.forEach(async (x) => { await save(x); });  // ❌ 不会等待，函数早就返回了
console.log('done');                            // 先打印

for (const x of list) await save(x);            // ✅ 串行
await Promise.all(list.map((x) => save(x)));    // ✅ 全并发
await mapConcurrent(list, 5, save);             // ✅ 并发上限 5（见第 06 章）
```

---

### 坑 24 · `try/catch` 包不住没 `await` 的 Promise

```ts
try {
  doAsync();          // ❌ 没 await，异常逃出 try
} catch { }

try {
  await doAsync();    // ✅
} catch { }
```

---

### 坑 25 · `Promise.all` 里一个失败，其它任务**不会被取消**

Go 的 `errgroup` 会通过 context 取消兄弟任务，`Promise.all` 不会 —— 它只是提前 reject，
其它请求仍在后台跑完（可能继续消耗配额、继续写数据库）。

**正确**：需要真取消时配一个 `AbortController`，把 signal 传进每个任务。

---

### 坑 26 · 以为单线程就没有竞态

```ts
// 两个并发调用可能都读到 count = 0
const cur = await store.get('count');
await store.set('count', cur + 1);   // 💥 丢更新
```

单线程消除了**数据竞争**，但 `await` 之间会让出控制权，**逻辑竞态依然存在**。
**正确**：串行化（队列）、原子操作，或乐观锁。

---

## 七、模块与工程

### 坑 27 · ESM 里相对导入必须带扩展名，而且要写 `.js`

```ts
import { helper } from './helper';       // ❌ ERR_MODULE_NOT_FOUND
import { helper } from './helper.ts';    // ❌ 默认不允许
import { helper } from './helper.js';    // ✅ 源文件是 helper.ts，但这里写 .js
```

**原因**：`tsc` 不改写导入路径，写的是**编译产物**的路径。
（`tsx` / `vitest` 下不带扩展名也能跑，但 `tsc --noEmit` 会报错 —— 以 tsc 为准。）

---

### 坑 28 · ESM 里没有 `__dirname` / `require`

```ts
// ❌ __dirname is not defined
const p = path.join(__dirname, 'config.json');

// ✅ Node 20.11+
const p = path.join(import.meta.dirname, 'config.json');

// ✅ 通用写法
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
```

---

## 附加：几个"不是坑但很容易写丑"的地方

| 习惯 | 更地道的 TS |
| --- | --- |
| 到处写显式类型 | 参数/返回值写，局部变量靠推断 |
| 用 `enum` | 用 `as const` 对象 + 联合字面量类型 |
| 什么都做成 class | 纯函数 + 接口 + 普通对象，class 留给有状态的服务 |
| `interface` 一份 + zod schema 一份 | 只写 zod schema，用 `z.infer` 导出类型 |
| 手写 `if (typeof x === 'object' && x !== null && 'a' in x)` | zod / 类型守卫函数 |
| 用异常表达可预期的失败 | CLI 参数、批量处理用 `Result` 类型 |
| `console.log` 打日志 | 数据 → stdout，日志 → stderr |
| `process.exit(1)` | `process.exitCode = 1`，让缓冲区 flush 完再退出 |

---

**返回** → [README 目录](../README.md) ｜ [A · 速查表](./A-cheatsheet.md)
