# 10 · 测试与质量保障：把 JUnit + Mockito + AssertJ 的肌肉记忆搬过来

> 本章目标：**写出别人敢改的测试**。vitest 的 API 和 JUnit 5 / Mockito / testify 几乎一一对应，
> 所以重点不是"怎么写 `it`"，而是：**哪些东西换了名字、哪些坑是 JS 独有的、
> 以及为什么 TS 项目应该比 Java 项目少用 mock**。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 断言相等 | `assertEquals` / `assertThat().isEqualTo()` | `toBe`（**Object.is**）vs `toEqual`（结构） | 🔴 高 |
| 异步断言 | Java 里 `future.get()` 会阻塞 | **忘了 `await`/`return`，断言就不跑**，测试假绿 | 🔴 高 |
| 定时器 | `Thread.sleep` / `time.Sleep` 真睡 | `vi.useFakeTimers()`，**不清理会污染后面所有测试** | 🔴 高 |
| 浮点断言 | `assertEquals(a, b, delta)` | `toBeCloseTo`（用 `toBe` 一定挂） | 🔴 高 |
| Mock 静态方法 | PowerMock / `mockStatic` | `vi.mock('module')`，但**优先改成依赖注入** | 🟡 中 |
| 类型检查算不算测试 | `javac` / `go build` 在 CI 里 | `tsc --noEmit` **必须进 CI**，否则类型标注等于注释 | 🟡 中 |
| 测试文件位置 | Go 的 `_test.go` 必须同包 | **放哪都行**，能 import 任何 `export`（没有 package-private） | 🟡 中 |
| 测试方法 | `@Test void shouldXxx()` | `it('should xxx', () => {})`（描述是字符串，中文也行） | 🟢 低 |
| 前置/后置 | `@BeforeEach` / `@AfterEach` / `@BeforeAll` | `beforeEach` / `afterEach` / `beforeAll`（无 static 限制） | 🟢 低 |
| 打桩 | `when(m.f()).thenReturn(x)` | `vi.fn().mockReturnValue(x)` / `.mockResolvedValue(x)` | 🟢 低 |
| 验证调用 | `verify(m).f("a")` | `expect(m.f).toHaveBeenCalledWith('a')` | 🟢 低 |
| 参数捕获 | `ArgumentCaptor` | `m.f.mock.calls[0]` —— 就是个数组，不用捕获器 | 🟢 低 |
| 表驱动测试 | Go 的 `for _, tt := range tests` | `it.each([...])` / `test.for([...])` | 🟢 低 |
| 期望异常 | `assertThrows(E.class, () -> ...)` | `expect(fn).toThrow(E)` / `await expect(p).rejects.toThrow(E)` | 🟢 低 |
| 分组 | 内部类 + `@Nested` | `describe` 任意嵌套 | 🟢 低 |

---

## 1. 为什么是 vitest 而不是 jest

| | jest | vitest |
| --- | --- | --- |
| ESM / TS | 要接 `ts-jest` 或 babel，配置一堆 | **原生支持**，装完直接跑 `.ts` |
| 速度 | 每个文件重新转译 | esbuild 转译 + 缓存，快好几倍 |
| API | —— | **和 jest 几乎一样**（`vi` ≈ `jest`），经验直接复用 |
| 生态 | 独立 | 和 vite / `vitest --ui` / `@vitest/coverage-v8` 一套 |
| 类型测试 | 需要额外装 `tsd` | 自带 `expectTypeOf` / `assertType` |

> 只写一个**零依赖**小工具时，Node 20+ 内置的 `node:test` + `node:assert`（`node --test`）也够用，
> 但没有 mock 生态、没有覆盖率配置，TS 还得自己接 loader。本教程一律用 vitest。

---

## 2. 基础：`describe` / `it` / `expect`

```ts
import { describe, it, expect } from 'vitest';   // ← 本项目必须显式 import
import { formatDuration } from '../src/format.js';

describe('formatDuration', () => {               // ≈ @Nested / Go 的子测试分组
  it('小于 1 秒时用毫秒', () => {                  // ≈ @Test
    expect(formatDuration(999)).toBe('999ms');    // ≈ assertThat(x).isEqualTo(y)
  });
});
```

`it` 和 `test` 是**同一个函数的两个名字**，团队统一即可。

### `globals: false` 的取舍

本项目配了 `globals: false`，所以 `describe`/`it`/`expect`/`vi` 都要显式 import。
`globals: true`（jest 风格）能少写一行，但要在 tsconfig 里加 `"types": ["vitest/globals"]`，
IDE 跳转偶尔失灵，而且**生产代码里误用 `expect` 也能过编译** 😱。
**新项目一律 `globals: false`**：多敲一行换来"测试 API 不会泄漏进生产代码"。

### 挑选与跳过

```ts
it.only('只跑这一个', () => {});     // ⚠️ CI 里 allowOnly=false，提交上去直接失败
it.skip('暂时跳过', () => {});       // ≈ @Disabled
it.todo('还没写');                   // 只登记，不用函数体
it.fails('已知会失败', () => {       // 断言【必须】失败才算通过，用来锁住当前的错误行为
  expect(1).toBe(2);
});
it.concurrent('并发', async ({ expect }) => { expect(1).toBe(1); }); // ⚠️ 用参数上的 expect
it.skipIf(process.platform === 'win32')('非 Windows 才跑', () => {});
it('带超时', { timeout: 1000 }, async () => {});    // 第二个参数是选项对象
```

