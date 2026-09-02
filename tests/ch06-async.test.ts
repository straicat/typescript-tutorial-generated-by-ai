import { describe, it, expect } from 'vitest';
import {
  AbortError,
  TimeoutError,
  abortableDelay,
  allSettledSummary,
  createSerialQueue,
  debounceAsync,
  executionOrder,
  mapConcurrent,
  paginate,
  promisifyCallback,
  raceWithCleanup,
  retry,
  sleep,
  withTimeout,
} from '@exercises/ch06-async';
import type { NodeCallback, Page } from '@exercises/ch06-async';

/**
 * 测试里的延时统一用这个本地 helper，而不是被测的 sleep ——
 * 否则 6.1 没做完时其它题会跟着一起挂，看不出到底哪题错了。
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * 制造一个 rejected Promise，并预先挂一个空 catch。
 * 目的：在"函数还没实现"的红灯状态下，避免刷一屏 unhandledRejection 噪音。
 * （这本身就是本章的一个知识点：未处理的 rejection 会污染整个进程。）
 */
function rejected(reason: unknown): Promise<never> {
  const p = Promise.reject(reason);
  void p.catch(() => undefined);
  return p;
}

/** 取出 Promise 的 rejection 值，方便断言 name / 自定义字段。 */
async function catchError<E extends Error>(p: Promise<unknown>): Promise<E> {
  let captured: unknown;
  let didReject = false;
  try {
    await p;
  } catch (error) {
    didReject = true;
    captured = error;
  }
  if (!didReject) throw new Error('expected the promise to reject, but it resolved');
  return captured as E;
}

describe('6.1 sleep', () => {
  it('resolve 出 undefined（别把 setTimeout 的句柄 resolve 出去）', async () => {
    await expect(sleep(5)).resolves.toBeUndefined();
  });

  it('不阻塞后面的同步代码（对比 Thread.sleep）', async () => {
    const order: string[] = [];
    const p = sleep(10).then(() => {
      order.push('timer');
    });
    order.push('sync'); // sleep 之后的同步代码立刻就跑了
    await p;
    expect(order).toEqual(['sync', 'timer']);
  });

  it('短的先醒；0 和负数不报错', async () => {
    const winner = await Promise.race([sleep(40).then(() => 'slow'), sleep(1).then(() => 'fast')]);
    expect(winner).toBe('fast');
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-5)).resolves.toBeUndefined();
  });
});

describe('6.2 executionOrder', () => {
  it('同步 → 微任务 → 宏任务', async () => {
    await expect(executionOrder()).resolves.toEqual([
      'sync-1',
      'sync-2',
      'micro-1',
      'micro-2',
      'macro',
    ]);
  });

  it('同步代码永远排在最前面', async () => {
    const order = await executionOrder();
    expect(order.slice(0, 2)).toEqual(['sync-1', 'sync-2']);
  });

  it('setTimeout(fn, 0) 排在所有微任务之后，不是"立刻"', async () => {
    const order = await executionOrder();
    expect(order.at(-1)).toBe('macro');
    expect(order.indexOf('macro')).toBeGreaterThan(order.indexOf('micro-2'));
  });
});

describe('6.3 promisifyCallback', () => {
  it('回调 (null, value) → resolve', async () => {
    const add = (a: number, b: number, cb: NodeCallback<number>): void => {
      cb(null, a + b);
    };
    await expect(promisifyCallback(add)(1, 2)).resolves.toBe(3);
  });

  it('回调带 err → reject 原错误；undefined 也算"无错误"', async () => {
    const fail = (cb: NodeCallback<number>): void => {
      cb(new Error('boom'));
    };
    await expect(promisifyCallback(fail)()).rejects.toThrow('boom');

    const okWithUndefinedErr = (cb: NodeCallback<string>): void => {
      cb(undefined, 'fine');
    };
    await expect(promisifyCallback(okWithUndefinedErr)()).resolves.toBe('fine');
  });

  it('回调被调用多次时只有第一次生效（Promise 是一次性状态机）', async () => {
    const chatty = (cb: NodeCallback<number>): void => {
      cb(null, 1);
      cb(null, 2);
      cb(new Error('too late'));
    };
    await expect(promisifyCallback(chatty)()).resolves.toBe(1);
  });
});

