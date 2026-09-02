import { describe, it, expect } from 'vitest';
import {
  compose,
  pipeAll,
  curry3,
  once,
  memoize,
  throttle,
  withRetry,
  Greeter,
  BoundedStack,
  ReportFormatter,
  CsvFormatter,
  JsonLinesFormatter,
  AppError,
  NotFoundError,
  describeError,
  InMemoryUserRepository,
} from '@exercises/ch04-functions-oop';

describe('4.1 compose', () => {
  it('从右往左执行：先 f 再 g，类型 A -> B -> C', () => {
    const shout = compose(
      (s: string) => `${s}!`,
      (n: number) => String(n),
    );
    expect(shout(41)).toBe('41!');
  });

  it('顺序反了结果就不同（证明不是随便调的）', () => {
    const inc = (n: number) => n + 1;
    const double = (n: number) => n * 2;
    expect(compose(inc, double)(3)).toBe(7); // 3*2 then +1
    expect(compose(double, inc)(3)).toBe(8); // 3+1 then *2
  });
});

describe('4.2 pipeAll', () => {
  it('从左往右依次执行', () => {
    const slugify = pipeAll<string>(
      (s) => s.trim(),
      (s) => s.toLowerCase(),
      (s) => s.replaceAll(' ', '-'),
    );
    expect(slugify('  Hello World ')).toBe('hello-world');
  });

  it('顺序与 compose 相反', () => {
    expect(pipeAll<number>((n) => n + 1, (n) => n * 2)(3)).toBe(8);
    expect(pipeAll<number>((n) => n * 2, (n) => n + 1)(3)).toBe(7);
  });

  it('零个步骤时是恒等函数（边界）', () => {
    expect(pipeAll<number>()(7)).toBe(7);
    expect(pipeAll<string>()('')).toBe('');
  });
});

describe('4.3 curry3', () => {
  it('三层调用等价于原函数', () => {
    const add = (a: number, b: number, c: number): number => a + b + c;
    expect(curry3(add)(1)(2)(3)).toBe(6);
    const join = (a: string, b: string, c: number): string => `${a}${b}${c}`;
    expect(curry3(join)('a')('b')(1)).toBe('ab1');
  });

  it('中间结果可以保存下来反复复用（偏应用）', () => {
    const add = (a: number, b: number, c: number): number => a + b + c;
    const add1 = curry3(add)(1);
    expect(add1(2)(3)).toBe(6);
    expect(add1(10)(100)).toBe(111); // 复用不能被上一次调用污染
    const add1and2 = add1(2);
    expect(add1and2(0)).toBe(3);
    expect(add1and2(7)).toBe(10);
  });
});

describe('4.4 once', () => {
  it('只执行一次，后续返回缓存结果并忽略新参数', () => {
    let calls = 0;
    const init = once((label: string) => {
      calls += 1;
      return `${label}#${calls}`;
    });
    expect(init('a')).toBe('a#1');
    expect(init('b')).toBe('a#1');
    expect(init('c')).toBe('a#1');
    expect(calls).toBe(1);
  });

  it('返回 undefined / 0 时也算"已经执行过"（坑）', () => {
    let calls = 0;
    const noop = once((): undefined => {
      calls += 1;
      return undefined;
    });
    expect(noop()).toBeUndefined();
    expect(noop()).toBeUndefined();
    expect(calls).toBe(1); // 用 `if (result === undefined)` 判断会挂在这里

    let zeroCalls = 0;
    const zero = once(() => {
      zeroCalls += 1;
      return 0;
    });
    expect(zero()).toBe(0);
    expect(zero()).toBe(0);
    expect(zeroCalls).toBe(1);
  });
});

