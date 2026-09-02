import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  toError,
  AppError,
  ConfigError,
  getRootCause,
  ok,
  err,
  isOk,
  isErr,
  mapResult,
  mapErrResult,
  unwrapOr,
  collectResults,
  isUser,
  assertNonNull,
  formatZodError,
  loadConfig,
  loadEnv,
  parseCliEvent,
  parseTimeRange,
  partitionParse,
} from '@exercises/ch07-errors-validation';

describe('7.1 toError', () => {
  it('已经是 Error 就原样返回同一个对象（不能新建，否则 stack 丢了）', () => {
    const e = new TypeError('boom');
    expect(toError(e)).toBe(e);

    const zerr = z.string().safeParse(1).success ? null : z.string().safeParse(1);
    const inner = zerr && !zerr.success ? zerr.error : new Error('x');
    expect(toError(inner)).toBe(inner); // ZodError 也是 Error 的子类
  });

  it('原始值挂在 cause 上；string / number / null / undefined 都能处理', () => {
    expect(toError('oops').message).toBe('oops');
    expect(toError('oops').cause).toBe('oops');
    expect(toError(42).message).toBe('42');
    expect(toError(null).message).toBe('null');
    expect(toError(undefined).message).toBe('undefined');
    expect(toError(false).message).toBe('false');
    expect(toError(10n).message).toBe('10');
  });

  it('对象：优先取非空的 message，否则用 JSON.stringify', () => {
    expect(toError({ message: 'from api' }).message).toBe('from api');
    expect(toError({ message: '' }).message).toBe('{"message":""}'); // 空 message 不算
    expect(toError({ a: 1 }).message).toBe('{"a":1}');
    expect(toError([1, 2]).message).toBe('[1,2]');
  });

  it('😱 永不抛异常：循环引用 / symbol 也要能处理', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => toError(circular)).not.toThrow();
    expect(toError(circular).message).toBe('[unserializable value]');

    expect(toError(Symbol('s')).message).toBe('Symbol(s)');
  });
});

describe('7.2 AppError', () => {
  it('name 是【实际类名】，子类自动生效（提示：new.target）', () => {
    expect(new AppError('E_X', 'x').name).toBe('AppError');
    expect(new ConfigError('bad config').name).toBe('ConfigError');
    expect(String(new ConfigError('bad config'))).toBe('ConfigError: bad config');
    expect(new ConfigError('bad').stack?.split('\n')[0]).toBe('ConfigError: bad');
  });

  it('code 是稳定的错误码，比匹配 message 可靠', () => {
    expect(new AppError('E_USAGE', 'x').code).toBe('E_USAGE');
    expect(new ConfigError('x').code).toBe('E_CONFIG');
  });

  it('instanceof 链完整（target ES2023 不需要 setPrototypeOf）', () => {
    const e = new ConfigError('x');
    expect(e instanceof ConfigError).toBe(true);
    expect(e instanceof AppError).toBe(true);
    expect(e instanceof Error).toBe(true);
    expect(new AppError('E_X', 'x') instanceof ConfigError).toBe(false);
  });

  it('options 必须透传给 super，否则 cause 会丢', () => {
    const low = new Error('low');
    expect(new ConfigError('high', { cause: low }).cause).toBe(low);
    expect(new AppError('E_X', 'high', { cause: low }).cause).toBe(low);
    expect(new AppError('E_X', 'high').cause).toBeUndefined();
  });
});

describe('7.3 getRootCause', () => {
  it('沿 cause 链挖到最深的 Error', () => {
    const low = new Error('low');
    const mid = new Error('mid', { cause: low });
    const top = new Error('top', { cause: mid });
    expect(getRootCause(top)).toBe(low);
    expect(getRootCause(mid)).toBe(low);
  });

  it('没有 cause，或 cause 不是 Error 时返回自身', () => {
    const solo = new Error('solo');
    expect(getRootCause(solo)).toBe(solo);

    const strCause = new Error('x', { cause: 'not an error' });
    expect(getRootCause(strCause)).toBe(strCause);

    const objCause = new Error('x', { cause: { message: 'looks like error' } });
    expect(getRootCause(objCause)).toBe(objCause);
  });

  it('😱 cause 成环时不能死循环', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b; // 手工造环
    expect(getRootCause(a)).toBe(b);
    expect(getRootCause(b)).toBe(a);
  });
});