`describe` 同样有 `.only` / `.skip` / `.each` / `.skipIf`。

---

## 3. 断言大全（对照 AssertJ）

| AssertJ / testify | vitest | 说明 |
| --- | --- | --- |
| `isSameAs(y)` | `toBe(y)` | **引用相等**（内部是 `Object.is`） |
| `isEqualTo(y)` | `toEqual(y)` | 结构递归相等，**忽略** `undefined` 属性 |
| —— | `toStrictEqual(y)` | 更严：`undefined` 属性、原型、稀疏数组都要一致 |
| `isCloseTo(y, offset)` | `toBeCloseTo(y, digits?)` | 浮点专用 |
| `contains(x)` | `toContain(x)` / `toContainEqual(x)` | 前者用 `===` 比元素，**对象数组用后者** |
| `hasSize(n)` | `toHaveLength(n)` | 数组 / 字符串 |
| `isNull()` | `toBeNull()` / `toBeUndefined()` / `toBeDefined()` | TS 双空值的代价 |
| `isTrue()` | `toBe(true)` ✅ / `toBeTruthy()` 😱 | 后者慎用：`0` / `''` / `[]` 的真假很反直觉 |
| `hasFieldOrPropertyWithValue` | `toHaveProperty('a.b', v)` | 支持点路径 |
| `usingRecursiveComparison()` | `toMatchObject({...})` | 只比给定的子集 |
| `isIn(list)` / `matches(pred)` | `toBeOneOf([...])` / `toSatisfy(pred)` | |

### `toBe` vs `toEqual` vs `toStrictEqual` —— Java 直觉要改

心智模型可以直接搬：**`toBe` ≈ `==`，`toEqual` ≈ `.equals()`**。但有四个 JS 独有的细节：

```ts
expect({ a: 1 }).not.toBe({ a: 1 });        // ✅ 不同对象
expect({ a: 1 }).toEqual({ a: 1 });         // ✅ 结构相等

// ① toBe 用的是 Object.is，不是 ===
expect(NaN).toBe(NaN);                      // ✅ 通过！（NaN === NaN 是 false）
expect(0).not.toBe(-0);                     // 😱 通过！（0 === -0 是 true）

// ② toEqual 忽略值为 undefined 的属性
expect({ a: 1, b: undefined }).toEqual({ a: 1 });            // ✅
expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 });  // toStrictEqual 不忽略

// ③ toEqual 不看原型，toStrictEqual 看
class Size { constructor(readonly bytes: number) {} }
expect(new Size(1)).toEqual({ bytes: 1 });                   // ✅
expect(new Size(1)).not.toStrictEqual({ bytes: 1 });         // ✅

// ④ Error 有特殊待遇：toEqual 连 name / message 一起比
expect(new TypeError('x')).not.toEqual({});                  // ✅
expect(new TypeError('x')).toEqual(new TypeError('x'));      // ✅
```

**法则**：原始值用 `toBe`，对象/数组用 `toEqual`，想把 `undefined` 键和 class 身份一起卡死才用 `toStrictEqual`。

### 浮点 / 异常 / 异步

```ts
expect(0.1 + 0.2).not.toBe(0.3);       // 😱 0.30000000000000004
expect(0.1 + 0.2).toBeCloseTo(0.3);    // ✅ 默认比到小数点后 2 位

class HttpError extends Error { constructor(readonly status: number) { super(`HTTP ${status}`); } }
const boom = (): never => { throw new HttpError(503); };

expect(boom).toThrow();                                          // 抛了就行
expect(boom).toThrow(HttpError);                                 // 类型
expect(boom).toThrow('HTTP 503');                                // 消息【包含】该子串
expect(boom).toThrow(/^HTTP \d{3}$/);                            // 消息匹配正则
expect(boom).toThrow(expect.objectContaining({ status: 503 }));  // 断言业务字段
// toThrowError 是 toThrow 的别名；必须传【函数】：expect(boom()).toThrow() 里 boom() 先抛了

await expect(fetchUser('u1')).resolves.toEqual({ id: 'u1' });
await expect(fetchUser('x')).rejects.toThrow(HttpError);
await expect(fetchUser('x')).rejects.toMatchObject({ status: 404 });
```

### 非对称匹配器、`soft`、`assertions`、自定义匹配器