describe('4.5 memoize', () => {
  it('同一个键只调用底层函数一次', () => {
    let calls = 0;
    const double = memoize((n: number) => {
      calls += 1;
      return n * 2;
    });
    expect(double(2)).toBe(4);
    expect(double(2)).toBe(4);
    expect(calls).toBe(1);
    expect(double(3)).toBe(6);
    expect(calls).toBe(2);
  });

  it('缓存值是 0 / undefined 时也要命中缓存（坑：别用 if (cache.get(k))）', () => {
    let calls = 0;
    const zero = memoize((n: number) => {
      calls += 1;
      return n * 0;
    });
    expect(zero(5)).toBe(0);
    expect(zero(5)).toBe(0);
    expect(zero(5)).toBe(0);
    expect(calls).toBe(1);

    let undefCalls = 0;
    const nothing = memoize((_n: number): undefined => {
      undefCalls += 1;
      return undefined;
    });
    expect(nothing(1)).toBeUndefined();
    expect(nothing(1)).toBeUndefined();
    expect(undefCalls).toBe(1);
  });

  it('支持自定义 keyOf（对象参数必须自己给键）', () => {
    let calls = 0;
    const nameLen = memoize(
      (u: { id: string }) => {
        calls += 1;
        return u.id.length;
      },
      (u) => u.id,
    );
    expect(nameLen({ id: 'ab' })).toBe(2);
    expect(nameLen({ id: 'ab' })).toBe(2); // 不同对象、相同键 -> 命中缓存
    expect(calls).toBe(1);
    expect(nameLen({ id: 'abc' })).toBe(3);
    expect(calls).toBe(2);
  });
});

describe('4.6 throttle', () => {
  it('首次放行，窗口内的调用被丢弃', () => {
    let t = 1000;
    const hits: string[] = [];
    const log = throttle((m: string) => hits.push(m), 100, () => t);

    expect(log('a')).toBe(true);
    expect(log('b')).toBe(false);
    expect(log('c')).toBe(false);
    expect(hits).toEqual(['a']);
  });

  it('边界：差 1ms 不放行，正好到 intervalMs 就放行', () => {
    let t = 1000;
    const hits: string[] = [];
    const log = throttle((m: string) => hits.push(m), 100, () => t);

    expect(log('a')).toBe(true);
    t = 1099;
    expect(log('b')).toBe(false);
    t = 1100;
    expect(log('c')).toBe(true);
    t = 1199;
    expect(log('d')).toBe(false);
    t = 1200;
    expect(log('e')).toBe(true);
    expect(hits).toEqual(['a', 'c', 'e']);
  });

  it('时间必须取自注入的 now（时钟不动就永远只放行第一次）', () => {
    const hits: number[] = [];
    const tick = throttle((n: number) => hits.push(n), 50, () => 0); // 假时钟恒为 0
    expect(tick(1)).toBe(true);
    expect(tick(2)).toBe(false);
    expect(tick(3)).toBe(false);
    expect(hits).toEqual([1]);
  });

  it('多个参数原样透传', () => {
    let t = 0;
    const seen: Array<[string, number]> = [];
    const send = throttle((tag: string, n: number) => seen.push([tag, n]), 10, () => t);
    expect(send('a', 1)).toBe(true);
    t = 10;
    expect(send('b', 2)).toBe(true);
    expect(seen).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });
});

describe('4.7 withRetry', () => {
  it('失败两次后成功', () => {
    let n = 0;
    const flaky = withRetry(() => {
      n += 1;
      if (n < 3) throw new Error(`fail${n}`);
      return 'ok';
    }, 3);
    expect(flaky()).toBe('ok');
    expect(n).toBe(3);
  });

  it('成功时不重试，参数原样透传', () => {
    let calls = 0;
    const add = withRetry((a: number, b: number) => {
      calls += 1;
      return a + b;
    }, 5);
    expect(add(1, 2)).toBe(3);
    expect(calls).toBe(1);
  });

  it('全部失败时抛出最后一次的异常，并回调 onRetry', () => {
    const seen: Array<[number, string]> = [];
    let n = 0;
    const always = withRetry(
      () => {
        n += 1;
        throw new AppError(`boom${n}`, 'E_IO');
      },
      2,
      (attempt, err) => seen.push([attempt, err instanceof Error ? err.message : 'not-error']),
    );

    expect(() => always()).toThrow(AppError); // 原样抛出，类型不能被包掉
    expect(() => always()).toThrow('boom4'); // 第二轮调用的最后一次
    expect(seen).toEqual([
      [1, 'boom1'],
      [2, 'boom2'],
      [1, 'boom3'],
      [2, 'boom4'],
    ]);
  });

  it('maxAttempts 非法时在【包装阶段】就抛 RangeError', () => {
    expect(() => withRetry(() => 1, 0)).toThrow(RangeError);
    expect(() => withRetry(() => 1, -1)).toThrow(RangeError);
    expect(() => withRetry(() => 1, 1)).not.toThrow(); // 1 是合法的：只尝试一次
  });
});

