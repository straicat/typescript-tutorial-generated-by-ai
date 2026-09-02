import { describe, it, expect } from 'vitest';
import {
  sumSizes,
  isStringArray,
  parsePort,
  toUserId,
  joinUserIds,
  assertNever,
  evalExpr,
  nextState,
  ok,
  err,
  unwrapOr,
  mapResult,
  andThen,
  groupBy,
  pick,
  isCommandName,
  runCommandLine,
  formatCliError,
} from '@exercises/ch02-types';
import type { Expr, TaskState, UserId } from '@exercises/ch02-types';

describe('2.1 sumSizes', () => {
  it('累加并处理空数组', () => {
    expect(sumSizes([{ size: 1 }, { size: 2 }, { size: 3 }])).toBe(6);
    expect(sumSizes([])).toBe(0);
  });

  it('结构化类型：不需要 implements，多余属性的对象/类实例都能传', () => {
    // 注意必须先赋给变量：直接写对象字面量会触发多余属性检查（excess property check）
    const file = { size: 3, name: 'a.txt' };
    expect(sumSizes([file])).toBe(3);

    class FileEntry {
      constructor(
        readonly size: number,
        readonly path: string,
      ) {}
    }
    expect(sumSizes([new FileEntry(4, '/tmp/x'), file])).toBe(7);
  });

  it('运行时脏数据（NaN / Infinity）要跳过，不能污染结果', () => {
    expect(sumSizes([{ size: 1 }, { size: NaN }])).toBe(1);
    expect(sumSizes([{ size: 1 }, { size: Infinity }, { size: 2 }])).toBe(3);
    expect(sumSizes([{ size: NaN }])).toBe(0);
  });
});

describe('2.2 isStringArray', () => {
  it('合法输入（空数组也算）', () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['a'])).toBe(true);
    expect(isStringArray(['a', '', 'c'])).toBe(true);
  });

  it('逐项检查，不能只看是不是数组', () => {
    expect(isStringArray(['a', 1])).toBe(false);
    expect(isStringArray([null])).toBe(false);
    expect(isStringArray([['a']])).toBe(false);
  });

  it('非数组一律 false，包含类数组对象和字符串本身', () => {
    expect(isStringArray('abc')).toBe(false);
    expect(isStringArray(null)).toBe(false);
    expect(isStringArray(undefined)).toBe(false);
    expect(isStringArray({ 0: 'a', length: 1 })).toBe(false);
  });

  it('类型谓词真的能收窄（这行代码能编译就是考点）', () => {
    const raw: unknown = ['a', 'b'];
    if (!isStringArray(raw)) throw new Error('应该被识别为 string[]');
    expect(raw.join('-')).toBe('a-b'); // raw 在这里已经是 string[]
  });
});

describe('2.3 parsePort', () => {
  it('number 与 string 两种合法输入', () => {
    expect(parsePort(8080)).toBe(8080);
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort(' 80 ')).toBe(80);
    expect(parsePort(1)).toBe(1);
    expect(parsePort(65535)).toBe(65535);
  });

  it('越界与非整数', () => {
    expect(parsePort(0)).toBeNull();
    expect(parsePort(-1)).toBeNull();
    expect(parsePort(65536)).toBeNull();
    expect(parsePort(3.5)).toBeNull();
    expect(parsePort(NaN)).toBeNull();
    expect(parsePort(Infinity)).toBeNull();
  });

  it('Number() 会放过的那些坑：true / null / 空串 / 数组', () => {
    expect(parsePort(true)).toBeNull(); // Number(true) === 1
    expect(parsePort(null)).toBeNull(); // Number(null) === 0
    expect(parsePort(undefined)).toBeNull();
    expect(parsePort('')).toBeNull(); // Number('') === 0
    expect(parsePort('   ')).toBeNull();
    expect(parsePort(['80'])).toBeNull(); // Number(['80']) === 80
    expect(parsePort({ port: 80 })).toBeNull();
  });

  it('字符串必须整串是数字', () => {
    expect(parsePort('80abc')).toBeNull();
    expect(parsePort('0x50')).toBeNull();
    expect(parsePort('8e3')).toBeNull();
    expect(parsePort('80.0')).toBeNull();
  });
});