```ts
expect(resp).toEqual({
  id: expect.stringMatching(/^u-/),
  createdAt: expect.any(Date),                          // 只要求"是个 Date"
  profile: expect.objectContaining({ name: 'jack' }),   // 只比这几个字段
  tags: expect.arrayContaining(['a']),                  // 只要求包含
});

it('一次报出所有失败，而不是挂在第一条', () => {
  expect.soft(r.code).toBe(0);          // soft：失败也继续往下跑，最后一起报
  expect.soft(r.stdout).toContain('ok');
});

it('确认断言真的跑了', async () => {
  expect.assertions(1);                 // 本测试必须【正好】跑 1 个断言
  try {
    await load();
    expect.unreachable('上面应该抛错');   // 走到这里直接失败
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
  }
});

// 自定义匹配器 = 把重复断言收成一个领域词汇（≈ AssertJ 自定义 Assert 类，但便宜得多）
declare module 'vitest' {
  interface Matchers<T = any> { toBeValidJobId(): T }
}
expect.extend({
  toBeValidJobId(received: unknown) {
    const pass = typeof received === 'string' && /^job-[0-9a-f]{8}$/.test(received);
    return { pass, message: () => `expected ${String(received)} ${pass ? 'not ' : ''}to be a job id` };
  },
});
expect(id).toBeValidJobId();
```

---

## 4. 异步测试：**忘了 `await` 就等于没测**

Java 里没有"忘了 join 就静默通过"这回事，所以这是转过来最容易栽的坑。

```ts
it('bad',  () => { load().then((v) => { expect(v).toBe(999); }); });           // ❌ 没人等
it('bad2', () => { items.forEach(async (x) => { expect(await f(x)).toBe(1); }); }); // ❌ 同上

it('good',  async () => { expect(await load()).toBe(1); });                    // ✅
it('good2', () => expect(load()).resolves.toBe(1));                           // ✅ return 它
it('good3', async () => { for (const x of items) expect(await f(x)).toBe(1); }); // ✅ 串行遍历
```

**vitest 4 帮了一半的忙**（实测）：上面 ❌ 的断言最终会以 `Unhandled Rejection` 被抓到，
进程**退出码是 1** —— 但**测试本身仍然显示绿色**，只在报告末尾多一段
`Vitest caught N unhandled errors`。**所以 CI 要看退出码，不要看"好像全绿"。**

还有一种它抓不到的假绿：**断言所在的分支根本没执行**。

```ts
it('真的静默通过', async () => {      // 😱 load() 不抛错 -> catch 不执行 -> 0 个断言
  try { await load(); } catch (e) { expect(e).toBeInstanceOf(HttpError); }
});
```

解药只有两个：`expect.assertions(n)`，或者直接写 `await expect(load()).rejects.toThrow()`。

超时：`it('慢', { timeout: 30_000 }, async () => {})`；全局默认看 `testTimeout`（本项目 10 秒）。
**超时报错优先怀疑"有个 Promise 永远不 resolve"**，而不是机器慢。

---

## 5. 生命周期

```ts
let server: Server;
beforeAll(async () => { server = await start(); });      // ≈ @BeforeAll（不用 static）
afterAll(async () => { await server.close(); });

let rows: string[];
beforeEach(() => {
  rows = [];                            // ⚠️ 共享状态必须【重建】，别复用上一个测试的对象
  return () => { rows.length = 0; };    // 返回值当清理函数，比再写个 afterEach 更就近
});
afterEach(() => { vi.restoreAllMocks(); });

it('只给这一个测试注册清理', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'x-'));
  onTestFinished(async () => { await rm(dir, { recursive: true, force: true }); });
  // 断言成功还是失败，上面的清理都会跑
});
```

**实测的执行顺序**（vitest 4，默认 `sequence.hooks: 'stack'`）：

```
beforeEach → 测试体 → afterEach（后注册的先跑！） → beforeEach 返回的清理 → onTestFinished（后注册的先跑）
```

> `afterEach` 是**逆序**执行的（像栈）。有先后依赖的清理别拆成两个 `afterEach`，写成一个。

隔离的坑：**同一文件**内的测试共享模块顶层状态（所以要在 `beforeEach` 重建）；**不同文件**默认
完全隔离（`isolate: true`，一文件一个 fork 进程）；跨文件共享的重资源用 `globalSetup`，别用 `beforeAll`。

---

## 6. 表驱动测试：`it.each` 和 `test.for`

就是 Go 的 `for _, tt := range tests` 的语法糖，而且**每行是独立的测试**，挂了一眼看出是哪行。

```ts
// ① 元组 + printf 占位符（%s 串 / %i 整数 / %o 对象 / %# 序号）
it.each([
  [0,         '0ms'],
  [999,       '999ms'],
  [1500,      '1.5s'],
  [59_999,    '60s'],      // ← 边界很丑，但表驱动就是用来把它钉在测试里的
  [90_000,    '1m30s'],
  [3_600_000, '1h'],
])('formatDuration(%i) === %s', (ms, want) => {
  expect(formatDuration(ms)).toBe(want);
});

// ② 对象数组 + $prop 插值（字段多了以后可读性完胜元组）
it.each([
  { input: '',      want: null, why: '空串' },
  { input: '42abc', want: null, why: '尾部有垃圾' },
  { input: '42',    want: 42,   why: '正常' },
])('parseIntStrict($input) —— $why', ({ input, want }) => {
  expect(parseIntStrict(input)).toBe(want);
});

// ③ test.for：整条用例作为【一个】参数，额外给你 test context
test.for([
  { input: -1, why: '负数' },
  { input: NaN, why: 'NaN' },
])('formatDuration 拒绝 $why', ({ input }, { expect: e }) => {
  e(() => formatDuration(input)).toThrow(RangeError);
});
```

