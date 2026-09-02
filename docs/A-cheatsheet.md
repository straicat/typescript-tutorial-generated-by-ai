# A · Java / Go → TypeScript 速查表

> 建议打印或双屏常开。左边是你已经会的，右边是对应写法。

---

## 1. 声明与基础类型

| Java / Go | TypeScript |
| --- | --- |
| `final int x = 1;` / `const` 无 | `const x = 1;` |
| `int x = 1;` / `x := 1` | `let x = 1;` |
| `int` `long` `short` `byte` `float` `double` | **全部是 `number`** |
| `BigInteger` / `int64` 溢出场景 | `bigint`（字面量后缀 `n`） |
| `boolean` / `bool` | `boolean` |
| `String` / `string` | `string` |
| `char` / `rune` | **没有**，用长度 1 的 `string` |
| `Object` / `interface{}` / `any` | `unknown`（安全）/ `any`（放弃类型检查） |
| `void` | `void` |
| `null` / `nil` | `null` **和** `undefined`（两个！） |
| `Optional<T>` / `*T` | `T \| undefined` 或 `T \| null` |
| `var` (Java 10 推断) / `:=` | 省略类型标注即可 |
| `enum Color { RED }` | `type Color = 'red' \| 'green'`（首选）或 `enum`（少用） |
| `int[]` / `List<T>` / `[]T` | `T[]` 或 `Array<T>` |
| `Map<K,V>` / `map[K]V` | `Map<K,V>`（或 `Record<string,V>` 当纯字符串键） |
| `Set<T>` | `Set<T>` |
| `Pair<A,B>` / `(A, B)` 多返回值 | 元组 `[A, B]` |
| `record Point(int x, int y)` / `struct` | `interface Point { x: number; y: number }` |
| `1_000_000` | `1_000_000`（一样） |

---

## 2. 运算与判断

| Java / Go | TypeScript |
| --- | --- |
| `a.equals(b)`（字符串） | `a === b` |
| `a == b`（对象引用） | `a === b` |
| `Objects.equals(a, b)` 深比较 | `isDeepStrictEqual(a, b)`（`node:util`）/ 测试里 `toEqual` |
| `7 / 2` → `3` | `Math.trunc(7 / 2)`（`7 / 2` 是 `3.5`！） |
| `7 % 2` | `7 % 2`（负数行为同 Java，是余数不是模） |
| `Math.pow(a, b)` | `a ** b` |
| `x == null` | `x == null`（唯一推荐用 `==` 的场合） |
| `Optional.ofNullable(x).map(...)` | `x?.foo?.bar` |
| `Optional.orElse(d)` / `if x == nil { x = d }` | `x ?? d`（**不要用 `\|\|`**） |
| `if (list != null && !list.isEmpty())` | `if (list?.length)`（注意 0 是假值，语义正好） |
| `a instanceof B` | `a instanceof B`（只对 class 有效） |
| `x.getClass().getName()` | `typeof x` / `x.constructor.name`（类型信息运行时已擦除） |
| 三目 `a ? b : c` | 一样 |
| `>>>` `&` `\|` `^` `~` | 一样（但操作数会转成 32 位整数！） |

---

## 3. 字符串

| Java | TypeScript |
| --- | --- |
| `String.format("%s-%d", a, b)` | `` `${a}-${b}` `` |
| `"""文本块"""` | 反引号多行字符串 |
| `s.length()` | `s.length` |
| `s.isBlank()` | `s.trim().length === 0` |
| `s.strip()` | `s.trim()` / `trimStart()` / `trimEnd()` |
| `s.contains(t)` | `s.includes(t)` |
| `s.substring(a, b)` | `s.slice(a, b)` |
| `s.charAt(i)` | `s[i]` / `s.at(i)`（`at` 支持负数下标） |
| `s.replace(a, b)`（全部） | **`s.replaceAll(a, b)`**（`replace` 只换第一个！） |
| `s.split(",")` | `s.split(',')` |
| `String.join(",", list)` | `list.join(',')` |
| `s.toUpperCase()` | `s.toUpperCase()` |
| `s.compareTo(t)` | `s.localeCompare(t)`（返回 -1/0/1） |
| `s.matches(re)` | `/^re$/.test(s)` |
| `Pattern`/`Matcher` | `RegExp` + `s.match()` / `s.matchAll()` |
| `s.repeat(3)` | `s.repeat(3)` |
| `sb.append(...)` | 直接 `+=` 或 `arr.push()` + `join('')` |
| `s.chars()` / Go `for range s` | `[...s]`（按码点） |

