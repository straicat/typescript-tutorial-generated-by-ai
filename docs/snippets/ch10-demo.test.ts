/**
 * 第 10 章 · 示例测试文件（教学用，**不会被 pnpm test 跑到**）
 * =====================================================================
 * 本项目 vitest.config.ts 里 `include: ['tests/**\/*.test.ts']`，
 * 所以放在 docs/snippets 下的这个文件不参与实际测试运行。
 * 它的作用是：**一页看完一个真实测试文件该长什么样**。
 *
 * 想真的跑它：把它复制到 tests/ 下，或者临时给一个自己的配置文件：
 *   ./node_modules/.bin/vitest run --config my.config.ts
 * （vitest 4 的 CLI 没有 --include 参数，include 只能在配置里写。）
 *
 * 为了自包含（不依赖任何练习文件），被测代码就写在文件顶部。
 * 真实项目里被测代码当然应该在 src/ 里，测试只 import 它。
 * =====================================================================
 */

import {
  describe,
  it,
  test,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  onTestFinished,
  expectTypeOf,
  assertType,
} from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ===========================================================================
// 一、被测代码（真实项目里在 src/ 下）
// ===========================================================================

/** 领域错误：带业务字段，测试里可以断言 status */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** 纯函数：最好测的那一类代码 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`formatBytes: bad input ${n}`);
  const units = ['B', 'KiB', 'MiB', 'GiB'] as const;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const unit = units[i] ?? 'B';
  return i === 0 ? `${value}${unit}` : `${Math.round(value * 10) / 10}${unit}`;
}

/**
 * ⭐ 可测性的关键：所有外部世界都通过参数进来。
 * 没有 `import { readFile } from 'node:fs/promises'`，
 * 没有 `new Date()`，没有 `setTimeout`。
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface Store {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

export interface CacheDeps {
  store: Store;
  clock: Clock;
  ttlMs: number;
  fetcher: (key: string) => Promise<string>;
}

interface CacheEntry {
  value: string;
  at: number;
}

/** 带 TTL 的读穿缓存 —— 依赖注入版，测试里 0 毫秒跑完 */
export async function readThrough(key: string, deps: CacheDeps): Promise<string> {
  const raw = await deps.store.get(key);
  if (raw != null) {
    const entry = JSON.parse(raw) as CacheEntry;
    if (deps.clock.now() - entry.at < deps.ttlMs) return entry.value;
  }
  const fresh = await deps.fetcher(key);
  await deps.store.put(key, JSON.stringify({ value: fresh, at: deps.clock.now() }));
  return fresh;
}

/** 重试：延迟也走注入的 clock */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; clock: Clock },
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (attempt < opts.retries) await opts.clock.sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw last;
}

/** CLI 输出渲染：快照测试的理想对象 */
export function renderSummary(rows: ReadonlyArray<{ name: string; bytes: number }>): string {
  const lines = rows.map((r) => `  ${r.name.padEnd(12)} ${formatBytes(r.bytes)}`);
  return [`files: ${rows.length}`, ...lines].join('\n');
}

// ===========================================================================
// 二、测试
// ===========================================================================