describe('6.4 withTimeout', () => {
  it('没超时就原样返回结果', async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
  });

  it('超时抛 TimeoutError，带上 ms', async () => {
    const slow = delay(200).then(() => 'never');
    await expect(withTimeout(slow, 10)).rejects.toThrow(TimeoutError);
    await expect(withTimeout(delay(200).then(() => 'never'), 10)).rejects.toThrow(
      'timed out after 10ms',
    );
    const err = await catchError<TimeoutError>(withTimeout(delay(200).then(() => 'never'), 10));
    expect(err.name).toBe('TimeoutError');
    expect(err.ms).toBe(10);
  });

  it('原 Promise 自己失败时，抛原错误而不是 TimeoutError', async () => {
    await expect(withTimeout(rejected(new Error('boom')), 100)).rejects.toThrow('boom');
    const err = await catchError(withTimeout(rejected(new Error('boom')), 100));
    expect(err).not.toBeInstanceOf(TimeoutError);
  });
});

describe('6.5 allSettledSummary', () => {
  it('部分失败也要拿到成功的值（Promise.all 做不到）', async () => {
    const summary = await allSettledSummary<string>([
      Promise.resolve('a'),
      rejected(new Error('x')),
      Promise.resolve('b'),
    ]);
    expect(summary).toEqual({
      total: 3,
      values: ['a', 'b'],
      reasons: ['x'],
      ok: false,
    });
  });

  it('全部成功时 ok 为 true；空数组也是 ok', async () => {
    await expect(allSettledSummary([Promise.resolve(1), Promise.resolve(2)])).resolves.toEqual({
      total: 2,
      values: [1, 2],
      reasons: [],
      ok: true,
    });
    await expect(allSettledSummary<number>([])).resolves.toEqual({
      total: 0,
      values: [],
      reasons: [],
      ok: true,
    });
  });

  it('reject 的不是 Error 时用 String() 兜住（JS 允许 throw 任何值）', async () => {
    const summary = await allSettledSummary<string>([rejected('plain string'), rejected(404)]);
    expect(summary.reasons).toEqual(['plain string', '404']);
    expect(summary.ok).toBe(false);
  });
});

