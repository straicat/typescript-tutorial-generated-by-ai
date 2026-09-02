import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  UsageError,
  ToolError,
  splitLines,
  humanizeBytes,
  humanizeDuration,
  colorize,
  exitCodeFor,
  formatTable,
  parseArgvBasic,
  parseWhereFilter,
  getByPath,
  matchesFilter,
  findConfigUpwards,
  resolveConfig,
  buildGreetCommand,
  runCommand,
  buildJsonlStats,
} from '@exercises/ch08-cli';

describe('8.1 splitLines', () => {
  it('末尾换行不产生多余的空行', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a')).toEqual(['a']);
  });

  it('剥掉 \\r（Windows CRLF）', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('a\r\nb')).toEqual(['a', 'b']);
  });

  it('剥掉 BOM —— 不剥的话第一行 JSON.parse 会炸', () => {
    expect(splitLines('\uFEFFa\nb')).toEqual(['a', 'b']);
    expect(splitLines('\uFEFF{"a":1}')).toEqual(['{"a":1}']);
    // 只剥开头那一个，中间的 \uFEFF 是数据
    expect(splitLines('a\n\uFEFFb')).toEqual(['a', '\uFEFFb']);
  });

  it('中间空行必须保留（否则行号对不上原文件），空输入是 0 行', () => {
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });
});