---

## 4. 集合操作：Java Stream / Go 循环 → TS 数组方法

| Java Stream | TypeScript |
| --- | --- |
| `list.stream().map(f).toList()` | `list.map(f)` |
| `.filter(p).toList()` | `list.filter(p)` |
| `.reduce(0, Integer::sum)` | `list.reduce((a, b) => a + b, 0)` |
| `.findFirst()` | `list.find(p)`（找不到返回 `undefined`） |
| `.anyMatch(p)` / `.allMatch(p)` / `.noneMatch(p)` | `list.some(p)` / `list.every(p)` / `!list.some(p)` |
| `.count()` | `list.length` / `list.filter(p).length` |
| `.sorted(cmp)` | `list.toSorted(cmp)`（不可变）/ `list.sort(cmp)`（**原地改**） |
| `.distinct()` | `[...new Set(list)]` |
| `.limit(n)` / `.skip(n)` | `list.slice(0, n)` / `list.slice(n)` |
| `.flatMap(f)` | `list.flatMap(f)` |
| `.collect(joining(","))` | `list.join(',')` |
| `.collect(groupingBy(f))` | `Map.groupBy(list, f)`（ES2024）或手写 reduce |
| `.collect(toMap(k, v))` | `new Map(list.map(x => [k(x), v(x)]))` |
| `.mapToInt(f).sum()` | `list.reduce((s, x) => s + f(x), 0)` |
| `.max(cmp)` | `Math.max(...nums)` 或 `list.reduce(...)` |
| `IntStream.range(0, n)` | `Array.from({ length: n }, (_, i) => i)` |
| `Collections.reverse(l)` | `list.toReversed()` / `list.reverse()`（原地） |
| `list.contains(x)` | `list.includes(x)` |
| `list.indexOf(x)` | `list.indexOf(x)` |
| `List.of(1,2)` 不可变 | `[1, 2] as const` / `readonly number[]`（仅编译期） |
| `map.getOrDefault(k, d)` | `map.get(k) ?? d` |
| `map.computeIfAbsent(k, f)` | `map.get(k) ?? (map.set(k, f(k)), map.get(k)!)` 或手写 helper |
| `map.forEach((k,v) -> ...)` | `for (const [k, v] of map) ...` |
| `map.keySet()` / `values()` / `entrySet()` | `map.keys()` / `map.values()` / `map.entries()` |

> ⚠️ `sort` / `reverse` / `splice` / `push` / `pop` / `shift` / `unshift` / `fill` **原地修改**；
> `toSorted` / `toReversed` / `toSpliced` / `with` / `map` / `filter` / `slice` / `concat` 返回新数组。

---

## 5. 函数

| Java / Go | TypeScript |
| --- | --- |
| `int f(int a) { return a; }` | `function f(a: number): number { return a; }` |
| `(a) -> a + 1` / `func(a int) int { ... }` | `(a: number) => a + 1` |
| `Function<A,B>` / `func(A) B` | `(a: A) => B` |
| `Supplier<T>` | `() => T` |
| `Consumer<T>` | `(x: T) => void` |
| `Predicate<T>` | `(x: T) => boolean` |
| `Runnable` | `() => void` |
| `String... args` / `...string` | `...args: string[]` |
| `f(list.toArray())` / `f(list...)` | `f(...list)` |
| 方法重载 | **不支持**，用联合类型 / 可选参数 / 重载签名 |
| Builder 模式 / Options struct | **对象参数 + 解构默认值** |
| 默认参数值（无） | `function f(x = 3)` |
| 静态方法 | 顶层导出函数（更常用）或 `static` |
| 泛型 `<T extends Comparable<T>>` | `<T extends { compare(o: T): number }>`（结构化约束） |