describe('4.8 Greeter（this 丢失）', () => {
  it('普通调用', () => {
    expect(new Greeter('Hi').greet('Bob')).toBe('Hi, Bob!');
  });

  it('解构出来单独调用不能丢 this', () => {
    const { greet } = new Greeter('Hi');
    expect(greet('Ann')).toBe('Hi, Ann!');
  });

  it('当回调传出去（setTimeout / 高阶函数）不能丢 this', () => {
    const g = new Greeter('Yo');
    const callIt = (fn: (n: string) => string): string => fn('Cat');
    expect(callIt(g.greet)).toBe('Yo, Cat!');
    expect(['x', 'y'].map(g.greet)).toEqual(['Yo, x!', 'Yo, y!']);
  });

  it('greetAll 内部用方法引用也要正常工作', () => {
    expect(new Greeter('Hi').greetAll(['a', 'b'])).toEqual(['Hi, a!', 'Hi, b!']);
    expect(new Greeter('Hi').greetAll([])).toEqual([]);
  });
});

describe('4.9 BoundedStack（#private 真封装）', () => {
  it('push / pop / peek / size 基本行为', () => {
    const s = new BoundedStack<number>(3);
    expect(s.size).toBe(0);
    s.push(1);
    s.push(2);
    expect(s.size).toBe(2);
    expect(s.capacity).toBe(3);
    expect(s.peek()).toBe(2);
    expect(s.size).toBe(2); // peek 不弹出
    expect(s.pop()).toBe(2);
    expect(s.pop()).toBe(1);
    expect(s.size).toBe(0);
  });

  it('空栈的 pop / peek 返回 undefined（不像 Java 抛异常）', () => {
    const s = new BoundedStack<string>(1);
    expect(s.pop()).toBeUndefined();
    expect(s.peek()).toBeUndefined();
  });

  it('满了 push 抛 RangeError', () => {
    const s = new BoundedStack<number>(2);
    s.push(1);
    s.push(2);
    expect(() => s.push(3)).toThrow(RangeError);
    expect(s.size).toBe(2);
  });

  it('非法容量抛 RangeError', () => {
    expect(() => new BoundedStack<number>(0)).toThrow(RangeError);
    expect(() => new BoundedStack<number>(-1)).toThrow(RangeError);
    expect(() => new BoundedStack<number>(1.5)).toThrow(RangeError);
  });

  it('#private 是运行时真私有：不可枚举、不会被 JSON.stringify 漏出去', () => {
    const s = new BoundedStack<number>(2);
    s.push(42);
    expect(Object.keys(s)).toEqual([]); // 用 TS 的 private 会得到 ['items', 'capacity']
    expect(JSON.stringify(s)).toBe('{}');
    expect((s as unknown as { items?: unknown }).items).toBeUndefined();
  });

  it('toArray 返回栈底到栈顶的拷贝，改它不影响内部', () => {
    const s = new BoundedStack<number>(3);
    s.push(1);
    s.push(2);
    const snapshot = s.toArray();
    expect(snapshot).toEqual([1, 2]);
    snapshot.push(999);
    expect(s.size).toBe(2);
    expect(s.toArray()).toEqual([1, 2]);
  });
});