describe('8.2 humanizeBytes', () => {
  it('B 档不带小数', () => {
    expect(humanizeBytes(0)).toBe('0 B');
    expect(humanizeBytes(1)).toBe('1 B');
    expect(humanizeBytes(999)).toBe('999 B');
    expect(humanizeBytes(1023)).toBe('1023 B');
  });

  it('1024 进制，1 位小数', () => {
    expect(humanizeBytes(1024)).toBe('1.0 KiB');
    expect(humanizeBytes(1536)).toBe('1.5 KiB');
    expect(humanizeBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(humanizeBytes(1024 * 1024 * 1024)).toBe('1.0 GiB');
    expect(humanizeBytes(1024 ** 5)).toBe('1.0 PiB');
    // 超过 PiB 就不再往上升
    expect(humanizeBytes(1024 ** 6)).toBe('1024.0 PiB');
  });

  it('负数保留符号', () => {
    expect(humanizeBytes(-512)).toBe('-512 B');
    expect(humanizeBytes(-2048)).toBe('-2.0 KiB');
  });

  it('非有限数字抛 RangeError（防止打印出 "NaN B"）', () => {
    expect(() => humanizeBytes(Number.NaN)).toThrow(RangeError);
    expect(() => humanizeBytes(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => humanizeBytes(Number('abc'))).toThrow(RangeError);
  });
});

describe('8.3 humanizeDuration', () => {
  it('ms / s 两档的边界与小数位', () => {
    expect(humanizeDuration(0)).toBe('0ms');
    expect(humanizeDuration(999)).toBe('999ms');
    expect(humanizeDuration(999.4)).toBe('999ms');
    expect(humanizeDuration(1000)).toBe('1.0s');
    expect(humanizeDuration(1500)).toBe('1.5s');
    expect(humanizeDuration(59_000)).toBe('59.0s');
  });

  it('分 / 时两档', () => {
    expect(humanizeDuration(60_000)).toBe('1m0s');
    expect(humanizeDuration(90_000)).toBe('1m30s'); // 用 Math.round 取分会变成 2m
    expect(humanizeDuration(3_599_000)).toBe('59m59s');
    expect(humanizeDuration(3_600_000)).toBe('1h0m');
    expect(humanizeDuration(7_260_000)).toBe('2h1m');
  });

  it('负数和非有限数字抛 RangeError', () => {
    expect(() => humanizeDuration(-1)).toThrow(RangeError);
    expect(() => humanizeDuration(Number.NaN)).toThrow(RangeError);
  });
});

describe('8.4 colorize', () => {
  const tty = { isTTY: true, env: {} };
  const pipe = { isTTY: false, env: {} };

  it('只有 TTY 才上色（输出重定向到文件不能带转义码）', () => {
    expect(colorize('hi', 'red', tty)).toBe('\u001B[31mhi\u001B[0m');
    expect(colorize('hi', 'green', tty)).toBe('\u001B[32mhi\u001B[0m');
    expect(colorize('hi', 'bold', tty)).toBe('\u001B[1mhi\u001B[0m');
    expect(colorize('hi', 'gray', tty)).toBe('\u001B[90mhi\u001B[0m');
    expect(colorize('hi', 'red', pipe)).toBe('hi');
  });

  it('NO_COLOR 优先级最高，但空串视为未设置（no-color.org 约定）', () => {
    expect(colorize('hi', 'red', { isTTY: true, env: { NO_COLOR: '1' } })).toBe('hi');
    expect(colorize('hi', 'red', { isTTY: true, env: { NO_COLOR: '0' } })).toBe('hi');
    expect(colorize('hi', 'red', { isTTY: true, env: { NO_COLOR: '' } })).toBe('\u001B[31mhi\u001B[0m');
  });

  it('FORCE_COLOR 能在非 TTY 下强制上色，但 FORCE_COLOR=0 不行', () => {
    expect(colorize('hi', 'red', { isTTY: false, env: { FORCE_COLOR: '1' } })).toBe('\u001B[31mhi\u001B[0m');
    expect(colorize('hi', 'red', { isTTY: false, env: { FORCE_COLOR: '0' } })).toBe('hi');
    expect(colorize('hi', 'red', { isTTY: false, env: { FORCE_COLOR: '' } })).toBe('hi');
    // NO_COLOR 比 FORCE_COLOR 优先
    expect(colorize('hi', 'red', { isTTY: true, env: { NO_COLOR: '1', FORCE_COLOR: '1' } })).toBe('hi');
  });

  it('空字符串永远不加转义码', () => {
    expect(colorize('', 'red', tty)).toBe('');
    expect(colorize('', 'red', { isTTY: false, env: { FORCE_COLOR: '1' } })).toBe('');
  });
});

describe('8.5 exitCodeFor', () => {
  it('null / 一般错误 / 非 Error 抛出物', () => {
    expect(exitCodeFor(null)).toBe(0);
    expect(exitCodeFor(undefined)).toBe(0);
    expect(exitCodeFor(new Error('boom'))).toBe(1);
    expect(exitCodeFor(new TypeError('boom'))).toBe(1);
    expect(exitCodeFor('boom')).toBe(1);
    expect(exitCodeFor(42)).toBe(1);
  });

  it('UsageError -> 2，AbortError -> 130', () => {
    expect(exitCodeFor(new UsageError('bad flag'))).toBe(2);
    const aborted = new Error('已取消');
    aborted.name = 'AbortError';
    expect(exitCodeFor(aborted)).toBe(130);
  });

  it('自带 exitCode 的对象（ToolError / commander 的 CommanderError）', () => {
    expect(exitCodeFor(new ToolError('no match'))).toBe(1);
    expect(exitCodeFor(new ToolError('x', 3))).toBe(3);
    // 😱 exitCode 为 0 时不能被 `|| 1` 吃掉 —— commander 的 --help 就是 0
    expect(exitCodeFor({ exitCode: 0, code: 'commander.helpDisplayed' })).toBe(0);
    expect(exitCodeFor({ exitCode: 64 })).toBe(64);
  });

  it('不可信的 exitCode 一律退回 1', () => {
    expect(exitCodeFor({ exitCode: 300 })).toBe(1);
    expect(exitCodeFor({ exitCode: -1 })).toBe(1);
    expect(exitCodeFor({ exitCode: 1.5 })).toBe(1);
    expect(exitCodeFor({ exitCode: '2' })).toBe(1);
  });
});

describe('8.6 formatTable', () => {
  it('等宽对齐，行尾不留空格', () => {
    expect(formatTable([['a', 'bbb'], ['cc', 'd']])).toBe('a   bbb\ncc  d');
    // 每一行都不能有尾随空格
    for (const line of formatTable([['a', 'bbb'], ['cc', 'd']]).split('\n')) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it('header 会带一条等长的分隔线', () => {
    expect(formatTable([['1', '2']], { header: ['id', 'n'] })).toBe('id  n\n--  -\n1   2');
    expect(formatTable([], { header: ['a'] })).toBe('a\n-');
  });

  it('gap 可调，空输入返回空串', () => {
    expect(formatTable([['a', 'b']], { gap: 1 })).toBe('a b');
    expect(formatTable([['a', 'b']], { gap: 4 })).toBe('a    b');
    expect(formatTable([])).toBe('');
  });

  it('长短不齐的行按 空串 补齐，emoji 算一个码点宽', () => {
    expect(formatTable([['a'], ['b', 'c']])).toBe('a\nb  c');
    // '👍'.length 是 2，但显示宽度按码点算 1，所以列宽是 2（'ab'）而不是 2（'👍'.length）
    expect(formatTable([['👍', 'x'], ['ab', 'y']])).toBe('👍   x\nab  y');
  });
});

describe('8.7 parseArgvBasic', () => {
  it('--key=value 与 --key value', () => {
    expect(parseArgvBasic(['--port=8080', 'file.txt', '--verbose'])).toEqual({
      options: { port: '8080', verbose: true },
      positionals: ['file.txt'],
    });
    expect(parseArgvBasic(['--port', '8080'])).toEqual({ options: { port: '8080' }, positionals: [] });
    // --key= 的值是空串，不是 true
    expect(parseArgvBasic(['--key='])).toEqual({ options: { key: '' }, positionals: [] });
    // 键名保持原样，不做 camelCase 转换
    expect(parseArgvBasic(['--log-level=debug'])).toEqual({
      options: { 'log-level': 'debug' },
      positionals: [],
    });
  });

  it('😱 没有 schema 就分不清布尔开关和带值选项', () => {
    // --verbose 明明是个开关，但手写解析器不知道，于是把 file.txt 吃成了它的值。
    // 这正是「别自己撕 argv，用 commander」的理由。
    expect(parseArgvBasic(['--verbose', 'file.txt'])).toEqual({
      options: { verbose: 'file.txt' },
      positionals: [],
    });
  });

  it('下一个 token 像选项时当布尔处理，同名键后者覆盖前者', () => {
    expect(parseArgvBasic(['--flag', '--other'])).toEqual({
      options: { flag: true, other: true },
      positionals: [],
    });
    expect(parseArgvBasic(['--flag'])).toEqual({ options: { flag: true }, positionals: [] });
    expect(parseArgvBasic(['--tag=a', '--tag=b'])).toEqual({ options: { tag: 'b' }, positionals: [] });
  });

  it('短选项：-abc 合并成三个布尔，单个 -n 才吃值', () => {
    expect(parseArgvBasic(['-abc'])).toEqual({
      options: { a: true, b: true, c: true },
      positionals: [],
    });
    expect(parseArgvBasic(['-n', '3', 'x'])).toEqual({ options: { n: '3' }, positionals: ['x'] });
    expect(parseArgvBasic(['-v'])).toEqual({ options: { v: true }, positionals: [] });
    // 合并组不吃值，后面的 3 落到位置参数
    expect(parseArgvBasic(['-ab', '3'])).toEqual({
      options: { a: true, b: true },
      positionals: ['3'],
    });
  });

  it('-- 之后全是位置参数，单独的 - 是位置参数（stdin 约定）', () => {
    expect(parseArgvBasic(['--', '--port', '8080'])).toEqual({
      options: {},
      positionals: ['--port', '8080'],
    });
    expect(parseArgvBasic(['-v', '--', '-rf', '--'])).toEqual({
      options: { v: true },
      positionals: ['-rf', '--'],
    });
    expect(parseArgvBasic(['-'])).toEqual({ options: {}, positionals: ['-'] });
    expect(parseArgvBasic(['stats', '-'])).toEqual({ options: {}, positionals: ['stats', '-'] });
    expect(parseArgvBasic([])).toEqual({ options: {}, positionals: [] });
  });
});

describe('8.8 parseWhereFilter / getByPath / matchesFilter', () => {
  it('解析 key=value、点路径、取反', () => {
    expect(parseWhereFilter('a.b=1')).toEqual({ path: ['a', 'b'], value: '1', negated: false });
    expect(parseWhereFilter('level!=error')).toEqual({ path: ['level'], value: 'error', negated: true });
    expect(parseWhereFilter('k=')).toEqual({ path: ['k'], value: '', negated: false });
    // 只按第一个 = 切分
    expect(parseWhereFilter('a=b=c')).toEqual({ path: ['a'], value: 'b=c', negated: false });
  });

  it('非法输入抛 UsageError', () => {
    expect(() => parseWhereFilter('level')).toThrow(UsageError);
    expect(() => parseWhereFilter('=1')).toThrow(UsageError);
    expect(() => parseWhereFilter('!=1')).toThrow(UsageError);
    expect(() => parseWhereFilter('a..b=1')).toThrow(UsageError);
    expect(() => parseWhereFilter('.a=1')).toThrow(UsageError);
  });

  it('getByPath 逐段下钻，并挡掉原型污染用的键', () => {
    expect(getByPath({ a: { b: 1 } }, ['a', 'b'])).toBe(1);
    expect(getByPath({ a: 1 }, ['a'])).toBe(1);
    expect(getByPath({ a: 1 }, ['a', 'b'])).toBeUndefined();
    expect(getByPath({ a: null }, ['a', 'b'])).toBeUndefined();
    expect(getByPath(null, ['a'])).toBeUndefined();
    expect(getByPath({}, ['constructor'])).toBeUndefined();
    expect(getByPath({}, ['__proto__'])).toBeUndefined();
    expect(getByPath({}, ['a', 'prototype'])).toBeUndefined();
  });

  it('matchesFilter：数字转字符串比较，对象走 JSON.stringify', () => {
    expect(matchesFilter({ level: 'error' }, parseWhereFilter('level=error'))).toBe(true);
    expect(matchesFilter({ level: 'info' }, parseWhereFilter('level=error'))).toBe(false);
    expect(matchesFilter({ http: { status: 504 } }, parseWhereFilter('http.status=504'))).toBe(true);
    expect(matchesFilter({ http: { status: 200 } }, parseWhereFilter('http.status!=200'))).toBe(false);
    expect(matchesFilter({ a: null }, parseWhereFilter('a=null'))).toBe(true);
    expect(matchesFilter({ tags: ['x'] }, parseWhereFilter('tags=["x"]'))).toBe(true);
  });

  it('字段缺失算「不相等」，所以 != 会命中', () => {
    expect(matchesFilter({}, parseWhereFilter('level=error'))).toBe(false);
    expect(matchesFilter({}, parseWhereFilter('level!=error'))).toBe(true);
    // 不能把 undefined 转成 'undefined' 去比
    expect(matchesFilter({}, parseWhereFilter('level=undefined'))).toBe(false);
  });
});

describe('8.9 findConfigUpwards', () => {
  const exists = (p: string): boolean => p === '/a/b/.toolrc.json';

  it('从深处一路往上找，返回第一个命中', () => {
    expect(findConfigUpwards('/a/b/c/d', '.toolrc.json', exists)).toBe('/a/b/.toolrc.json');
    expect(findConfigUpwards('/a/b/c', '.toolrc.json', exists)).toBe('/a/b/.toolrc.json');
    expect(findConfigUpwards('/a/b', '.toolrc.json', exists)).toBe('/a/b/.toolrc.json');
  });

  it('找不到返回 null，并且到根目录必须停下来（不能死循环）', () => {
    expect(findConfigUpwards('/a', '.toolrc.json', exists)).toBeNull();
    expect(findConfigUpwards('/a/b/c', '.toolrc.json', () => false)).toBeNull();
    expect(findConfigUpwards('/', '.toolrc.json', () => false)).toBeNull();
  });

  it('查找顺序是「从深到浅」，且每层只探一次', () => {
    const seen: string[] = [];
    const spy = (p: string): boolean => {
      seen.push(p);
      return false;
    };
    findConfigUpwards('/a/b/c', '.toolrc.json', spy);
    expect(seen).toEqual([
      '/a/b/c/.toolrc.json',
      '/a/b/.toolrc.json',
      '/a/.toolrc.json',
      '/.toolrc.json',
    ]);
  });
});

describe('8.10 resolveConfig', () => {
  it('什么都不给就是默认值', () => {
    expect(resolveConfig({})).toEqual({ port: 8080, logLevel: 'info', color: true, retries: 0 });
    // 配置文件里多余的键直接丢掉
    expect(resolveConfig({ file: { nope: 1 } })).toEqual({
      port: 8080,
      logLevel: 'info',
      color: true,
      retries: 0,
    });
  });

  it('优先级：命令行 > 环境变量 > 配置文件 > 默认值', () => {
    expect(resolveConfig({ file: { port: 3000 } }).port).toBe(3000);
    expect(resolveConfig({ file: { port: 3000 }, env: { TOOL_PORT: '4000' } }).port).toBe(4000);
    expect(
      resolveConfig({ file: { port: 3000 }, env: { TOOL_PORT: '4000' }, cli: { port: 5000 } }).port,
    ).toBe(5000);
    expect(resolveConfig({ env: { TOOL_LOG_LEVEL: 'debug' } }).logLevel).toBe('debug');
    expect(resolveConfig({ env: { NO_COLOR: '1' } }).color).toBe(false);
    expect(resolveConfig({ env: { TOOL_RETRIES: '3' } }).retries).toBe(3);
  });

  it('😱 值为 undefined 的层不能覆盖下一级', () => {
    expect(resolveConfig({ file: { color: false }, cli: { color: undefined } }).color).toBe(false);
    expect(resolveConfig({ file: { port: 3000 }, cli: { port: undefined } }).port).toBe(3000);
  });

  it('😱 环境变量的空串视为「没设置」，不能被 coerce 成 0', () => {
    expect(resolveConfig({ env: { TOOL_PORT: '' } }).port).toBe(8080);
    expect(resolveConfig({ env: { TOOL_RETRIES: '   ' } }).retries).toBe(0);
    expect(resolveConfig({ env: { NO_COLOR: '' } }).color).toBe(true);
  });

  it('校验失败抛 UsageError，message 以 "配置非法:" 开头', () => {
    expect(() => resolveConfig({ file: { port: 0 } })).toThrow(UsageError);
    expect(() => resolveConfig({ file: { port: 70000 } })).toThrow(UsageError);
    expect(() => resolveConfig({ file: { port: 'abc' } })).toThrow(UsageError);
    expect(() => resolveConfig({ file: { logLevel: 'trace' } })).toThrow(UsageError);
    expect(() => resolveConfig({ file: { retries: 99 } })).toThrow(UsageError);
    expect(() => resolveConfig({ file: { port: 0 } })).toThrow(/^配置非法:/);
  });
});

describe('8.11 buildGreetCommand + runCommand', () => {
  it('正常路径：结果进 stdout，退出码 0，error 为 null', () => {
    expect(runCommand(buildGreetCommand(), ['Alice'])).toEqual({
      stdout: 'Hello, Alice!\n',
      stderr: '',
      exitCode: 0,
      error: null,
    });
  });

  it('--times / --upper / --no-exclaim，选项位置随便放', () => {
    expect(runCommand(buildGreetCommand(), ['Alice', '-t', '2']).stdout).toBe(
      'Hello, Alice!\nHello, Alice!\n',
    );
    expect(runCommand(buildGreetCommand(), ['Alice', '-u']).stdout).toBe('HELLO, ALICE!\n');
    expect(runCommand(buildGreetCommand(), ['Alice', '--no-exclaim']).stdout).toBe('Hello, Alice\n');
    expect(runCommand(buildGreetCommand(), ['-t', '2', '-u', '--no-exclaim', 'Bob']).stdout).toBe(
      'HELLO, BOB\nHELLO, BOB\n',
    );
  });

  it('铁律：诊断信息只走 stderr，不污染 stdout', () => {
    const r = runCommand(buildGreetCommand(), ['Alice', '--verbose']);
    expect(r.stdout).toBe('Hello, Alice!\n');
    expect(r.stderr).toBe('[info] name=Alice times=1\n');
    expect(r.exitCode).toBe(0);
  });

  it('--help / --version 也是抛异常出来的，但退出码是 0', () => {
    const help = runCommand(buildGreetCommand(), ['--help']);
    expect(help.exitCode).toBe(0);
    expect(help.error).not.toBeNull();
    expect(help.stdout).toContain('Usage: greet');
    expect(help.stdout).toContain('-t, --times <n>');
    expect(help.stdout).toContain('--no-exclaim');
    expect(help.stderr).toBe('');

    const version = runCommand(buildGreetCommand(), ['--version']);
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toBe('1.0.0\n');
  });

  it('用法错误：commander 的报错进 stderr，退出码 1', () => {
    const missing = runCommand(buildGreetCommand(), []);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain("missing required argument 'name'");
    expect(missing.stderr).toContain('(用 --help 查看用法)');

    const unknown = runCommand(buildGreetCommand(), ['Alice', '--bogus']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown option '--bogus'");
  });

  it('zod 校验失败抛 UsageError -> 退出码 2', () => {
    const bad = runCommand(buildGreetCommand(), ['Alice', '-t', 'abc']);
    expect(bad.exitCode).toBe(2);
    expect(bad.error?.name).toBe('UsageError');
    expect(bad.error?.message).toContain('greet 选项非法');
    expect(bad.stdout).toBe('');

    expect(runCommand(buildGreetCommand(), ['Alice', '-t', '0']).exitCode).toBe(2);
    expect(runCommand(buildGreetCommand(), ['Alice', '-t', '99']).exitCode).toBe(2);
    expect(runCommand(buildGreetCommand(), ['Alice', '-t', '1.5']).exitCode).toBe(2);
  });

  it('😱 runCommand 必须把设置递归装到 .addCommand() 加进来的子命令上', () => {
    // .addCommand() 的子命令【不会】继承父命令的 exitOverride。
    // 如果 runCommand 忘了递归，下面这行会直接 process.exit(1) 把测试进程干掉。
    const program = new Command('root');
    const child = new Command('child').action(() => {});
    program.addCommand(child);

    const r = runCommand(program, ['child', '--nope']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("unknown option '--nope'");
    expect(r.error).not.toBeNull();
  });

  it('每次调用 buildGreetCommand 都要是全新的 Command（不能用全局 program）', () => {
    const a = buildGreetCommand();
    const b = buildGreetCommand();
    expect(a).not.toBe(b);
    expect(runCommand(a, ['A']).stdout).toBe('Hello, A!\n');
    expect(runCommand(b, ['B']).stdout).toBe('Hello, B!\n');
  });
});

describe('8.12 buildJsonlStats', () => {
  const lines = [
    '{"a":1,"b":"x"}', // L1 ok
    '', // L2 空白，跳过
    '{"a":2}', // L3 ok
    'not json', // L4 非法：解析失败
    '[1,2]', // L5 非法：合法 JSON 但不是对象
    '{"a":null,"c":true}', // L6 ok
  ];

  it('统计总数 / 合法 / 非法，行号是 1-based 且相对于输入数组', () => {
    const stats = buildJsonlStats(lines);
    expect(stats.total).toBe(5); // 空白行不计入
    expect(stats.valid).toBe(3);
    expect(stats.invalid).toBe(2);
    expect(stats.badLines).toEqual([4, 5]);
  });

  it('字段频率与运行时类型集合', () => {
    expect(buildJsonlStats(lines).fields).toEqual([
      { field: 'a', count: 3, types: ['null', 'number'] },
      { field: 'b', count: 1, types: ['string'] },
      { field: 'c', count: 1, types: ['boolean'] },
    ]);
  });

  it('排序必须确定：count 降序，同 count 按字段名升序', () => {
    const stats = buildJsonlStats(['{"z":1,"a":1,"m":1}', '{"m":2}']);
    expect(stats.fields.map((f) => f.field)).toEqual(['m', 'a', 'z']);
  });

  it('数组 / null / 字符串等「合法 JSON 但不是记录」的行算非法；空输入全是 0', () => {
    const weird = buildJsonlStats(['null', '"str"', '42', '  ', '{}']);
    expect(weird.total).toBe(4);
    expect(weird.valid).toBe(1);
    expect(weird.badLines).toEqual([1, 2, 3]);
    expect(weird.fields).toEqual([]);

    expect(buildJsonlStats([])).toEqual({
      total: 0,
      valid: 0,
      invalid: 0,
      badLines: [],
      fields: [],
    });
  });

  it('和 8.1 串起来用：整块文本 -> 切行 -> 统计', () => {
    const text = '\uFEFF{"a":1}\r\n{"a":2,"b":3}\r\n\r\n';
    const stats = buildJsonlStats(splitLines(text));
    expect(stats.total).toBe(2);
    expect(stats.invalid).toBe(0);
    expect(stats.fields).toEqual([
      { field: 'a', count: 2, types: ['number'] },
      { field: 'b', count: 1, types: ['number'] },
    ]);
  });
});