describe('6.6 abortableDelay', () => {
  it('不传 signal 时就是普通延时', async () => {
    await expect(abortableDelay(5)).resolves.toBeUndefined();
  });

  it('传入已经 aborted 的 signal 要【立刻】失败，不能白等', async () => {
    const started = Date.now();
    await expect(abortableDelay(2000, AbortSignal.abort())).rejects.toThrow(AbortError);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('中途 abort → reject AbortError，且不等满 ms', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const p = abortableDelay(2000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    const err = await catchError(p);
    expect(err.name).toBe('AbortError');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('已经成功之后再 abort，结果不受影响', async () => {
    const controller = new AbortController();
    await expect(abortableDelay(1, controller.signal)).resolves.toBeUndefined();
    controller.abort();
    await delay(5); // 给"迟到的 reject"一个机会；不该有任何影响
  });
});

describe('6.7 retry', () => {
  it('指数退避：注入 sleep 记录每次等待时长', async () => {
    const delays: number[] = [];
    const attempts: number[] = [];

    const value = await retry(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error(`fail-${attempt}`);
        return `ok-${attempt}`;
      },
      {
        retries: 5,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(value).toBe('ok-3');
    expect(attempts).toEqual([1, 2, 3]); // attempt 从 1 开始
    expect(delays).toEqual([100, 200]); // 100 * 2^0, 100 * 2^1
  });

  it('全部失败时抛最后一个错误，且最后一次失败后不再 sleep', async () => {
    const delays: number[] = [];
    let calls = 0;

    await expect(
      retry(
        async (attempt) => {
          calls += 1;
          throw new Error(`fail-${attempt}`);
        },
        {
          retries: 2,
          baseDelayMs: 10,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow('fail-3');

    expect(calls).toBe(3); // retries + 1 次尝试
    expect(delays).toEqual([10, 20]); // 只在尝试【之间】等待，共 2 次
  });

  it('factor / maxDelayMs / jitter 都生效', async () => {
    const delays: number[] = [];
    await expect(
      retry(
        async () => {
          throw new Error('always');
        },
        {
          retries: 4,
          baseDelayMs: 100,
          factor: 3,
          maxDelayMs: 500,
          jitter: (d) => d + 1, // 确定性"抖动"，方便断言
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow('always');
    // raw: 100, 300, 900→500, 2700→500；再各 +1
    expect(delays).toEqual([101, 301, 501, 501]);
  });

  it('shouldRetry 返回 false 时立即放弃', async () => {
    const delays: number[] = [];
    let calls = 0;

    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error('400 bad request');
        },
        {
          retries: 5,
          baseDelayMs: 10,
          shouldRetry: (error) => !(error instanceof Error && error.message.startsWith('400')),
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow('400 bad request');

    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });
});

describe('6.8 mapConcurrent', () => {
  it('结果顺序按输入顺序，不是完成顺序', async () => {
    const out = await mapConcurrent([30, 1, 15], 3, async (ms) => {
      await delay(ms);
      return `t${ms}`;
    });
    expect(out).toEqual(['t30', 't1', 't15']);
  });

  it('同时在跑的任务数严格不超过 limit', async () => {
    let active = 0;
    let max = 0;

    const out = await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      max = Math.max(max, active);
      await delay(5);
      active -= 1;
      return n * 10;
    });

    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(max).toBe(2); // Promise.all(items.map(fn)) 会得到 6
  });

  it('limit <= 0 当 1 处理；limit 超过任务数时不会凭空多开 worker', async () => {
    let active = 0;
    let maxSerial = 0;
    await mapConcurrent([1, 2, 3], 0, async (n) => {
      active += 1;
      maxSerial = Math.max(maxSerial, active);
      await delay(2);
      active -= 1;
      return n;
    });
    expect(maxSerial).toBe(1);

    let maxWide = 0;
    active = 0;
    await mapConcurrent([1, 2, 3], 10, async (n) => {
      active += 1;
      maxWide = Math.max(maxWide, active);
      await delay(2);
      active -= 1;
      return n;
    });
    expect(maxWide).toBe(3);
  });

  it('空输入不调用 fn；任一任务失败则整体 reject', async () => {
    let calls = 0;
    await expect(
      mapConcurrent([], 5, async (n: number) => {
        calls += 1;
        return n;
      }),
    ).resolves.toEqual([]);
    expect(calls).toBe(0);

    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        await delay(2);
        if (n === 2) throw new Error('item 2 failed');
        return n;
      }),
    ).rejects.toThrow('item 2 failed');
  });
});

describe('6.9 createSerialQueue', () => {
  it('串行队列消除"检查再写入"的交错（不排队会写重）', async () => {
    const makeUpsert = (
      rows: string[],
    ): ((name: string) => Promise<void>) => async (name: string): Promise<void> => {
      const exists = rows.includes(name);
      await delay(5); // 😱 就是这个 await 制造了交错窗口
      if (!exists) rows.push(name);
    };

    // ① 不串行化：单线程也照样写重了
    const naiveRows: string[] = [];
    const naiveUpsert = makeUpsert(naiveRows);
    await Promise.all([naiveUpsert('a'), naiveUpsert('a')]);
    expect(naiveRows).toEqual(['a', 'a']);

    // ② 用队列把临界区排起来：只写一条
    const queuedRows: string[] = [];
    const queuedUpsert = makeUpsert(queuedRows);
    const queue = createSerialQueue();
    await Promise.all([queue.run(() => queuedUpsert('a')), queue.run(() => queuedUpsert('a'))]);
    expect(queuedRows).toEqual(['a']);
  });

  it('FIFO 顺序执行，任务内部不会互相插队，pending 计数正确', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];

    const a = queue.run(async () => {
      log.push('a1');
      await delay(10);
      log.push('a2');
      return 'A';
    });
    const b = queue.run(async () => {
      log.push('b1');
      await delay(1);
      log.push('b2');
      return 'B';
    });

    expect(queue.pending).toBe(2);
    await expect(Promise.all([a, b])).resolves.toEqual(['A', 'B']);
    expect(log).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(queue.pending).toBe(0);
  });

  it('某个任务抛错不会卡死队列', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];

    const bad = queue.run(async () => {
      log.push('bad');
      throw new Error('task failed');
    });
    const good = queue.run(async () => {
      log.push('good');
      return 1;
    });

    await Promise.all([
      expect(bad).rejects.toThrow('task failed'),
      expect(good).resolves.toBe(1),
    ]);
    expect(log).toEqual(['bad', 'good']);
    expect(queue.pending).toBe(0);
  });
});

describe('6.10 raceWithCleanup', () => {
  it('最快的赢，并且把输家的 signal abort 掉（Promise.race 做不到）', async () => {
    let loserAborted = false;

    const result = await raceWithCleanup<string>([
      async () => {
        await delay(1);
        return 'fast';
      },
      async (signal) => {
        signal.addEventListener('abort', () => {
          loserAborted = true;
        });
        await new Promise<void>(() => undefined); // 永不 settle
        return 'slow';
      },
    ]);

    expect(result).toBe('fast');
    expect(loserAborted).toBe(true);
  });

  it('第一个 reject 也算 settle，同样要清理其它任务', async () => {
    let loserAborted = false;

    await expect(
      raceWithCleanup<string>([
        async () => {
          await delay(1);
          throw new Error('fast failure');
        },
        async (signal) => {
          signal.addEventListener('abort', () => {
            loserAborted = true;
          });
          await new Promise<void>(() => undefined);
          return 'slow';
        },
      ]),
    ).rejects.toThrow('fast failure');

    expect(loserAborted).toBe(true);
  });

  it('空任务列表 reject；同步抛错也要变成 reject', async () => {
    await expect(raceWithCleanup<string>([])).rejects.toThrow('no tasks');
    await expect(
      raceWithCleanup<string>([
        () => {
          throw new Error('sync boom');
        },
      ]),
    ).rejects.toThrow('sync boom');
  });
});

describe('6.11 paginate', () => {
  const pages: Array<Page<string>> = [
    { items: ['a', 'b'], nextCursor: '1' },
    { items: ['c'], nextCursor: '2' },
    { items: ['d'] },
  ];

  function makeFetcher(source: Array<Page<string>>): {
    fetchPage: (cursor: string | undefined) => Promise<Page<string>>;
    cursors: Array<string | undefined>;
  } {
    const cursors: Array<string | undefined> = [];
    const fetchPage = async (cursor: string | undefined): Promise<Page<string>> => {
      cursors.push(cursor);
      await delay(1);
      const page = source[cursor === undefined ? 0 : Number(cursor)];
      if (page === undefined) throw new Error(`no such page: ${String(cursor)}`);
      return page;
    };
    return { fetchPage, cursors };
  }

  it('把多页拼成一个扁平的异步序列，首次 cursor 是 undefined', async () => {
    const { fetchPage, cursors } = makeFetcher(pages);
    const got: string[] = [];
    for await (const item of paginate(fetchPage)) got.push(item);

    expect(got).toEqual(['a', 'b', 'c', 'd']);
    expect(cursors).toEqual([undefined, '1', '2']);
  });

  it('惰性拉取：调用方 break 之后不会再发请求', async () => {
    const { fetchPage, cursors } = makeFetcher(pages);
    const got: string[] = [];
    for await (const item of paginate(fetchPage)) {
      got.push(item);
      if (got.length === 2) break;
    }

    expect(got).toEqual(['a', 'b']);
    expect(cursors).toEqual([undefined]); // 只请求了第一页
  });

  it('单页 / 空页边界', async () => {
    const single = makeFetcher([{ items: ['only'] }]);
    const got: string[] = [];
    for await (const item of paginate(single.fetchPage)) got.push(item);
    expect(got).toEqual(['only']);

    const empty = makeFetcher([{ items: [] }]);
    const none: string[] = [];
    for await (const item of paginate(empty.fetchPage)) none.push(item);
    expect(none).toEqual([]);
    expect(empty.cursors).toEqual([undefined]);
  });
});

describe('6.12 debounceAsync', () => {
  it('密集调用合并成一次，用最后一次的参数，所有调用方共享结果', async () => {
    const calls: number[] = [];
    const debounced = debounceAsync(async (n: number) => {
      calls.push(n);
      return n * 2;
    }, 20);

    const results = await Promise.all([debounced(1), debounced(2), debounced(3)]);

    expect(calls).toEqual([3]);
    expect(results).toEqual([6, 6, 6]);
  });

  it('一轮结束后再调用会开启新的一轮', async () => {
    const calls: number[] = [];
    const debounced = debounceAsync(async (n: number) => {
      calls.push(n);
      return n * 2;
    }, 20);

    await Promise.all([debounced(1), debounced(2)]);
    await expect(debounced(9)).resolves.toBe(18);
    expect(calls).toEqual([2, 9]);
  });

  it('fn 失败时，所有等待中的调用方都 reject 同一个错误', async () => {
    const debounced = debounceAsync(async (): Promise<number> => {
      throw new Error('boom');
    }, 10);

    const p1 = debounced();
    const p2 = debounced();
    // 两个断言同时挂上处理器，避免制造"暂时未处理的 rejection"
    await Promise.all([
      expect(p1).rejects.toThrow('boom'),
      expect(p2).rejects.toThrow('boom'),
    ]);
  });

  it('cancel() 让等待中的调用方 reject AbortError，而不是永远挂着', async () => {
    const calls: number[] = [];
    const debounced = debounceAsync(async (n: number) => {
      calls.push(n);
      return n;
    }, 50);

    const p = debounced(1);
    debounced.cancel();

    const err = await catchError(p);
    expect(err).toBeInstanceOf(AbortError);
    expect(err.name).toBe('AbortError');

    await delay(80);
    expect(calls).toEqual([]); // 被取消的那次不该再执行
  });
});