区别：`each` 把元组**展开**成多个参数，`for` 原样传一个参数并给出 test context（能拿到 scoped
`expect`、`onTestFinished`）。**新代码优先 `test.for`**，参数多了不会数错位置。
`it.each` 还支持模板字符串表格（`` it.each`a | b | sum` `` 加 `${...}` 行），写法最接近 Go。
名字里的插值走 pretty-format，所以 `0` 会显示成 `+0`、字符串带引号 —— 别被吓到。

---

## 7. Mock：Mockito 用户最关心的部分

### 7.1 `vi.fn()` = `Mockito.mock()` + `when().thenReturn()`

```ts
interface UserRepo {
  findById(id: string): Promise<User | null>;
  save(u: User): Promise<void>;
}
// 一个"接口的假实现"：每个方法一个 vi.fn()
const repo: UserRepo = {
  findById: vi.fn<UserRepo['findById']>().mockResolvedValue({ id: 'u1', name: 'jack' }),
  save: vi.fn<UserRepo['save']>().mockResolvedValue(undefined),
};
```

| Mockito | vitest |
| --- | --- |
| `when(m.f()).thenReturn(x)` / `thenReturn(future(x))` | `mockReturnValue(x)` / `mockResolvedValue(x)` |
| `when(m.f()).thenThrow(e)` | `mockRejectedValue(e)`（异步）/ `mockThrow(e)`（同步） |
| `thenAnswer(inv -> ...)` / `thenReturn(a, b)` | `mockImplementation(fn)` / `mockReturnValueOnce(a).mockReturnValueOnce(b)` |
| `verify(m).f()` / `times(2)` / `never()` | `toHaveBeenCalled()` / `toHaveBeenCalledTimes(2)` / `not.toHaveBeenCalled()` |
| `verify(m).f("a")` / InOrder 第 n 次 | `toHaveBeenCalledWith('a')` / `toHaveBeenNthCalledWith(2, 'b')` |
| `ArgumentCaptor` / `any(String.class)` | `m.f.mock.calls[0]`（**就是个二维数组**）/ `expect.any(String)` |

```ts
expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
expect(vi.mocked(repo.save).mock.calls[0]?.[0]?.name).toBe('jack');       // 参数原始记录
expect(vi.mocked(repo.findById).mock.settledResults[0])                   // 已 settle 的结果
  .toEqual({ type: 'fulfilled', value: { id: 'u1', name: 'jack' } });
```

### 7.2 `vi.spyOn` 与三个清理函数

```ts
const spy = vi.spyOn(logger, 'warn').mockImplementation(() => {});  // 吞掉噪音日志
expect(spy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
spy.mockRestore();          // ⚠️ 必须还原，否则污染后面的测试
// vi.spyOn(obj, 'prop', 'get' | 'set') 可以监视 getter/setter
```

| 调用 | 清调用记录 | 恢复实现 | 撤销 `spyOn` 的替换 |
| --- | --- | --- | --- |
| `vi.clearAllMocks()` / `.mockClear()` | ✅ | ❌ | ❌ |
| `vi.resetAllMocks()` / `.mockReset()` | ✅ | ✅ | ❌ |
| `vi.restoreAllMocks()` / `.mockRestore()` | ✅ | ✅ | ✅ |

> ⚠️ **vitest 4 改了 `mockReset` 的语义**（实测确认）：`vi.fn(impl).mockReset()` 现在恢复成
> **`impl`**，而不是 v3 那样变成"返回 undefined 的空函数"。只有 `vi.fn()`（没给实现）才会变空。
> 从 v3 升上来的代码要检查这一处。

配置里可以自动做，**推荐只开 `clearMocks`**：

```ts
test: {
  clearMocks: true,     // 每个测试前自动 mockClear
  // mockReset: true,   // 会把打桩实现也清掉，常导致"莫名其妙返回 undefined"
  // restoreMocks: true // 自动撤销所有 spyOn
}
```

### 7.3 `vi.mock('module')`：模块级 mock（≈ `mockStatic` / PowerMock）

```ts
import { describeNow } from '../src/consumer.js';

// vi.hoisted 的返回值会被提升到文件最顶部执行，所以能在 factory 里用
const h = vi.hoisted(() => ({ fakeNow: vi.fn(() => 999) }));

vi.mock('../src/clock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/clock.js')>();
  return { ...actual, now: h.fakeNow };   // 部分 mock：只换 now，其余保留真实现
});

it('用假时钟', () => { expect(describeNow()).toBe('real-label@999'); });
```

**为什么需要 `vi.hoisted`？** `vi.mock` 会被提升到所有 `import` **之前**执行（否则被测模块早就
拿到真依赖了），所以 factory 里不能引用普通 `const`（那时它还没初始化，会报
`Cannot access before initialization`）。`vi.hoisted` 就是"把这段初始化也一起提升"的逃生舱。
配套 API：`vi.importActual`（绕过 mock 拿真模块）、`vi.importMock`（自动 mock 全部导出）、
`vi.doMock`（不提升，只影响之后的动态 `import()`）、`vi.mockObject(obj, { spy: true })`（v4 新增）。