describe('2.4 toUserId / joinUserIds', () => {
  it('合法 id 原样返回（branded type 运行时就是 string）', () => {
    expect(toUserId('u_a1b2')).toBe('u_a1b2');
    expect(toUserId('u_abcd1234')).toBe('u_abcd1234');
    expect(typeof toUserId('u_a1b2')).toBe('string');
  });

  it('不合法一律 null（smart constructor 是唯一入口）', () => {
    expect(toUserId('u_abc')).toBeNull(); // 不足 4 位
    expect(toUserId('U_ABCD')).toBeNull(); // 大写
    expect(toUserId('a1b2')).toBeNull(); // 缺前缀
    expect(toUserId(' u_a1b2 ')).toBeNull(); // 不 trim
    expect(toUserId('')).toBeNull();
    expect(toUserId('u_a1b2!')).toBeNull();
  });

  it('joinUserIds 用逗号连接', () => {
    const a = toUserId('u_a1b2');
    const b = toUserId('u_c3d4');
    if (a === null || b === null) throw new Error('测试数据应该是合法 id');
    expect(joinUserIds([])).toBe('');
    expect(joinUserIds([a])).toBe('u_a1b2');
    expect(joinUserIds([a, b])).toBe('u_a1b2,u_c3d4');
    // 想绕过校验只能显式 as —— 这正是我们要在 review 里抓的写法
    expect(joinUserIds(['raw' as UserId])).toBe('raw');
  });
});

describe('2.5 assertNever / evalExpr', () => {
  it('assertNever 抛错且带上脏数据', () => {
    expect(() => assertNever({ kind: 'mod' } as never)).toThrow(/mod/);
    expect(() => assertNever('x' as never)).toThrow(/"x"/);
  });

  it('求值各个分支', () => {
    expect(evalExpr({ kind: 'lit', value: 42 })).toBe(42);
    expect(evalExpr({ kind: 'neg', operand: { kind: 'lit', value: 3 } })).toBe(-3);
    expect(
      evalExpr({ kind: 'add', left: { kind: 'lit', value: 1 }, right: { kind: 'lit', value: 2 } }),
    ).toBe(3);
    expect(
      evalExpr({ kind: 'mul', left: { kind: 'lit', value: 3 }, right: { kind: 'lit', value: 4 } }),
    ).toBe(12);
    expect(
      evalExpr({ kind: 'div', left: { kind: 'lit', value: 9 }, right: { kind: 'lit', value: 2 } }),
    ).toBe(4.5);
  });

  it('递归嵌套：-(2 * (3 + 4)) === -14', () => {
    const expr: Expr = {
      kind: 'neg',
      operand: {
        kind: 'mul',
        left: { kind: 'lit', value: 2 },
        right: {
          kind: 'add',
          left: { kind: 'lit', value: 3 },
          right: { kind: 'lit', value: 4 },
        },
      },
    };
    expect(evalExpr(expr)).toBe(-14);
  });

  it('除零必须抛异常，不能返回 Infinity / NaN', () => {
    const divZero: Expr = {
      kind: 'div',
      left: { kind: 'lit', value: 1 },
      right: { kind: 'lit', value: 0 },
    };
    expect(() => evalExpr(divZero)).toThrow('division by zero');
  });

  it('脏数据走到 default 分支时抛错（运行时没有类型保护）', () => {
    // 报错信息里必须带上那个非法的 kind，否则线上根本查不出是哪条数据坏了
    expect(() => evalExpr({ kind: 'mod' } as unknown as Expr)).toThrow(/mod/);
  });
});