describe('7.4 Result 工具箱', () => {
  it('ok / err 的形状', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('bad')).toEqual({ ok: false, error: 'bad' });
    expect(ok(undefined)).toEqual({ ok: true, value: undefined });
  });

  it('isOk / isErr 是类型谓词，能在 if 里收窄类型', () => {
    const good: ReturnType<typeof ok<number>> = ok(7);
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);

    const bad = err<string>('nope');
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);

    // 收窄之后才能访问 .value（编译期验证）
    const r: import('@exercises/ch07-errors-validation').Result<number, string> = ok(3);
    if (isOk(r)) expect(r.value).toBe(3);
  });

  it('mapResult 只作用于成功分支，失败原样透传', () => {
    expect(mapResult(ok(2), (n: number) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(mapResult(err<string>('x'), (n: number) => n * 3)).toEqual({ ok: false, error: 'x' });
  });

  it('mapErrResult 只作用于失败分支；unwrapOr 不能被 0 / 空串坑到', () => {
    expect(mapErrResult(err('x'), (s: string) => `${s}!`)).toEqual({ ok: false, error: 'x!' });
    expect(mapErrResult(ok(1), (s: string) => `${s}!`)).toEqual({ ok: true, value: 1 });

    expect(unwrapOr(ok(0), 99)).toBe(0); // 写成 value ?? fallback 会挂在这条
    expect(unwrapOr(ok(''), 'fb')).toBe('');
    expect(unwrapOr(err<string>('x'), 99)).toBe(99);
  });
});