---

## 6. 类与接口

| Java | TypeScript |
| --- | --- |
| `class A implements B, C` | `class A implements B, C`（且**不写 implements 也算实现**） |
| `extends`（单继承） | `extends`（单继承） |
| `private int x;`（运行时私有） | `private x: number`（**仅编译期**）/ `#x`（运行时真私有） |
| `protected` | `protected`（仅编译期） |
| `final` 字段 | `readonly` |
| `final` 类 | **没有** |
| `static` | `static` |
| `abstract` | `abstract` |
| `@Override` | `override`（配 `noImplicitOverride`） |
| 构造器赋值 `this.x = x` | `constructor(private readonly x: number) {}` 参数属性简写 |
| `toString()` | `toString()`（模板字符串会自动调用） |
| `equals()` / `hashCode()` | **没有**，自己写比较函数 |
| `Comparable` | 传比较器 `(a, b) => number` |
| `Iterable` | `[Symbol.iterator]()` 或 `function*` |
| `getter/setter` | `get x() {}` / `set x(v) {}` |
| 包级私有 | **没有**，用「不 export」达到文件级私有 |
| 内部类 / 匿名类 | 对象字面量 / 闭包 |
| 接口默认方法 | 抽象类，或普通函数 |
| `sealed interface` + `switch` 模式匹配 | **可辨识联合 + `switch` + `never` 穷尽检查**（更好用） |

---

## 7. 并发与异步

| Java / Go | TypeScript |
| --- | --- |
| 线程 / goroutine | **没有**（单线程事件循环）；CPU 密集用 `worker_threads` |
| `CompletableFuture<T>` / channel | `Promise<T>` |
| `future.get()` / `<-ch` | `await promise` |
| `Thread.sleep(100)` / `time.Sleep` | `await new Promise(r => setTimeout(r, 100))` 或 `node:timers/promises` 的 `setTimeout` |
| `synchronized` / `sync.Mutex` | **不需要**（但要小心 `await` 之间的交错） |
| `CountDownLatch` / `sync.WaitGroup` | `await Promise.all([...])` |
| `ExecutorService` 固定线程池 | 手写并发上限的 `mapConcurrent(items, limit, fn)` |
| `invokeAny` / `select` | `Promise.race` / `Promise.any` |
| `allOf` 全部完成（含失败） | `Promise.allSettled` |
| `context.Context` / `Future.cancel` | `AbortController` / `AbortSignal` |
| `context.WithTimeout` | `AbortSignal.timeout(ms)` |
| `defer` | `try { } finally { }` |
| `recover()` | `try/catch` |
| `errgroup` | `Promise.all` + `AbortController`（需自己串起来） |
| `ThreadLocal` | `AsyncLocalStorage`（`node:async_hooks`） |
| 阻塞 IO | 全部异步 API（`node:fs/promises`） |

---

## 8. 错误处理

| Java / Go | TypeScript |
| --- | --- |
| `throw new Exception()` | `throw new Error()`（可以抛任何值，但请只抛 `Error`） |
| checked exception / `throws` | **没有**，签名看不出会抛什么 |
| `catch (IOException e)` | `catch (e)`，`e` 类型是 `unknown`，需 `instanceof` 判断 |
| `e.getCause()` / `%w` wrap | `e.cause`（ES2022） |
| `e.getMessage()` | `e.message` |
| `e.printStackTrace()` | `console.error(e)` / `e.stack` |
| `finally` / `defer` | `finally` |
| try-with-resources | `try/finally`，或 `using`（TS 5.2+ 显式资源管理） |
| `if err != nil { return nil, err }` | `Result<T, E>` 可辨识联合（手写，见第 07 章） |
| `IllegalArgumentException` | `TypeError` / `RangeError` / 自定义 `Error` 子类 |
| Bean Validation `@NotNull` | **zod schema**（schema 即类型来源） |
| `System.exit(1)` / `os.Exit(1)` | `process.exitCode = 1`（推荐）/ `process.exit(1)` |