describe('2.6 nextState', () => {
  it('合法迁移，且每个状态携带各自的数据', () => {
    expect(nextState({ kind: 'idle' }, { kind: 'start', at: 100 })).toEqual({
      kind: 'running',
      startedAt: 100,
    });
    expect(nextState({ kind: 'running', startedAt: 100 }, { kind: 'finish', at: 350 })).toEqual({
      kind: 'done',
      durationMs: 250,
    });
    expect(nextState({ kind: 'running', startedAt: 1 }, { kind: 'fail', reason: 'oom' })).toEqual({
      kind: 'failed',
      reason: 'oom',
    });
  });

  it('reset 在任何状态下都回到 idle', () => {
    expect(nextState({ kind: 'done', durationMs: 5 }, { kind: 'reset' })).toEqual({ kind: 'idle' });
    expect(nextState({ kind: 'failed', reason: 'x' }, { kind: 'reset' })).toEqual({ kind: 'idle' });
    expect(nextState({ kind: 'idle' }, { kind: 'reset' })).toEqual({ kind: 'idle' });
  });

  it('非法组合原样返回旧状态（同一个对象）', () => {
    const idle: TaskState = { kind: 'idle' };
    expect(nextState(idle, { kind: 'finish', at: 1 })).toBe(idle);
    expect(nextState(idle, { kind: 'fail', reason: 'x' })).toBe(idle);
    const done: TaskState = { kind: 'done', durationMs: 9 };
    expect(nextState(done, { kind: 'start', at: 2 })).toBe(done);
  });
});

describe('2.7 ok / err / unwrapOr', () => {
  it('构造函数返回可辨识联合', () => {
    expect(ok(1)).toEqual({ kind: 'ok', value: 1 });
    expect(err('boom')).toEqual({ kind: 'err', error: 'boom' });
    expect(ok(undefined)).toEqual({ kind: 'ok', value: undefined });
  });

  it('unwrapOr 取值 / 取默认值', () => {
    expect(unwrapOr(ok(5), 9)).toBe(5);
    expect(unwrapOr(err('x'), 9)).toBe(9);
  });

  it('假值也是合法的成功值，不能被 fallback 吃掉', () => {
    expect(unwrapOr(ok(0), 9)).toBe(0);
    expect(unwrapOr(ok(''), 'fallback')).toBe('');
    expect(unwrapOr(ok(false), true)).toBe(false);
  });
});

describe('2.8 mapResult / andThen', () => {
  it('mapResult 只变换 ok', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ kind: 'ok', value: 6 });
    expect(mapResult(ok(2), String)).toEqual({ kind: 'ok', value: '2' });
    expect(mapResult(err<string>('bad'), (n: number) => n * 2)).toEqual({
      kind: 'err',
      error: 'bad',
    });
  });

  it('err 分支不调用回调', () => {
    let calls = 0;
    mapResult(err<string>('bad'), (n: number) => {
      calls += 1;
      return n;
    });
    andThen(err<string>('bad'), (n: number) => {
      calls += 1;
      return ok(n);
    });
    expect(calls).toBe(0);
  });

  it('andThen 串联，不产生嵌套 Result', () => {
    const parse = (s: string) => {
      const port = parsePort(s);
      return port == null ? err('bad port') : ok(port);
    };
    expect(andThen(ok('8080'), parse)).toEqual({ kind: 'ok', value: 8080 });
    expect(andThen(ok('nope'), parse)).toEqual({ kind: 'err', error: 'bad port' });
    expect(andThen(err<string>('no input'), parse)).toEqual({ kind: 'err', error: 'no input' });
  });
});

describe('2.9 groupBy', () => {
  it('按 key 分组并保持原顺序', () => {
    expect(groupBy(['a', 'bb', 'c', 'dd'], (s) => String(s.length))).toEqual({
      '1': ['a', 'c'],
      '2': ['bb', 'dd'],
    });
  });

  it('对象数组按字段分组', () => {
    const rows = [
      { name: 'a', level: 'info' },
      { name: 'b', level: 'error' },
      { name: 'c', level: 'info' },
    ];
    expect(groupBy(rows, (r) => r.level)).toEqual({
      info: [rows[0], rows[2]],
      error: [rows[1]],
    });
  });

  it('坑：Record<K, T[]> 只是类型上的承诺，没出现过的 key 运行时不存在', () => {
    const grouped = groupBy<string, 'x' | 'y'>([], () => 'x');
    expect(grouped).toEqual({});
    expect(Object.keys(grouped)).toEqual([]);
    // 类型说 grouped.y 是 string[]，运行时却是 undefined
    expect(grouped.y as unknown).toBeUndefined();
  });
});

