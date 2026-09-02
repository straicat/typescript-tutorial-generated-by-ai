import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  once,
  formatDuration,
  collectAsync,
  createSpy,
  assertThrows,
  createInMemoryFs,
  saveReport,
  deepEqual,
  sanitizeSnapshot,
  createStubClock,
  debounce,
  retryWithClock,
  createMiniRunner,
} from '@exercises/ch10-testing';

describe('10.1 once', () => {
  it('只执行一次，之后返回缓存值', () => {
    // vi.fn() 就是练习 10.4 里你要手写的那个东西
    const impl = vi.fn(() => 42);
    const f = once(impl);
    expect(f()).toBe(42);
    expect(f()).toBe(42);
    expect(f()).toBe(42);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('返回对象时，多次调用拿到的是【同一个引用】（toBe 而不是 toEqual）', () => {
    const f = once(() => ({ id: 1 }));
    const a = f();
    const b = f();
    expect(a).toBe(b); // 引用相等：证明真的缓存了
    expect(a).toEqual({ id: 1 }); // 结构相等：只能证明内容一样
  });

  it('第一次抛错后，缓存错误并原样重抛，不重试', () => {
    const boom = vi.fn(() => {
      throw new Error('init failed');
    });
    const f = once(boom);
    const e1 = assertThrowsRaw(f);
    const e2 = assertThrowsRaw(f);
    expect(e1).toBe(e2); // 同一个 Error 实例
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

/** 测试内部用的小工具（不是练习内容）：跑一个必抛错的函数并把错误捞出来 */
function assertThrowsRaw(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected to throw');
}

describe('10.2 formatDuration', () => {
  // 表驱动测试：Go 的 table-driven test 在 TS 里就长这样
  it.each([
    [0, '0ms'],
    [1, '1ms'],
    [999, '999ms'],
    [1000, '1s'],
    [1500, '1.5s'],
    [1050, '1.1s'],
    [1999, '2s'],
    [59_999, '60s'],
    [60_000, '1m'],
    [90_000, '1m30s'],
    [3_599_000, '59m59s'],
    [3_600_000, '1h'],
    [7_500_000, '2h5m'],
    [7_200_000, '2h'],
  ])('formatDuration(%i) === %s', (ms, want) => {
    expect(formatDuration(ms)).toBe(want);
  });

  it('小数向下取整', () => {
    expect(formatDuration(999.9)).toBe('999ms');
    expect(formatDuration(1000.7)).toBe('1s');
  });

  it('非法输入抛 RangeError（NaN 不能靠 ms < 0 挡住）', () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(NaN)).toThrow(RangeError);
    expect(() => formatDuration(Infinity)).toThrow(RangeError);
  });
});

describe('10.3 collectAsync', () => {
  it('收集异步生成器的全部产出', async () => {
    async function* gen(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    await expect(collectAsync(gen())).resolves.toEqual([1, 2, 3]);
  });

  it('空源返回空数组', async () => {
    async function* empty(): AsyncGenerator<string> {
      // 什么都不产出
    }
    expect(await collectAsync(empty())).toEqual([]);
  });

  it('源抛错时不要吞掉（必须 await/rejects，否则断言根本不会跑）', async () => {
    async function* boom(): AsyncGenerator<number> {
      yield 1;
      throw new Error('stream broken');
    }
    await expect(collectAsync(boom())).rejects.toThrow('stream broken');
  });
});

describe('10.4 createSpy', () => {
  it('记录参数与返回值', () => {
    const spy = createSpy<[string, number], string>((s, n) => s.repeat(n));
    expect(spy('ab', 2)).toBe('abab');
    expect(spy('x', 3)).toBe('xxx');

    expect(spy.callCount()).toBe(2);
    expect(spy.calls).toEqual([
      ['ab', 2],
      ['x', 3],
    ]);
    expect(spy.lastCall()).toEqual(['x', 3]);
    expect(spy.records[0]).toEqual({
      args: ['ab', 2],
      outcome: { type: 'return', value: 'abab' },
    });
  });

  it('没有 impl 时返回 undefined，但依然记录调用', () => {
    const spy = createSpy<[number]>();
    expect(spy(1)).toBeUndefined();
    expect(spy.callCount()).toBe(1);
    expect(spy.lastCall()).toEqual([1]);
  });

  it('impl 抛错：先记录 throw，再把错误抛出去', () => {
    const spy = createSpy<[], number>(() => {
      throw new Error('nope');
    });
    expect(() => spy()).toThrow('nope');
    expect(spy.callCount()).toBe(1);
    expect(spy.records[0]?.outcome.type).toBe('throw');
  });

  it('reset 只清历史，不清 impl（这就是 mockClear vs mockReset）', () => {
    const spy = createSpy<[], number>(() => 7);
    spy();
    spy.reset();
    expect(spy.callCount()).toBe(0);
    expect(spy.lastCall()).toBeUndefined();
    expect(spy()).toBe(7); // impl 还在
  });
});

describe('10.5 assertThrows', () => {
  class HttpError extends Error {
    constructor(readonly status: number) {
      super(`http ${status}`);
      this.name = 'HttpError';
    }
  }

  it('匹配成功时把 error 返回出来', () => {
    const e = assertThrows(() => {
      throw new HttpError(503);
    }, HttpError);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(503);
  });

  it('支持 string（子串）/ RegExp / 谓词三种 matcher', () => {
    const boom = (): never => {
      throw new Error('connection reset by peer');
    };
    expect(assertThrows(boom, 'reset')).toBeInstanceOf(Error);
    expect(assertThrows(boom, /reset by \w+/)).toBeInstanceOf(Error);
    expect(assertThrows(boom, (e) => e instanceof Error && e.message.length > 5)).toBeInstanceOf(
      Error,
    );
  });

  it('没抛错 / matcher 不匹配时，自己抛出可辨认的错误', () => {
    expect(() => assertThrows(() => 1)).toThrow(/^expected function to throw/);
    expect(() =>
      assertThrows(() => {
        throw new Error('abc');
      }, 'xyz'),
    ).toThrow(/^thrown error did not match/);
    expect(() =>
      assertThrows(() => {
        throw new Error('abc');
      }, HttpError),
    ).toThrow(/^thrown error did not match/);
  });

  it('能处理 `throw undefined`（不能靠 error !== undefined 判断抛没抛）', () => {
    const e = assertThrows(() => {
      // eslint 会骂，但这是合法 JS，测试就得覆盖它
      throw undefined;
    });
    expect(e).toBeUndefined();
  });
});

describe('10.6 createInMemoryFs + saveReport', () => {
  it('内存假 fs 的基本读写', async () => {
    const fs = createInMemoryFs({ '/a.txt': 'hello' });
    expect(await fs.exists('/a.txt')).toBe(true);
    expect(await fs.exists('/b.txt')).toBe(false);
    expect(await fs.readFile('/a.txt')).toBe('hello');

    await fs.writeFile('/b.txt', 'world');
    expect(fs.snapshot()).toEqual({ '/a.txt': 'hello', '/b.txt': 'world' });
  });

  it('读不存在的文件时 reject，消息包含 ENOENT', async () => {
    const fs = createInMemoryFs();
    await expect(fs.readFile('/missing')).rejects.toThrow(/ENOENT/);
  });

  it('saveReport 在新路径上直接写（依赖注入：没有 mock，没有临时目录）', async () => {
    const fs = createInMemoryFs();
    await saveReport(fs, '/report.json', { ok: true, items: [1] });
    expect(fs.snapshot()).toEqual({
      '/report.json': JSON.stringify({ ok: true, items: [1] }, null, 2),
    });
  });

  it('saveReport 覆盖已有文件时先备份到 .bak', async () => {
    const fs = createInMemoryFs({ '/report.json': 'OLD' });
    await saveReport(fs, '/report.json', { ok: false });
    expect(fs.snapshot()).toEqual({
      '/report.json': JSON.stringify({ ok: false }, null, 2),
      '/report.json.bak': 'OLD',
    });
  });
});

describe('10.7 deepEqual', () => {
  it('嵌套结构相等（这就是 toEqual 做的事）', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(deepEqual([], [])).toBe(true);
    expect(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true); // 键顺序无关
  });

  it('原始值用 Object.is 语义：NaN 相等，0 和 -0 不相等', () => {
    expect(deepEqual(NaN, NaN)).toBe(true); // NaN === NaN 是 false！
    expect(deepEqual(0, -0)).toBe(false); // 0 === -0 是 true！
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
  });

  it('undefined 值的键也算键（toEqual 与 toStrictEqual 的分歧点）', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual({ a: undefined }, { a: undefined })).toBe(true);
  });

  it('Date 比时间戳；数组和对象永不相等', () => {
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true);
    expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false);
    expect(deepEqual(new Date('nope'), new Date('nope'))).toBe(true); // 两个 Invalid Date
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('循环引用不能栈溢出', () => {
    interface Node {
      name: string;
      self?: Node;
    }
    const x: Node = { name: 'x' };
    x.self = x;
    const y: Node = { name: 'x' };
    y.self = y;
    expect(deepEqual(x, y)).toBe(true);

    const z: Node = { name: 'z' };
    z.self = z;
    expect(deepEqual(x, z)).toBe(false);
  });
});

describe('10.8 sanitizeSnapshot', () => {
  it('替换时间戳 / 耗时 / 绝对路径 / UUID', () => {
    expect(
      sanitizeSnapshot('[2024-03-01T12:34:56.789Z] ok in 1.5s -> /home/j/out/r.json'),
    ).toBe('[<TIMESTAMP>] ok in <DURATION> -> <PATH>');
    expect(sanitizeSnapshot('timeout after 30000ms')).toBe('timeout after <DURATION>');
    expect(sanitizeSnapshot('id=3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('id=<UUID>');
    expect(sanitizeSnapshot('id=3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe('id=<UUID>');
  });

  it('多处出现时全部替换（记得加 g 标志）', () => {
    expect(sanitizeSnapshot('a 1ms b 2s c 300ms')).toBe('a <DURATION> b <DURATION> c <DURATION>');
  });

  it('相对路径和单段绝对路径不动', () => {
    expect(sanitizeSnapshot('see docs/01.md')).toBe('see docs/01.md');
    expect(sanitizeSnapshot('cd /tmp')).toBe('cd /tmp');
  });

  it('替换后的输出是幂等的（跑两遍结果一样）', () => {
    const raw = '[2024-03-01T00:00:00Z] /a/b/c took 12ms';
    const once = sanitizeSnapshot(raw);
    expect(sanitizeSnapshot(once)).toBe(once);
  });
});

describe('10.9 createStubClock', () => {
  it('now 从 startMs 开始，advance 推进时间', async () => {
    const clock = createStubClock(1000);
    expect(clock.now()).toBe(1000);
    await clock.advance(500);
    expect(clock.now()).toBe(1500);
  });

  it('sleep 被 advance 唤醒', async () => {
    const clock = createStubClock();
    let woke = false;
    const p = clock.sleep(100).then(() => {
      woke = true;
    });
    expect(woke).toBe(false);
    expect(clock.pending()).toBe(1);
    await clock.advance(100);
    await p;
    expect(woke).toBe(true);
    expect(clock.pending()).toBe(0);
  });

  it('时间不够时不唤醒', async () => {
    const clock = createStubClock();
    let woke = false;
    void clock.sleep(100).then(() => {
      woke = true;
    });
    await clock.advance(99);
    expect(woke).toBe(false);
    expect(clock.now()).toBe(99);
  });

  it('连续的 await sleep 链能在一次 advance 里级联跑完', async () => {
    const clock = createStubClock();
    const log: number[] = [];
    const task = (async () => {
      await clock.sleep(100);
      log.push(1);
      await clock.sleep(100);
      log.push(2);
    })();

    await clock.advance(100);
    expect(log).toEqual([1]); // 第二个 sleep 是醒来后才注册的
    await clock.advance(100);
    expect(log).toEqual([1, 2]);
    await task;

    const clock2 = createStubClock();
    const log2: number[] = [];
    const task2 = (async () => {
      await clock2.sleep(100);
      log2.push(1);
      await clock2.sleep(100);
      log2.push(2);
    })();
    await clock2.advance(200); // 一步到位也要能跑完
    await task2;
    expect(log2).toEqual([1, 2]);
    expect(clock2.now()).toBe(200);
  });

  it('负数参数抛 RangeError', async () => {
    const clock = createStubClock();
    expect(() => clock.sleep(-1)).toThrow(RangeError);
    await expect(clock.advance(-1)).rejects.toThrow(RangeError);
  });
});

describe('10.10 debounce', () => {
  it('只在最后一次调用之后 ms 毫秒触发一次', async () => {
    const clock = createStubClock();
    const spy = createSpy<[string]>();
    const d = debounce(spy, 100, clock);

    d('a');
    await clock.advance(50);
    d('b');
    await clock.advance(50);
    expect(spy.callCount()).toBe(0); // 距 'b' 只过了 50ms

    await clock.advance(50);
    expect(spy.calls).toEqual([['b']]); // 用最后一次的参数，且只触发一次
  });

  it('单次调用正常触发', async () => {
    const clock = createStubClock();
    const spy = createSpy<[number, number]>();
    const d = debounce(spy, 10, clock);
    d(1, 2);
    await clock.advance(10);
    expect(spy.calls).toEqual([[1, 2]]);
  });

  it('两轮之间间隔足够时会触发两次', async () => {
    const clock = createStubClock();
    const spy = createSpy<[string]>();
    const d = debounce(spy, 10, clock);
    d('one');
    await clock.advance(10);
    d('two');
    await clock.advance(10);
    expect(spy.calls).toEqual([['one'], ['two']]);
  });

  it('ms 为负数抛 RangeError', () => {
    const clock = createStubClock();
    expect(() => debounce(() => {}, -1, clock)).toThrow(RangeError);
  });
});

describe('10.11 retryWithClock', () => {
  it('第一次就成功时不睡觉、不重试', async () => {
    const clock = createStubClock();
    const attempts: number[] = [];
    const result = await retryWithClock(
      async (attempt) => {
        attempts.push(attempt);
        return 'ok';
      },
      { retries: 3, baseDelayMs: 100, clock },
    );
    expect(result).toBe('ok');
    expect(attempts).toEqual([1]);
    expect(clock.now()).toBe(0);
  });

  it('退避时间序列是 100 / 200 / 400（指数）', async () => {
    const clock = createStubClock();
    const seenAt: number[] = [];
    const p = retryWithClock(
      async (attempt) => {
        seenAt.push(clock.now());
        throw new Error(`fail ${attempt}`);
      },
      { retries: 3, baseDelayMs: 100, clock },
    );
    // ⚠️ 先把断言挂上（它内部会给 p 装 catch 处理器），再推进时钟。
    // 反过来写的话，p 会在 advance 期间就 reject 而当时还没人处理，
    // Node 报 unhandled rejection，vitest 4 会把整个文件标红（测试却"通过"）。
    const rejected = expect(p).rejects.toThrow('fail 4'); // 抛的是最后一次的错误
    await clock.advance(10_000);
    await rejected;
    expect(seenAt).toEqual([0, 100, 300, 700]);
  });

  it('中途成功就停下来', async () => {
    const clock = createStubClock();
    let calls = 0;
    const p = retryWithClock(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return calls;
      },
      { retries: 5, baseDelayMs: 50, clock },
    );
    await clock.advance(10_000);
    await expect(p).resolves.toBe(3);
    expect(calls).toBe(3);
    expect(clock.pending()).toBe(0);
  });

  it('retries 为 0 时只尝试一次', async () => {
    const clock = createStubClock();
    let calls = 0;
    const p = retryWithClock(
      async () => {
        calls += 1;
        throw new Error('boom');
      },
      { retries: 0, baseDelayMs: 100, clock },
    );
    await expect(p).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });

  it('非法参数抛 RangeError', async () => {
    const clock = createStubClock();
    await expect(
      retryWithClock(async () => 1, { retries: -1, baseDelayMs: 10, clock }),
    ).rejects.toThrow(RangeError);
    await expect(
      retryWithClock(async () => 1, { retries: 1, baseDelayMs: -10, clock }),
    ).rejects.toThrow(RangeError);
  });
});

describe('10.12 createMiniRunner', () => {
  it('按注册顺序串行执行，并归一化结果', async () => {
    const runner = createMiniRunner();
    runner.test('ok', () => {});
    runner.test('bad', () => {
      throw new Error('boom');
    });
    runner.skip('later');

    expect(await runner.run()).toEqual([
      { name: 'ok', status: 'pass' },
      { name: 'bad', status: 'fail', error: 'boom' },
      { name: 'later', status: 'skip' },
    ]);
  });

  it('串行而不是并发（异步测试也要一个个跑完）', async () => {
    const order: string[] = [];
    const runner = createMiniRunner();
    runner.test('a', async () => {
      order.push('a-start');
      await Promise.resolve();
      order.push('a-end');
    });
    runner.test('b', async () => {
      order.push('b-start');
      await Promise.resolve();
      order.push('b-end');
    });
    await runner.run();
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('hooks 的执行顺序与 skip 的跳过行为', async () => {
    const log: string[] = [];
    const runner = createMiniRunner({
      beforeEach: () => {
        log.push('before');
      },
      afterEach: () => {
        log.push('after');
      },
    });
    runner.test('t1', () => {
      log.push('t1');
    });
    runner.skip('t2');
    runner.test('t3', () => {
      log.push('t3');
    });
    await runner.run();
    // skip 的测试不跑 hook
    expect(log).toEqual(['before', 't1', 'after', 'before', 't3', 'after']);
  });

  it('测试失败时 afterEach 仍然执行（try/finally）', async () => {
    const log: string[] = [];
    const runner = createMiniRunner({
      afterEach: () => {
        log.push('cleanup');
      },
    });
    runner.test('bad', () => {
      throw new Error('x');
    });
    const results = await runner.run();
    expect(results[0]?.status).toBe('fail');
    expect(log).toEqual(['cleanup']);
  });

  it('beforeEach 抛错：跳过测试体、加前缀、afterEach 照跑', async () => {
    const log: string[] = [];
    const runner = createMiniRunner({
      beforeEach: () => {
        throw new Error('db down');
      },
      afterEach: () => {
        log.push('cleanup');
      },
    });
    runner.test('t', () => {
      log.push('body');
    });
    expect(await runner.run()).toEqual([
      { name: 't', status: 'fail', error: 'beforeEach: db down' },
    ]);
    expect(log).toEqual(['cleanup']); // body 没跑
  });

  it('afterEach 抛错：测试体成功时算 fail；测试体已失败时保留原错误', async () => {
    const runner = createMiniRunner({
      afterEach: () => {
        throw new Error('leak');
      },
    });
    runner.test('good', () => {});
    runner.test('bad', () => {
      throw new Error('原始错误');
    });
    expect(await runner.run()).toEqual([
      { name: 'good', status: 'fail', error: 'afterEach: leak' },
      { name: 'bad', status: 'fail', error: '原始错误' },
    ]);
  });

  it('抛出非 Error 的值也要归一化成字符串', async () => {
    const runner = createMiniRunner();
    runner.test('str', () => {
      throw 'plain string';
    });
    runner.test('num', () => {
      throw 42;
    });
    expect(await runner.run()).toEqual([
      { name: 'str', status: 'fail', error: 'plain string' },
      { name: 'num', status: 'fail', error: '42' },
    ]);
  });

  it('run 可以反复调用，每次都完整重跑', async () => {
    let n = 0;
    const runner = createMiniRunner();
    runner.test('count', () => {
      n += 1;
    });
    await runner.run();
    await runner.run();
    expect(n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 附：本项目 globals: false，所以上面每个 API 都得显式 import。
// 下面这段演示 vitest 自己的 fake timers —— 和练习 10.9 的手写时钟对比着看。
// ---------------------------------------------------------------------------
describe('附录 · vitest fake timers（与 10.9 的注入时钟对照）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers(); // 忘了这行会污染后面所有测试
  });

  it('advanceTimersByTimeAsync 才能推动 await 链', async () => {
    // 顺手用一下练习 10.4 手写的 spy —— 它和 vi.fn() 在这里可以互换
    const record = createSpy<[number]>();
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
    const task = (async () => {
      await sleep(100);
      record(1);
      await sleep(100);
      record(2);
    })();

    vi.advanceTimersByTime(200); // 同步版本推不动第二段
    await Promise.resolve();
    expect(record.calls).toEqual([[1]]);

    await vi.advanceTimersByTimeAsync(200);
    await task;
    expect(record.calls).toEqual([[1], [2]]);
  });

  it('setSystemTime 冻结 Date.now，让含时间戳的输出可断言', () => {
    vi.setSystemTime(new Date('2024-03-01T12:34:56.789Z'));
    const line = `[${new Date().toISOString()}] done in ${formatDuration(1500)}`;
    expect(line).toBe('[2024-03-01T12:34:56.789Z] done in 1.5s');
    expect(sanitizeSnapshot(line)).toBe('[<TIMESTAMP>] done in <DURATION>');
  });
});