### 7.4 ⭐ 优先依赖注入，而不是模块 mock

本章**最重要的一条建议**。看重构对照：

```ts
// ❌ 难测：依赖是 import 进来的硬连线
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function loadConfig(path: string): Promise<Config> {
  const text = await readFile(path, 'utf8');
  return { ...JSON.parse(text), traceId: randomUUID(), loadedAt: Date.now() };
}
// 要测它得 vi.mock('node:fs/promises') + vi.mock('node:crypto') + vi.setSystemTime，
// 而且测试和"实现用了哪个 API"绑死 —— 改成 readFileSync 就全挂。
```

```ts
// ✅ 好测：把外部世界收进一个参数
export interface ConfigDeps { readText(p: string): Promise<string>; newId(): string; now(): number }

export async function loadConfig(path: string, deps: ConfigDeps): Promise<Config> {
  const text = await deps.readText(path);
  return { ...JSON.parse(text), traceId: deps.newId(), loadedAt: deps.now() };
}
// 生产入口处组装一次（相当于 Spring 的 @Configuration，但只是个对象字面量）
export const nodeDeps: ConfigDeps = { readText: (p) => readFile(p, 'utf8'), newId: randomUUID, now: Date.now };

it('loadConfig', async () => {          // 零 mock、零 fake timer、完全确定
  const cfg = await loadConfig('/x.json', {
    readText: async () => '{"port":8080}', newId: () => 'fixed-id', now: () => 1_700_000_000_000,
  });
  expect(cfg).toEqual({ port: 8080, traceId: 'fixed-id', loadedAt: 1_700_000_000_000 });
});
```

**为什么这件事在 TS 里比 Java 容易得多？**

| | Java | TypeScript |
| --- | --- | --- |
| 注入容器 | 通常要 Spring / Guice | **不需要**，就是多一个参数 |
| 声明依赖 | 接口 + 实现类 + `@Component` | 一个 `interface`（结构化类型，连 `implements` 都不用写） |
| 测试替身 | Mockito 生成代理类 | 一个对象字面量，几行搞定 |
| 部分替换 | `@Spy` + `doReturn` | 展开运算符：`{ ...nodeDeps, now: () => 0 }` |

所以 **`vi.mock` 应该是最后手段**：只在第三方库在模块顶层就做副作用、
或者你在给别人的老代码补测试时才用。

### 7.5 文件系统 / 网络：mock 还是来真的？

| 场景 | 推荐做法 | 理由 |
| --- | --- | --- |
| 读写文件 | **真的临时目录** | 假实现测不出编码、权限、路径拼接的 bug |
| 复杂目录树 | 内存假 fs（自己写 `{ readFile, writeFile, exists }`） | 快，断言"最终写了什么" |
| HTTP 调外部 API | **假实现**（注入一个 `fetchJson` 函数） | 最简单、最快、最稳 |
| 必须测真实 HTTP 层（重试/超时/header） | `msw` 之类的拦截库 | 只有这时才值得引依赖 |

```ts
let dir = '';
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'mytool-')); }); // 每次唯一目录名，
afterAll(async () => { await rm(dir, { recursive: true, force: true }); }); // 并发测试互不干扰

it('真写真读', async () => {
  const file = join(dir, 'report.json');
  await writeFile(file, JSON.stringify({ ok: true }), 'utf8');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true });
});
```

---

## 8. Fake timers

被测代码里已经写死了 `setTimeout`（第三方库、老代码）时，用它接管时间。
和 [第 06 章](./06-async.md) 的重试/超时逻辑正好对上。

```ts
describe('retry 的退避', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });   // 🔴 忘了这行，后面所有涉及时间的测试都会诡异挂掉

  it('三次重试的间隔是 100 / 200 / 400', async () => {
    const attemptAt: number[] = [];
    const fn = vi.fn(async () => { attemptAt.push(Date.now()); throw new Error('503'); });

    const p = retry(fn, { retries: 3, baseDelayMs: 100 });   // 内部用真 setTimeout
    const assertion = expect(p).rejects.toThrow('503');       // ⚠️ 先挂断言，再推时间（见下）
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(fn).toHaveBeenCalledTimes(4);
    expect(attemptAt).toEqual([0, 100, 300, 700]);
  });
});
```

| API | 作用 |
| --- | --- |
| `vi.useFakeTimers(opts?)` | 接管。`opts.now` 设起始时刻，`opts.toFake: ['setTimeout','Date']` 只接管部分 |
| `vi.useRealTimers()` | 还原（**必须**在 `afterEach` 里调） |
| `vi.advanceTimersByTime(ms)` | 同步推进：只触发**已经注册**的定时器 |
| `vi.advanceTimersByTimeAsync(ms)` | 异步推进：`await` 每个回调，能级联触发新注册的定时器 |
| `vi.runAllTimersAsync()` / `runOnlyPendingTimersAsync()` | 跑到队列空 / 只跑当前已注册的 |
| `vi.advanceTimersToNextTimerAsync()` | 一次只跳到下一个定时器（想在每次之间做断言） |
| `vi.setSystemTime(date)` | 设定 `Date.now()` / `new Date()` / `performance.now()` |
| `vi.getTimerCount()` / `vi.isFakeTimers()` / `vi.setTimerTickMode()` | 待触发数 / 是否假时钟 / v4 新增的自动推进模式 |