describe('2.10 pick', () => {
  it('挑出指定的键', () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    expect(pick({ a: 1, b: 2 }, [])).toEqual({});
    expect(Object.keys(pick({ a: 1, b: 2, c: 3 }, ['c', 'a']))).toEqual(['c', 'a']);
  });

  it('不存在的可选属性不要凭空造出来', () => {
    const partial: { a: number; b?: number } = { a: 1 };
    const out = pick(partial, ['a', 'b']);
    expect(Object.keys(out)).toEqual(['a']);
    expect(Object.hasOwn(out, 'b')).toBe(false);
  });

  it('值为 undefined 的自有属性要保留（和"不存在"是两回事）', () => {
    const withUndef: { a: number; b: number | undefined } = { a: 1, b: undefined };
    expect(Object.keys(pick(withUndef, ['a', 'b']))).toEqual(['a', 'b']);
  });

  it('只看自有属性，不看原型链', () => {
    const child = Object.create({ inherited: 1 }) as { inherited: number };
    expect(Object.keys(pick(child, ['inherited']))).toEqual([]);
  });
});

describe('2.11 isCommandName', () => {
  it('认识全部正式命令名', () => {
    expect(isCommandName('init')).toBe(true);
    expect(isCommandName('run')).toBe(true);
    expect(isCommandName('copy')).toBe(true);
  });

  it('别名和未知输入都是 false', () => {
    expect(isCommandName('r')).toBe(false);
    expect(isCommandName('cp')).toBe(false);
    expect(isCommandName('nope')).toBe(false);
    expect(isCommandName('')).toBe(false);
  });

  it('坑：原型链上的属性不能误判为命令', () => {
    expect(isCommandName('toString')).toBe(false);
    expect(isCommandName('constructor')).toBe(false);
    expect(isCommandName('hasOwnProperty')).toBe(false);
  });
});

describe('2.12 runCommandLine / formatCliError', () => {
  it('解析成功：无参数、有参数、多余参数忽略', () => {
    expect(runCommandLine(['init'])).toEqual({ kind: 'ok', value: 'init()' });
    expect(runCommandLine(['init', 'x'])).toEqual({ kind: 'ok', value: 'init()' });
    expect(runCommandLine(['run', 'build'])).toEqual({ kind: 'ok', value: 'run(task=build)' });
    expect(runCommandLine(['copy', 'a', 'b'])).toEqual({
      kind: 'ok',
      value: 'copy(src=a, dest=b)',
    });
  });

  it('别名要解析成正式名字', () => {
    expect(runCommandLine(['r', 'build'])).toEqual({ kind: 'ok', value: 'run(task=build)' });
    expect(runCommandLine(['cp', 'a', 'b'])).toEqual({ kind: 'ok', value: 'copy(src=a, dest=b)' });
  });

  it('三种错误各自带上足够的上下文', () => {
    expect(runCommandLine([])).toEqual({ kind: 'err', error: { kind: 'empty' } });
    expect(runCommandLine(['nope'])).toEqual({
      kind: 'err',
      error: { kind: 'unknown-command', input: 'nope' },
    });
    expect(runCommandLine(['copy', 'a'])).toEqual({
      kind: 'err',
      error: { kind: 'missing-args', command: 'copy', expected: 2, got: 1 },
    });
    expect(runCommandLine(['r'])).toEqual({
      kind: 'err',
      error: { kind: 'missing-args', command: 'run', expected: 1, got: 0 },
    });
  });

  it('formatCliError 覆盖全部错误分支', () => {
    expect(formatCliError({ kind: 'empty' })).toBe('缺少命令，可用命令: init, run, copy');
    expect(formatCliError({ kind: 'unknown-command', input: 'nope' })).toBe('未知命令: nope');
    expect(formatCliError({ kind: 'missing-args', command: 'copy', expected: 2, got: 1 })).toBe(
      'copy 需要 2 个参数，实际收到 1 个',
    );
  });

  it('把 runCommandLine 的结果渲染成一行输出（Result 的典型消费方式）', () => {
    const render = (argv: readonly string[]): string => {
      const result = runCommandLine(argv);
      return result.kind === 'ok' ? `OK ${result.value}` : `ERR ${formatCliError(result.error)}`;
    };
    expect(render(['r', 'build'])).toBe('OK run(task=build)');
    expect(render(['copy', 'only-one'])).toBe('ERR copy 需要 2 个参数，实际收到 1 个');
    expect(render([])).toBe('ERR 缺少命令，可用命令: init, run, copy');
  });
});