// ---- 1. 断言基础：toBe / toEqual / toStrictEqual ----
describe('断言的三个层次', () => {
  it('toBe 是引用/Object.is 相等，toEqual 是结构相等', () => {
    const a = { id: 1, tags: ['x'] };
    const b = { id: 1, tags: ['x'] };
    expect(a).not.toBe(b); // 不同对象
    expect(a).toEqual(b); // 结构一样
    expect(a).toBe(a);

    expect(NaN).toBe(NaN); // ✅ toBe 用 Object.is，NaN 自等
    expect(0).not.toBe(-0); // 😱 但 0 和 -0 不相等（=== 会说相等）
  });

  it('toEqual 忽略 undefined 属性，toStrictEqual 不忽略', () => {
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 });
    // class 实例 vs 字面量：toEqual 只看字段，toStrictEqual 还要求原型一致
    class Size {
      constructor(readonly bytes: number) {}
    }
    expect(new Size(404)).toEqual({ bytes: 404 });
    expect(new Size(404)).not.toStrictEqual({ bytes: 404 });
    // 😱 例外：Error 对象有特殊待遇，toEqual 会连 name / message 一起比
    expect(new HttpError(404)).not.toEqual({ status: 404 });
    expect(new HttpError(404)).toEqual(new HttpError(404));
  });

  it('浮点数用 toBeCloseTo，永远不要 toBe', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
  });

  it('局部匹配：toMatchObject / expect.objectContaining / asymmetric matchers', () => {
    const resp = { id: 'u-1', createdAt: new Date(), profile: { name: 'jack', age: 30 } };
    expect(resp).toMatchObject({ profile: { name: 'jack' } });
    expect(resp).toEqual({
      id: expect.stringMatching(/^u-/),
      createdAt: expect.any(Date),
      profile: expect.objectContaining({ name: 'jack' }),
    });
    expect([1, 2, 3]).toEqual(expect.arrayContaining([3, 1]));
  });

  it('expect.soft：一次跑完所有断言，把全部失败一起报出来', () => {
    const r = renderSummary([{ name: 'a.ts', bytes: 2048 }]);
    expect.soft(r).toContain('files: 1');
    expect.soft(r).toContain('2KiB');
  });
});