**三个实测确认的行为：**

```ts
// ① 同步 advance 推不动 await 链
const task = (async () => {
  await sleep(100); log.push('a');
  await sleep(100); log.push('b');   // 这个 setTimeout 是 'a' 之后才注册的
})();
vi.advanceTimersByTime(200);
await Promise.resolve();
expect(log).toEqual(['a']);          // 😱 只跑了一半
await vi.advanceTimersByTimeAsync(200);
expect(log).toEqual(['a', 'b']);     // ✅ 异步版本才会级联
```

② 微任务默认**不**被接管，`await Promise.resolve()` 和 `process.nextTick` 照常工作；
但 `performance.now()` 是被接管的，会随 `advanceTimersByTime` 走。

③ 先 `await advance` 再挂 `rejects` 断言 → Promise 在推进时就 reject 了却没人处理 →
Node 报 unhandled rejection →「测试通过 + 1 error」，退出码 1。所以要**先存断言，再推时间**。

### 但是：注入时钟往往更简单

fake timers 是**全局劫持**，出问题非常难查。代码是你自己写的，就把时钟做成依赖：

```ts
export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const systemClock: Clock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

it('退避序列', async () => {              // 一个 3 行的假时钟，没有全局劫持
  let t = 0;
  const slept: number[] = [];
  const clock: Clock = { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } };
  await expect(retry(alwaysFail, { retries: 3, baseDelayMs: 100, clock })).rejects.toThrow();
  expect(slept).toEqual([100, 200, 400]);   // ✅ 一目了然
});
```

> 练习 10.9 让你手写一个更完整的、支持"手动推进 + 唤醒 sleep"的 stub clock。
> 写完你会发现 `vi.useFakeTimers()` 里装的就是这个东西。

---

## 9. 快照测试

```ts
expect(renderSummary(rows)).toMatchInlineSnapshot(`     // ① 写在测试里（推荐，review 看得见）
  "files: 2
    main.ts      2KiB
    util.ts      512B"
`);
expect(bigTree).toMatchSnapshot();                       // ② 写到 __snapshots__/xxx.snap
expect(() => parse('{')).toThrowErrorMatchingInlineSnapshot(  // ③ 错误消息也能快照
  `[SyntaxError: Unexpected end of JSON input]`,
);
```

第一次跑自动填入；之后输出变了就报 diff。确认新输出正确后用 `-u` 更新
（`vitest run tests/ch10 -u` 全部更新，`-u new` 只补缺失的、不覆盖已有的）。

**适合快照**：CLI 的 `--help` 和表格输出、格式化/序列化结果、复杂错误消息。
**不适合**：业务规则（"金额超 1 万要审批" → 写显式断言）、含时间戳/路径/随机 ID 的原始输出
（先洗，见下）、大到没人会读的 JSON（一变就无脑 `-u`，等于没测）。

**先把不稳定的部分洗掉再快照**（练习 10.8 就是这个）：

```ts
const stable = raw
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, '<TIMESTAMP>')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
  .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<PATH>')
  .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<DURATION>');
expect(stable).toMatchInlineSnapshot(`"[<TIMESTAMP>] wrote <PATH> in <DURATION>"`);
```

> **黄金法则**：如果你 review 时看不懂这个快照该长什么样，它就不该是快照。

---

## 10. 覆盖率

```bash
pnpm add -D @vitest/coverage-v8      # provider 要单独装
./node_modules/.bin/vitest run --coverage
```

> 本项目**没装**它，直接跑会看到 `MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'`。

```ts
coverage: {
  provider: 'v8',                    // 默认值就是 v8（基于 V8 原生计数，快、零插桩）
  reporter: ['text', 'html', 'lcov'],
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.d.ts', 'src/cli/main.ts'],   // 入口 main 通常不值得测
  thresholds: {
    lines: 80, functions: 80, branches: 70, statements: 80,
    perFile: false,                  // true 时每个文件都要达标（很严，慎开）
    'src/core/**': { lines: 95 },    // 核心模块单独提高要求
  },
}
```

**为什么不要盲目追 100%？**

- 覆盖率只回答"这行**执行过**吗"，不回答"这行**对**吗"：`try { risky(); } catch {}`
  覆盖率 100%，却把所有错误都吞了。
- 为了最后 10% 去测 `if (process.platform === 'win32')`，收益趋近于零。
- 有价值的是**门槛 + 趋势**（80% 阈值 + "新增代码不许降低覆盖率"），以及
  **人工过一遍未覆盖的分支清单**。CLI/Agent 项目里「参数解析」「错误处理」「重试逻辑」
  必须高覆盖，「打印帮助文本」低覆盖没关系。

---

## 11. 配置：`vitest.config.ts`