describe('4.10 ReportFormatter（抽象类 + 模板方法）', () => {
  it('CsvFormatter 渲染逗号分隔', () => {
    const out = new CsvFormatter().render([
      { name: 'a', count: 1 },
      { name: 'b', count: 2 },
    ]);
    expect(out).toBe('csv:\na,1\nb,2');
  });

  it('JsonLinesFormatter 每行一个 JSON 对象', () => {
    const out = new JsonLinesFormatter().render([
      { name: 'a', count: 1 },
      { name: 'b', count: 2 },
    ]);
    expect(out).toBe('json:\n{"name":"a","count":1}\n{"name":"b","count":2}');
  });

  it('空数据走模板方法里的分支', () => {
    expect(new CsvFormatter().render([])).toBe('csv: (empty)');
    expect(new JsonLinesFormatter().render([])).toBe('json: (empty)');
  });

  it('多态：可以放进同一个基类数组里统一调用', () => {
    const formatters: ReportFormatter[] = [new CsvFormatter(), new JsonLinesFormatter()];
    const rows = [{ name: 'x', count: 9 }];
    expect(formatters.map((f) => f.render(rows))).toEqual([
      'csv:\nx,9',
      'json:\n{"name":"x","count":9}',
    ]);
    expect(formatters.every((f) => f instanceof ReportFormatter)).toBe(true);
    expect(formatters.map((f) => f.id)).toEqual(['csv', 'json']);
  });
});

describe('4.11 Error 子类 + instanceof 分派', () => {
  it('NotFoundError 的 message / name / code / 属性', () => {
    const err = new NotFoundError('user', '7');
    expect(err.message).toBe('user not found: 7');
    expect(err.name).toBe('NotFoundError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.resource).toBe('user');
    expect(err.id).toBe('7');
  });

  it('instanceof 链一直到 Error（这是必须用 class 的场景）', () => {
    const err = new NotFoundError('order', 'o1');
    expect(err instanceof NotFoundError).toBe(true);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(new AppError('x', 'E') instanceof NotFoundError).toBe(false);
  });

  it('describeError 必须【子类优先】匹配', () => {
    expect(describeError(new NotFoundError('user', '7'))).toBe('404 user#7');
    expect(describeError(new AppError('boom', 'E_IO'))).toBe('app[E_IO] boom');
    expect(describeError(new Error('plain'))).toBe('error plain');
    expect(describeError(new TypeError('bad'))).toBe('error bad');
  });

  it('describeError 要兜住不是 Error 的东西（catch 到的是 unknown）', () => {
    expect(describeError('oops')).toBe('unknown oops');
    expect(describeError(undefined)).toBe('unknown undefined');
    expect(describeError(42)).toBe('unknown 42');
    expect(describeError(null)).toBe('unknown null');
  });
});

describe('4.12 InMemoryUserRepository（参数属性 + 重载）', () => {
  it('add 用注入的 now() 打时间戳', () => {
    let t = 1000;
    const repo = new InMemoryUserRepository(() => t);
    expect(repo.add('u1', 'ann')).toEqual({ id: 'u1', name: 'ann', createdAt: 1000 });
    t = 2000;
    expect(repo.add('u2', 'bob')).toEqual({ id: 'u2', name: 'bob', createdAt: 2000 });
    expect(repo.count()).toBe(2);
  });

  it('重复 id 抛 Error', () => {
    const repo = new InMemoryUserRepository(() => 0);
    repo.add('u1', 'ann');
    expect(() => repo.add('u1', 'other')).toThrow('duplicate id: u1');
    expect(repo.count()).toBe(1);
  });

  it('超过 maxUsers 抛 RangeError（默认参数可被覆盖）', () => {
    const repo = new InMemoryUserRepository(() => 0, 2);
    repo.add('a', 'a');
    repo.add('b', 'b');
    expect(() => repo.add('c', 'c')).toThrow(RangeError);
    expect(repo.count()).toBe(2);
  });

  it('find(id) 返回单个用户或 undefined', () => {
    const repo = new InMemoryUserRepository(() => 5);
    repo.add('u1', 'ann');
    expect(repo.find('u1')?.name).toBe('ann');
    expect(repo.find('nope')).toBeUndefined();
  });

  it('find(ids) 返回数组，跳过不存在的 id 并保持顺序', () => {
    const repo = new InMemoryUserRepository(() => 5);
    repo.add('u1', 'ann');
    repo.add('u2', 'bob');
    expect(repo.find(['u2', 'nope', 'u1'])).toEqual([
      { id: 'u2', name: 'bob', createdAt: 5 },
      { id: 'u1', name: 'ann', createdAt: 5 },
    ]);
    expect(repo.find([])).toEqual([]);
    expect(repo.find(['nope'])).toEqual([]);
  });

  it('空仓库的 count 是 0', () => {
    expect(new InMemoryUserRepository(() => 0).count()).toBe(0);
  });
});