// ---- 2. 异常与异步异常 ----
describe('异常断言', () => {
  it('同步：toThrow 支持类型 / 子串 / 正则', () => {
    const boom = (): never => {
      throw new HttpError(503);
    };
    expect(boom).toThrow(); // 抛了就行
    expect(boom).toThrow(HttpError); // 类型
    expect(boom).toThrow('HTTP 503'); // 消息包含
    expect(boom).toThrow(/^HTTP \d{3}$/); // 消息匹配
    // 想断言业务字段，用 try/catch 或 objectContaining
    expect(boom).toThrow(expect.objectContaining({ status: 503 }));
  });

  it('异步：必须 await，rejects 后面接普通匹配器', async () => {
    const failing = async (): Promise<never> => {
      throw new HttpError(500);
    };
    await expect(failing()).rejects.toThrow(HttpError);
    await expect(failing()).rejects.toMatchObject({ status: 500 });
    await expect(Promise.resolve(7)).resolves.toBe(7);
  });

  it('expect.assertions 防止"测试通过但断言没跑"', async () => {
    expect.assertions(2); // 本测试必须正好跑 2 个断言
    try {
      await Promise.reject(new HttpError(429));
      expect.unreachable('上面应该抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(429);
    }
  });
});

// ---- 3. 表驱动测试 ----
describe('表驱动（Go 的 table-driven test）', () => {
  // it.each：printf 风格占位符 %s %i %o %#
  it.each([
    [0, '0B'],
    [512, '512B'],
    [1024, '1KiB'],
    [1536, '1.5KiB'],
    [1024 ** 2, '1MiB'],
    [1024 ** 3, '1GiB'],
    [1024 ** 4, '1024GiB'], // 单位表到 GiB 就封顶了
  ])('formatBytes(%i) === %s', (input, want) => {
    expect(formatBytes(input)).toBe(want);
  });

  // test.for：每个用例一个对象，名字里用 $prop 插值，回调还能拿到 context
  test.for([
    { input: -1, why: '负数' },
    { input: NaN, why: 'NaN' },
    { input: Infinity, why: '无穷' },
  ])('formatBytes 拒绝 $why', ({ input }, { expect: e }) => {
    e(() => formatBytes(input)).toThrow(RangeError);
  });
});

// ---- 4. mock：vi.fn 是 Mockito 的 when().thenReturn() ----
describe('vi.fn / vi.spyOn', () => {
  it('vi.fn 造假实现 + 验证调用', async () => {
    // Java: when(store.get("k")).thenReturn(Optional.empty())
    const store: Store = {
      get: vi.fn<Store['get']>().mockResolvedValue(undefined),
      put: vi.fn<Store['put']>().mockResolvedValue(undefined),
    };
    const clock: Clock = { now: () => 1_000, sleep: vi.fn<Clock['sleep']>() };
    const fetcher = vi.fn<CacheDeps['fetcher']>().mockResolvedValue('fresh');

    const got = await readThrough('k', { store, clock, ttlMs: 60_000, fetcher });

    expect(got).toBe('fresh');
    // Java: verify(store).put("k", ...)
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith('k', JSON.stringify({ value: 'fresh', at: 1_000 }));
    expect(fetcher).toHaveBeenCalledWith('k');
    // 拿到原始调用参数自己断言（≈ Mockito 的 ArgumentCaptor）
    expect(vi.mocked(store.put).mock.calls[0]?.[0]).toBe('k');
  });

  it('缓存命中时不该回源', async () => {
    const cached = JSON.stringify({ value: 'old', at: 900 });
    const store: Store = {
      get: vi.fn<Store['get']>().mockResolvedValue(cached),
      put: vi.fn<Store['put']>().mockResolvedValue(undefined),
    };
    const fetcher = vi.fn<CacheDeps['fetcher']>();
    const got = await readThrough('k', {
      store,
      clock: { now: () => 1_000, sleep: vi.fn<Clock['sleep']>() },
      ttlMs: 1_000,
      fetcher,
    });
    expect(got).toBe('old');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('mockReturnValueOnce 排队返回不同值', () => {
    const next = vi.fn<() => string>().mockReturnValue('default');
    next.mockReturnValueOnce('first').mockReturnValueOnce('second');
    expect([next(), next(), next()]).toEqual(['first', 'second', 'default']);
  });

  it('vi.spyOn 保留真实对象，mockRestore 还原', () => {
    const svc = {
      version(): string {
        return '1.0.0';
      },
    };
    const spy = vi.spyOn(svc, 'version').mockReturnValue('9.9.9');
    expect(svc.version()).toBe('9.9.9');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
    expect(svc.version()).toBe('1.0.0');
  });

  afterEach(() => {
    // clearAllMocks 清调用记录 / resetAllMocks 还回原实现 / restoreAllMocks 撤销 spyOn
    vi.restoreAllMocks();
  });
});

// ---- 5. fake timers vs 注入时钟 ----
describe('时间相关：两种打法', () => {
  it('注入 clock（首选）：没有 fake timers，退避序列直接可断言', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const clock: Clock = {
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    };
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new HttpError(503));

    await expect(retry(fn, { retries: 3, baseDelayMs: 100, clock })).rejects.toThrow(HttpError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([100, 200, 400]); // 指数退避
    expect(clock.now()).toBe(700);
  });

  describe('vi.useFakeTimers（当代码里写死了 setTimeout 时）', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers(); // ⚠️ 忘了这行，后面所有测试都会被污染
    });

    it('advanceTimersByTimeAsync 才能推动 await 链', async () => {
      const log: string[] = [];
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
      const task = (async () => {
        await sleep(100);
        log.push('a');
        await sleep(100);
        log.push('b');
      })();

      vi.advanceTimersByTime(200); // ❌ 同步版本只能唤醒【已经注册】的定时器
      await Promise.resolve();
      expect(log).toEqual(['a']);

      await vi.advanceTimersByTimeAsync(200); // ✅ 异步版本会级联
      await task;
      expect(log).toEqual(['a', 'b']);
    });

    it('setSystemTime 冻结时钟，让含时间戳的输出可断言', () => {
      vi.setSystemTime(new Date('2024-03-01T12:00:00.000Z'));
      expect(new Date().toISOString()).toBe('2024-03-01T12:00:00.000Z');
      vi.advanceTimersByTime(1_500);
      expect(Date.now()).toBe(Date.parse('2024-03-01T12:00:01.500Z'));
    });
  });
});