```ts
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],   // 哪些文件是测试
    environment: 'node',               // ✅ CLI/Agent 固定 node，不要 jsdom
    globals: false,                    // 见第 2 节
    setupFiles: ['./tests/setup.ts'],  // 每个测试文件前执行（注册匹配器、设环境变量）
    testTimeout: 10_000,
    hookTimeout: 10_000,
    clearMocks: true,
    pool: 'forks',                     // v4 默认；threads 更快但对原生模块不友好
    isolate: true,                     // 每个文件独立环境（默认，别关）
    coverage: { /* 见上 */ },
    projects: [                        // ⚠️ v4 把 v3 的 `workspace` 改名成了 `projects`
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'e2e',  include: ['tests/e2e/**/*.test.ts'], testTimeout: 60_000 } },
    ],  // v3 的顶层 workspace 字段和 vitest.workspace.ts 文件都没了
  },
});
```

### 本项目那个 `@exercises` alias 是怎么工作的

```ts
const dir = process.env.SOLUTIONS === '1' ? 'solutions' : 'exercises';
resolve: {
  alias: [{
    find: /^@exercises\/(.*)$/,
    replacement: fileURLToPath(new URL(`./${dir}/$1`, import.meta.url)),
  }],
}
```

测试统一写 `import { formatDuration } from '@exercises/ch10-testing';`：跑 `vitest` 解析到
`exercises/`（你的 TODO 版本，全红），跑 `SOLUTIONS=1 vitest` 解析到 `solutions/`（全绿）。
**同一份测试**验证两份实现，所以两个文件的导出名和签名必须一模一样。

`tsconfig.json` 里还有一份 `paths: { "@exercises/*": ["exercises/*.ts"] }` 给 `tsc` 和 IDE 用
（TS 不认识 vite 的 alias）。**两处必须同时存在** —— 这是 TS 路径别名的通用套路：
构建工具负责运行时解析，tsconfig 负责类型解析。

---

## 12. 类型层面的质量保障

**`tsc --noEmit` 必须进 CI。** vitest 跑测试走 esbuild 转译，**只删类型不做检查** ——
类型错得一塌糊涂，测试照样能全绿。这一步不在 CI 里，你的类型标注就是注释。

`expectTypeOf` / `assertType` 把类型本身当测试对象（写库、写泛型工具时非常有用）：

```ts
it('公开签名不许被悄悄改坏', () => {
  expectTypeOf(formatDuration).parameters.toEqualTypeOf<[number]>();
  expectTypeOf(formatDuration).returns.toEqualTypeOf<string>();
  expectTypeOf<Config>().toHaveProperty('port');
  expectTypeOf<Awaited<ReturnType<typeof load>>>().toEqualTypeOf<User[]>();
  assertType<Clock>({ now: () => 0, sleep: async () => {} });
});
```

这些断言**在运行时是空操作**，真正检查它们的是 `tsc`（或 `vitest --typecheck`）。

`// @ts-expect-error` 是一条**"这里必须报错"的断言**：

```ts
// @ts-expect-error port 必须是 number —— 哪天这行不报错了，tsc 会说
// "Unused '@ts-expect-error' directive" 让构建失败，你就知道类型被改松了
const bad: Config = { port: '8080' };
```

对比 `@ts-ignore`（永远闭嘴）：**永远用 `@ts-expect-error`，永远不用 `@ts-ignore`。**

---

## 13. Lint 与格式化

> ⚠️ 下面只是给你抄的模板，**本教程项目里没装 eslint / prettier**（为了保持依赖最少）。

```js
// eslint.config.js —— ESLint 9 flat config，不再是 .eslintrc
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,     // 带类型信息的规则集，能查出 no-floating-promises
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // 🔴 这四条是 Java/Go 转 TS 最需要的：
      '@typescript-eslint/no-floating-promises': 'error',    // 忘了 await 的 Promise
      '@typescript-eslint/await-thenable': 'error',          // await 了一个非 Promise
      '@typescript-eslint/no-misused-promises': 'error',     // async 函数传给了要 void 的地方
      '@typescript-eslint/consistent-type-imports': 'error', // 只用于类型的 import 要写 import type

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-console': 'off',   // CLI 项目里 console 是正当输出手段
    },
  },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },
);
```

`no-floating-promises` 能自动抓出第 4 节那个"忘了 await 导致假绿"，是**投入产出比最高的一条规则**。
想明确表示"我知道这是个不等的 Promise"就写 `void promise`。

```json
// .prettierrc
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all", "arrowParens": "always" }
```

Prettier 只管格式，ESLint 只管正确性，**两者不要重叠**（别装 `eslint-plugin-prettier`，
把 `prettier --check` 作为独立 CI 步骤）。提交前用 `husky` + `lint-staged` 拦一道：

```json
// package.json（配好后 .husky/pre-commit 里只写一行 `npx lint-staged`）
{ "scripts": { "prepare": "husky" },
  "lint-staged": { "*.{ts,js}": ["eslint --fix", "prettier --write"], "*.{json,md,yml}": ["prettier --write"] } }
```

**pre-commit 只跑 lint 和格式化，不跑全量测试** —— 几秒以上的钩子会被同事 `--no-verify` 绕过。

---

## 14. CI：一份可以直接抄的 GitHub Actions