---

## 9. 模块与工程

| Java / Go | TypeScript / Node |
| --- | --- |
| `package com.foo;` | 文件即模块，没有 package 声明 |
| `import com.foo.Bar;` | `import { Bar } from './bar.js';` |
| `import static` | `import { x }`（一样） |
| `import com.foo.*;` | `import * as foo from './foo.js';` |
| `public` 才对外可见 | `export` 才对外可见（不 export = 文件私有） |
| `pom.xml` / `build.gradle` / `go.mod` | `package.json` |
| `mvn install` / `go mod download` | `pnpm install` |
| `~/.m2` / `$GOPATH/pkg/mod` | `node_modules`（每个项目一份） |
| `go.sum` / `pom.xml` 锁版本 | `pnpm-lock.yaml` |
| `javac` / `go build` | `tsc`（类型检查 + 转译） |
| `java -jar` / `./binary` | `node dist/main.js` |
| `go run main.go` | `tsx src/main.ts` |
| `mvn test` / `go test ./...` | `vitest run` |
| `go vet` / SpotBugs | `tsc --noEmit` + ESLint |
| jar / 静态二进制 | npm 包（`bin` 字段 + `npx`） |
| `System.getenv("X")` | `process.env.X`（类型是 `string \| undefined`） |
| `args` in `main` | `process.argv.slice(2)` |
| `System.out` / `System.err` | `console.log` / `console.error` |
| classpath 唯一版本 | **同一包可存在多份不同版本**（注意 `instanceof` 跨副本失效） |

---

## 10. 常用 Node 内置模块（CLI / Agent 必备）

```ts
import { readFile, writeFile, mkdir, readdir, stat, rm, mkdtemp } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, resolve, dirname, basename, extname, relative, sep } from 'node:path';
import { homedir, tmpdir, platform, cpus } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify, styleText } from 'node:util';
import { parseArgs } from 'node:util';
import { EventEmitter } from 'node:events';
import { pipeline } from 'node:stream/promises';
```

---

## 11. 类型系统专用速查

| 想做的事 | 写法 |
| --- | --- |
| 取对象所有键的联合 | `keyof T` |
| 从值推出类型 | `typeof value`（类型位置） |
| 取属性类型 | `T['key']` |
| 数组元素类型 | `T[number]` |
| 全部可选 / 必填 / 只读 | `Partial<T>` / `Required<T>` / `Readonly<T>` |
| 挑几个键 / 去掉几个键 | `Pick<T, 'a' \| 'b'>` / `Omit<T, 'a'>` |
| 字典类型 | `Record<string, V>` |
| 去掉 null/undefined | `NonNullable<T>` |
| 联合里筛选 / 排除 | `Extract<U, X>` / `Exclude<U, X>` |
| 取函数返回值 / 参数 | `ReturnType<F>` / `Parameters<F>` |
| 拆掉 Promise | `Awaited<T>` |
| 字面量收窄 | `as const` |
| 校验但不放宽推断 | `expr satisfies T` |
| 自定义类型守卫 | `function isX(v: unknown): v is X` |
| 断言函数 | `function assertX(v: unknown): asserts v is X` |
| 穷尽性检查 | `function never(x: never): never { throw ... }` |
| schema 推类型 | `type T = z.infer<typeof Schema>` |

---

**返回** → [README 目录](../README.md) ｜ **下一篇** → [B · 常见坑](./B-pitfalls.md)