// ---- 6. 生命周期与清理 ----
describe('生命周期', () => {
  let tmp = '';

  beforeAll(async () => {
    // 真实临时目录往往比 mock fs 更好：测的是真行为
    tmp = await mkdtemp(join(tmpdir(), 'ch10-demo-'));
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  let calls: string[] = [];
  beforeEach(() => {
    // ⚠️ 共享状态一定要在 beforeEach 里【重建】而不是复用，否则测试之间互相影响
    calls = [];
    return () => {
      // beforeEach 返回的函数会在测试后自动执行（比写 afterEach 更就近）
      calls.push('auto-cleanup');
    };
  });

  it('读写真实临时文件', async () => {
    const file = join(tmp, 'report.json');
    await writeFile(file, JSON.stringify({ ok: true }), 'utf8');
    // onTestFinished：只给这一个测试注册清理，成功失败都会跑
    onTestFinished(async () => {
      await rm(file, { force: true });
    });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true });
    calls.push('body');
    expect(calls).toEqual(['body']);
  });

  it('上一个测试的状态没有漏过来', () => {
    expect(calls).toEqual([]);
  });
});

// ---- 7. 快照测试 ----
describe('快照', () => {
  it('toMatchInlineSnapshot：小而稳定的输出，答案就写在测试里', () => {
    expect(renderSummary([
      { name: 'main.ts', bytes: 2048 },
      { name: 'util.ts', bytes: 512 },
    ])).toMatchInlineSnapshot(`
      "files: 2
        main.ts      2KiB
        util.ts      512B"
    `);
  });

  it('不稳定的部分要先洗掉再快照', () => {
    const raw = `[2024-03-01T12:00:00.000Z] wrote /tmp/x/out.json in 12ms`;
    const stable = raw
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, '<TIMESTAMP>')
      .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<PATH>')
      .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<DURATION>');
    expect(stable).toMatchInlineSnapshot(`"[<TIMESTAMP>] wrote <PATH> in <DURATION>"`);
  });

  it('错误消息也能快照', () => {
    expect(() => formatBytes(-1)).toThrowErrorMatchingInlineSnapshot(
      `[RangeError: formatBytes: bad input -1]`,
    );
  });
});

// ---- 8. 类型层面的测试 ----
describe('类型也要测（vitest 自带 expectTypeOf）', () => {
  it('签名不允许被悄悄改坏', () => {
    expectTypeOf(formatBytes).toBeFunction();
    expectTypeOf(formatBytes).parameters.toEqualTypeOf<[number]>();
    expectTypeOf(formatBytes).returns.toEqualTypeOf<string>();
    expectTypeOf<CacheDeps>().toHaveProperty('ttlMs');
    expectTypeOf(retry).returns.toEqualTypeOf<Promise<unknown>>();

    assertType<Clock>({ now: () => 0, sleep: async () => {} });
    // @ts-expect-error 缺少 sleep —— 这行本身就是一条断言：如果哪天它不报错了，tsc 会失败
    assertType<Clock>({ now: () => 0 });

    expect(true).toBe(true); // 让运行时也有一个断言
  });
});

// ---- 9. 自定义匹配器 ----
interface CustomMatchers<R = unknown> {
  toBeSameSizeAs(expected: number): R;
}
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = any> extends CustomMatchers<T> {}
}

expect.extend({
  toBeSameSizeAs(received: string, expected: number) {
    const pass = received === formatBytes(expected);
    return {
      pass,
      message: () => `expected ${received} ${pass ? 'not ' : ''}to render ${expected} bytes`,
    };
  },
});

it('自定义匹配器：把重复断言收成一个领域词汇', () => {
  expect(formatBytes(1024)).toBeSameSizeAs(1024);
  expect(formatBytes(1024)).not.toBeSameSizeAs(2048);
});