> 同样只是模板，**不要在本教程项目里创建 `.github/`**。

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22, 24]              # 覆盖 engines 里声明的范围
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm                   # 缓存 pnpm store，省一半时间
      - run: pnpm install --frozen-lockfile   # ≈ npm ci，锁文件不一致就失败

      # 快的先跑，失败得早
      - run: pnpm exec tsc --noEmit
      - run: pnpm exec eslint .
      - run: pnpm exec prettier --check .
      - run: pnpm exec vitest run --coverage --reporter=default --reporter=junit --outputFile=junit.xml
        env: { CI: 'true' }             # CI=true 时 vitest 自动禁用 watch，并让 .only 直接失败

      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: coverage-${{ matrix.node }}, path: coverage/ }
```

要点：**顺序是 `tsc` → `lint` → `test`**（类型错误 3 秒就报，没必要等 5 分钟测试）；
`CI=true` 让提交上来的 `it.only` 直接把流水线弄红；覆盖率先传成 artifact 就够，不必一上来接 Codecov；
**永远看退出码**，别信"好像全绿"（第 4 节）。

---

## 15. 小结：测什么 / 怎么测 / 用什么

| 要测的东西 | 怎么测 | 用什么 |
| --- | --- | --- |
| 纯函数（格式化、解析、计算） | 直接调用 + 表驱动覆盖边界 | `it.each` / `test.for` + `toBe` / `toEqual` / `toBeCloseTo` |
| 错误路径 | 显式断言错误类型和消息 | `toThrow(E)` / `rejects.toThrow` + `expect.assertions` |
| 数据校验（zod schema） | 合法样本 + **每一类非法样本** | `safeParse` 的结果 + `toMatchObject` |
| 依赖外部服务的业务逻辑 | **注入假实现** | `interface` + 对象字面量 / `vi.fn()` |
| 时间相关（重试、超时、限流） | **注入 clock**，退而求其次 fake timers | 手写 stub clock / `vi.useFakeTimers` |
| 文件读写 | 真临时目录 | `mkdtemp` + `afterAll` 清理 |
| HTTP 调用 | 注入 `fetchJson` 假实现 | `vi.fn().mockResolvedValue(...)` |
| CLI 输出格式 | 洗掉不稳定部分后快照 | `sanitize` + `toMatchInlineSnapshot` |
| 公开 API 的类型签名 | 类型断言 | `expectTypeOf` + `@ts-expect-error` + `tsc --noEmit` |
| 第三方模块的顶层副作用 | 万不得已才模块 mock | `vi.mock` + `vi.hoisted` |

### 测试金字塔在 CLI / Agent 项目里的现实形态

```
        ╱ 1~3 个「跑真二进制」的冒烟测试        ← 极少但极值钱
      ╱   （spawn 自己的 CLI，断言 stdout + 退出码）
    ╱───── 少量集成测试
  ╱        （真临时目录 + 假 LLM/HTTP，把 3~5 个模块串起来）
╱───────── 大量单元测试
           （纯函数 + 注入依赖的业务函数，毫秒级）
```

**两条针对 Agent 项目的特别建议：**

1. **绝不在测试里真调 LLM。** 不确定、要钱、还慢。把客户端抽成
   `interface Chat { complete(msgs: Message[]): Promise<Reply> }`，测试注入一个返回固定回复
   （含固定 tool_call）的假实现；真实调用留给手动 smoke 脚本。
2. **重点测「协议层」而不是「智能」。** 工具参数的 JSON 解析、schema 校验失败后的降级、
   ReAct 循环的终止条件、token 超限时的截断策略 —— 都是确定性逻辑，也恰好是线上最容易炸的地方。

最后一句：**测试的价值不在"证明代码对"，而在"下次改动时敢按下回车"。**
一个覆盖率 60% 但覆盖了全部错误路径的项目，比覆盖率 95% 全是 getter/setter 的项目安全得多。

---

## 本章练习

```bash
# 1. 打开 exercises/ch10-testing.ts，把所有 TODO 填掉
# 2. 跑测试
pnpm test tests/ch10

# 3. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch10

# 4. 卡住了看 solutions/ch10-testing.ts
# 5. 想看"完整的真实测试文件长什么样" → docs/snippets/ch10-demo.test.ts
```

12 道题，全部围绕「**自己实现一遍测试工具，顺便体会什么叫可测的代码**」：`once` 缓存语义、
`formatDuration`（表驱动的靶子）、`collectAsync` 异步流收集、手写 `createSpy`（`vi.fn` 的原理）、
手写 `assertThrows`（`toThrow` 的原理）、`createInMemoryFs` + `saveReport`（依赖注入代替模块 mock）、
手写 `deepEqual`（`toBe` vs `toEqual` 的本质：NaN / `-0` / Date / 循环引用）、`sanitizeSnapshot`
（快照稳定化）、`createStubClock`（`useFakeTimers` 的原理，闭包 + Promise）、`debounce` 与
`retryWithClock`（用假时钟断言退避时间序列），以及综合题 `createMiniRunner` —— 一个迷你测试框架。

---

**下一章** → [A · Java/Go → TypeScript 速查表](./A-cheatsheet.md)