describe('7.5 collectResults', () => {
  it('全部成功 → ok(按序收集的值)', () => {
    expect(collectResults([ok(1), ok(2), ok(3)])).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('有失败 → err(【全部】错误)，不能遇到第一个就返回', () => {
    expect(collectResults([ok(1), err('a'), ok(2), err('b')])).toEqual({
      ok: false,
      error: ['a', 'b'],
    });
    expect(collectResults([err('only')])).toEqual({ ok: false, error: ['only'] });
  });

  it('空数组算成功', () => {
    expect(collectResults([])).toEqual({ ok: true, value: [] });
  });
});

describe('7.6a isUser', () => {
  it('合法 User（TS 是结构化类型，多余属性也合法）', () => {
    expect(isUser({ id: 1, name: 'a' })).toBe(true);
    expect(isUser({ id: 0, name: '' })).toBe(true);
    expect(isUser({ id: 1, name: 'a', email: 'a@b.com' })).toBe(true);
    expect(isUser({ id: 1, name: 'a', extra: 9 })).toBe(true);
    expect(isUser({ id: 1, name: 'a', email: undefined })).toBe(true);
  });

  it('id 必须是整数：NaN / 小数 / 字符串都不行', () => {
    expect(isUser({ id: NaN, name: 'a' })).toBe(false);
    expect(isUser({ id: 1.5, name: 'a' })).toBe(false);
    expect(isUser({ id: Infinity, name: 'a' })).toBe(false);
    expect(isUser({ id: '1', name: 'a' })).toBe(false);
    expect(isUser({ name: 'a' })).toBe(false);
  });

  it('name 必须是 string，email 存在时必须是 string', () => {
    expect(isUser({ id: 1, name: 123 })).toBe(false);
    expect(isUser({ id: 1 })).toBe(false);
    expect(isUser({ id: 1, name: 'a', email: 1 })).toBe(false);
    expect(isUser({ id: 1, name: 'a', email: null })).toBe(false);
  });

  it('😱 typeof null / typeof [] 都是 object，必须显式排除', () => {
    expect(isUser(null)).toBe(false);
    expect(isUser(undefined)).toBe(false);
    expect(isUser([])).toBe(false);
    expect(isUser('{"id":1,"name":"a"}')).toBe(false); // 没 JSON.parse 的字符串
  });
});

describe('7.6b assertNonNull', () => {
  it('有值时什么都不做（0 / 空串 / false 都不算空）', () => {
    expect(() => assertNonNull('x', 'foo')).not.toThrow();
    expect(() => assertNonNull(0, 'foo')).not.toThrow(); // 用 !value 判断会挂在这条
    expect(() => assertNonNull('', 'foo')).not.toThrow();
    expect(() => assertNonNull(false, 'foo')).not.toThrow();
    expect(() => assertNonNull(NaN, 'foo')).not.toThrow();
  });

  it('null / undefined 时抛 AppError，code 为 E_NULL', () => {
    expect(() => assertNonNull(null, 'user#1')).toThrow(AppError);
    expect(() => assertNonNull(undefined, 'user#1')).toThrow('user#1 is null or undefined');

    let caught: unknown;
    try {
      assertNonNull(null, 'cfg');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('E_NULL');
  });

  it('收窄之后可以直接用（编译期验证）', () => {
    const maybe: string | undefined = 'hello' as string | undefined;
    assertNonNull(maybe, 'maybe');
    expect(maybe.length).toBe(5); // 没有 asserts 签名的话这行编译不过
  });
});

describe('7.7 formatZodError', () => {
  it('path 用 . 连接，嵌套对象和数组下标都支持', () => {
    const Schema = z.object({
      name: z.string({ error: 'name 必须是字符串' }),
      db: z.object({ url: z.string({ error: 'db.url 必须是字符串' }) }),
      list: z.array(z.string({ error: 'list 的每一项都必须是字符串' })),
    });
    const parsed = Schema.safeParse({ db: {}, list: ['a', 1] });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('should have failed');

    expect(formatZodError(parsed.error)).toEqual([
      'name: name 必须是字符串',
      'db.url: db.url 必须是字符串',
      'list.1: list 的每一项都必须是字符串',
    ]);
  });

  it('顶层错误的 path 是空数组，输出 (root)', () => {
    const parsed = z.string({ error: '必须是字符串' }).safeParse(1);
    if (parsed.success) throw new Error('should have failed');
    expect(formatZodError(parsed.error)).toEqual(['(root): 必须是字符串']);
  });

  it('多个 issue 时顺序与 error.issues 一致', () => {
    const Schema = z.object({
      a: z.string({ error: 'a bad' }),
      b: z.number({ error: 'b bad' }),
    });
    const parsed = Schema.safeParse({});
    if (parsed.success) throw new Error('should have failed');
    expect(formatZodError(parsed.error)).toHaveLength(2);
    expect(formatZodError(parsed.error)[0]).toBe('a: a bad');
  });
});

describe('7.8 loadConfig', () => {
  it('成功时把默认值全部填好（z.infer 出来的类型一定有这些字段）', () => {
    expect(loadConfig({ name: 'svc', port: 8080, db: { url: 'postgres://x' } })).toEqual({
      ok: true,
      value: {
        name: 'svc',
        port: 8080,
        logLevel: 'info',
        retries: 3,
        db: { url: 'postgres://x', poolSize: 5 },
        tags: [],
      },
    });
  });

  it('显式传的值不会被默认值覆盖', () => {
    expect(
      loadConfig({
        name: 'svc',
        port: 1,
        logLevel: 'debug',
        retries: 0,
        db: { url: 'u', poolSize: 20 },
        tags: ['a'],
      }),
    ).toEqual({
      ok: true,
      value: {
        name: 'svc',
        port: 1,
        logLevel: 'debug',
        retries: 0,
        db: { url: 'u', poolSize: 20 },
        tags: ['a'],
      },
    });
  });

  it('失败时一次收集全部错误，格式为 path: message', () => {
    expect(loadConfig({ port: 0, db: {} })).toEqual({
      ok: false,
      error: [
        'name: name 必须是字符串',
        'port: port 必须在 1~65535 之间',
        'db.url: db.url 必须是字符串',
      ],
    });

    expect(loadConfig({ name: '', port: 1.5, db: { url: '' }, tags: [1] })).toEqual({
      ok: false,
      error: [
        'name: name 不能为空',
        'port: port 必须是整数',
        'db.url: db.url 不能为空',
        'tags.0: tags 的每一项都必须是字符串',
      ],
    });
  });

  it('🔴 strict：多余的键要报错（帮用户抓拼写错误）', () => {
    const r = loadConfig({ name: 'svc', port: 1, db: { url: 'u' }, prot: 8080 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('should have failed');
    expect(r.error).toHaveLength(1);
    expect(r.error[0]).toContain('prot');
    expect(r.error[0]?.startsWith('(root): ')).toBe(true);
  });

  it('输入完全不是对象也要给出错误而不是崩掉', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      const r = loadConfig(bad);
      expect(r.ok).toBe(false);
    }
  });
});

describe('7.9 loadEnv', () => {
  it('只给必填项时，其余全部走默认值', () => {
    expect(loadEnv({ API_KEY: 'k' })).toEqual({
      ok: true,
      value: { API_KEY: 'k', PORT: 3000, TIMEOUT_MS: 5000, DEBUG: false },
    });
  });

  it('z.coerce 把字符串变成真正的 number；DEBUG 只认 1 / true', () => {
    expect(loadEnv({ API_KEY: 'k', PORT: '8080', TIMEOUT_MS: '1500', DEBUG: 'true' })).toEqual({
      ok: true,
      value: { API_KEY: 'k', PORT: 8080, TIMEOUT_MS: 1500, DEBUG: true },
    });

    const one = loadEnv({ API_KEY: 'k', DEBUG: '1' });
    expect(one).toEqual({
      ok: true,
      value: { API_KEY: 'k', PORT: 3000, TIMEOUT_MS: 5000, DEBUG: true },
    });

    // 😱 不能用 z.coerce.boolean()：Boolean('false') === true
    for (const raw of ['false', '0', 'yes', 'off']) {
      const r = loadEnv({ API_KEY: 'k', DEBUG: raw });
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('should have succeeded');
      expect(r.value.DEBUG).toBe(false);
    }
  });

  it('😱 PORT= 空串必须走默认值，不能被 coerce 成 0', () => {
    const r = loadEnv({ API_KEY: 'k', PORT: '', TIMEOUT_MS: '   ' });
    expect(r).toEqual({
      ok: true,
      value: { API_KEY: 'k', PORT: 3000, TIMEOUT_MS: 5000, DEBUG: false },
    });
  });

  it('非法值给出 path: message 形式的错误', () => {
    expect(loadEnv({})).toEqual({ ok: false, error: ['API_KEY: API_KEY 必须是字符串'] });
    expect(loadEnv({ API_KEY: '' })).toEqual({
      ok: false,
      error: ['API_KEY: API_KEY 必须是字符串'],
    });
    expect(loadEnv({ API_KEY: 'k', PORT: 'abc' })).toEqual({
      ok: false,
      error: ['PORT: PORT 必须是数字'],
    });
    expect(loadEnv({ API_KEY: 'k', PORT: '8.5' })).toEqual({
      ok: false,
      error: ['PORT: PORT 必须是整数'],
    });
    expect(loadEnv({ API_KEY: 'k', PORT: '99999' })).toEqual({
      ok: false,
      error: ['PORT: PORT 必须在 1~65535 之间'],
    });
    expect(loadEnv({ API_KEY: 'k', TIMEOUT_MS: '0' })).toEqual({
      ok: false,
      error: ['TIMEOUT_MS: TIMEOUT_MS 必须是正整数'],
    });
  });
});

describe('7.10 parseCliEvent', () => {
  it('三种事件都能解析，多余的键被丢掉', () => {
    expect(parseCliEvent({ type: 'exit', code: 2 })).toEqual({
      ok: true,
      value: { type: 'exit', code: 2 },
    });
    expect(parseCliEvent({ type: 'start', command: 'build', at: 0 })).toEqual({
      ok: true,
      value: { type: 'start', command: 'build', at: 0 },
    });
    expect(parseCliEvent({ type: 'log', level: 'warn', message: 'hi', extra: 1 })).toEqual({
      ok: true,
      value: { type: 'log', level: 'warn', message: 'hi' },
    });
  });

  it('字段不合法时报到具体字段上', () => {
    expect(parseCliEvent({ type: 'exit', code: 1.5 })).toEqual({
      ok: false,
      error: ['code: code 必须是整数'],
    });
    expect(parseCliEvent({ type: 'start', command: '', at: -1 })).toEqual({
      ok: false,
      error: ['command: command 不能为空', 'at: at 必须是非负整数'],
    });
    expect(parseCliEvent({ type: 'log', level: 'trace', message: 1 })).toEqual({
      ok: false,
      error: ['level: level 只能是 debug|info|warn|error', 'message: message 必须是字符串'],
    });
  });

  it('未知的 type 只报一条错，且落在 type 上（用 z.union 会报一大堆）', () => {
    for (const bad of [{ type: 'nope' }, {}, { type: 42 }]) {
      const r = parseCliEvent(bad);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('should have failed');
      expect(r.error).toHaveLength(1);
      expect(r.error[0]?.startsWith('type: ')).toBe(true);
    }
  });

  it('非对象输入不会崩', () => {
    expect(parseCliEvent(null).ok).toBe(false);
    expect(parseCliEvent('exit').ok).toBe(false);
  });
});

describe('7.11 parseTimeRange', () => {
  it('合法区间，label 走默认值', () => {
    expect(parseTimeRange({ start: 1, end: 2 })).toEqual({
      ok: true,
      value: { start: 1, end: 2, label: 'range' },
    });
    expect(parseTimeRange({ start: 0, end: 100, label: 'today' })).toEqual({
      ok: true,
      value: { start: 0, end: 100, label: 'today' },
    });
  });

  it('.refine 跨字段校验：start 必须严格小于 end，错误落在 start 上', () => {
    expect(parseTimeRange({ start: 5, end: 5 })).toEqual({
      ok: false,
      error: ['start: start 必须严格小于 end'],
    });
    expect(parseTimeRange({ start: 9, end: 1 })).toEqual({
      ok: false,
      error: ['start: start 必须严格小于 end'],
    });
  });

  it('字段级校验', () => {
    expect(parseTimeRange({ start: -1, end: 1 })).toEqual({
      ok: false,
      error: ['start: start 必须是非负整数'],
    });
    expect(parseTimeRange({ start: 1, end: 2.5 })).toEqual({
      ok: false,
      error: ['end: end 必须是非负整数'],
    });
    expect(parseTimeRange({ start: 1, end: 2, label: '' })).toEqual({
      ok: false,
      error: ['label: label 不能为空'],
    });
  });

  it('😱 内层字段失败时外层 .refine 不会执行，所以只有一条错误', () => {
    expect(parseTimeRange({ start: 'a', end: 1 })).toEqual({
      ok: false,
      error: ['start: start 必须是非负整数'],
    });
    expect(parseTimeRange({})).toEqual({
      ok: false,
      error: ['start: start 必须是非负整数', 'end: end 必须是非负整数'],
    });
  });
});

describe('7.12 partitionParse', () => {
  const ItemSchema = z.object({
    id: z.number({ error: 'id 必须是数字' }),
    tag: z.string({ error: 'tag 必须是字符串' }).default('none'),
  });

  it('分离成功与失败，valid 里是【解析后】的数据（默认值已填好）', () => {
    const r = partitionParse(ItemSchema, [{ id: 1 }, { id: 'x' }, { id: 2, tag: 't' }]);
    expect(r.valid).toEqual([
      { id: 1, tag: 'none' },
      { id: 2, tag: 't' },
    ]);
    expect(r.invalid).toEqual([{ index: 1, input: { id: 'x' }, errors: ['id: id 必须是数字'] }]);
  });

  it('index 是原数组下标，input 是原始值', () => {
    const r = partitionParse(ItemSchema, [null, { id: 1 }, 'nope']);
    expect(r.valid).toEqual([{ id: 1, tag: 'none' }]);
    expect(r.invalid.map((x) => x.index)).toEqual([0, 2]);
    expect(r.invalid.map((x) => x.input)).toEqual([null, 'nope']);
    expect(r.invalid[0]?.errors[0]?.startsWith('(root): ')).toBe(true);
  });

  it('空数组 / 全部失败 / 全部成功', () => {
    expect(partitionParse(ItemSchema, [])).toEqual({ valid: [], invalid: [] });
    expect(partitionParse(ItemSchema, [{ id: 1 }, { id: 2, tag: 'x' }]).invalid).toEqual([]);
    expect(partitionParse(ItemSchema, [{}, {}]).valid).toEqual([]);
    expect(partitionParse(ItemSchema, [{}, {}]).invalid).toHaveLength(2);
  });
});
