import { describe, it, expect } from 'vitest';
import {
  intDiv,
  parseIntStrict,
  isBlank,
  pickPort,
  truthyCount,
  kindOf,
  countCodePoints,
  describeRetry,
  numberLines,
  parseKeyValues,
} from '@exercises/ch01-basics';

describe('1.1 intDiv', () => {
  it('向零取整（和 Java 的 int/int 一致）', () => {
    expect(intDiv(7, 2)).toBe(3);
    expect(intDiv(6, 2)).toBe(3);
    expect(intDiv(-7, 2)).toBe(-3); // 不是 -4！
    expect(intDiv(7, -2)).toBe(-3);
    expect(intDiv(1, 3)).toBe(0);
  });

  it('除零返回 null 而不是 Infinity / NaN', () => {
    expect(intDiv(7, 0)).toBeNull();
    expect(intDiv(0, 0)).toBeNull();
    expect(intDiv(-1, 0)).toBeNull();
  });
});

describe('1.2 parseIntStrict', () => {
  it('接受合法整数', () => {
    expect(parseIntStrict('42')).toBe(42);
    expect(parseIntStrict('0')).toBe(0);
    expect(parseIntStrict('  -7 ')).toBe(-7);
    expect(parseIntStrict('+3')).toBe(3);
    expect(parseIntStrict('007')).toBe(7);
  });

  it('拒绝 parseInt 会放过的输入', () => {
    expect(parseIntStrict('42abc')).toBeNull();
    expect(parseIntStrict('0x1f')).toBeNull();
    expect(parseIntStrict('12 34')).toBeNull();
  });

  it('拒绝 Number 会放过的输入', () => {
    expect(parseIntStrict('')).toBeNull(); // Number('') === 0
    expect(parseIntStrict('   ')).toBeNull();
    expect(parseIntStrict('3.5')).toBeNull();
    expect(parseIntStrict('1e3')).toBeNull();
    expect(parseIntStrict('Infinity')).toBeNull();
  });

  it('拒绝超出安全整数范围的值', () => {
    expect(parseIntStrict('9007199254740993')).toBeNull();
    expect(parseIntStrict('9007199254740991')).toBe(9_007_199_254_740_991);
  });
});

describe('1.3 isBlank', () => {
  it('null / undefined / 空白都算空', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('\t\n ')).toBe(true);
  });

  it("'0' 和 'false' 不算空（别用 falsy 判断）", () => {
    expect(isBlank('0')).toBe(false);
    expect(isBlank('false')).toBe(false);
    expect(isBlank(' a ')).toBe(false);
  });
});

describe('1.4 pickPort', () => {
  it('0 是合法端口值，不能被默认值吃掉', () => {
    expect(pickPort(0, 8080)).toBe(0); // 用 || 会挂在这一条
  });

  it('只有 null / undefined 才走默认值', () => {
    expect(pickPort(3000, 8080)).toBe(3000);
    expect(pickPort(null, 8080)).toBe(8080);
    expect(pickPort(undefined, 8080)).toBe(8080);
  });
});

describe('1.5 truthyCount', () => {
  it('只有 8 个假值', () => {
    expect(truthyCount([0, 1, '', 'a', null, undefined, NaN, [], {}, false, '0'])).toBe(5);
  });

  it('边界', () => {
    expect(truthyCount([])).toBe(0);
    expect(truthyCount([-0, 0n, ''])).toBe(0);
    expect(truthyCount([' ', '0', -1, 1n, () => {}])).toBe(5);
  });
});

describe('1.6 kindOf', () => {
  it('修正 typeof 的两个坑', () => {
    expect(kindOf(null)).toBe('null');
    expect(kindOf([1, 2])).toBe('array');
    expect(kindOf([])).toBe('array');
  });

  it('其它情况等价于 typeof', () => {
    expect(kindOf({})).toBe('object');
    expect(kindOf('x')).toBe('string');
    expect(kindOf(1)).toBe('number');
    expect(kindOf(NaN)).toBe('number');
    expect(kindOf(true)).toBe('boolean');
    expect(kindOf(undefined)).toBe('undefined');
    expect(kindOf(1n)).toBe('bigint');
    expect(kindOf(Symbol('s'))).toBe('symbol');
    expect(kindOf(() => {})).toBe('function');
  });
});

describe('1.7 countCodePoints', () => {
  it('ASCII', () => {
    expect(countCodePoints('hello')).toBe(5);
    expect(countCodePoints('')).toBe(0);
  });

  it('emoji 只算一个字符', () => {
    expect('👍'.length).toBe(2); // 先感受一下坑
    expect(countCodePoints('👍')).toBe(1);
    expect(countCodePoints('a👍b')).toBe(3);
    expect(countCodePoints('中文abc')).toBe(5);
  });
});

describe('1.8 describeRetry', () => {
  it('全部走默认值', () => {
    expect(describeRetry({})).toBe('task: 3 次重试, 间隔 100ms');
  });

  it('部分覆盖', () => {
    expect(describeRetry({ times: 5 })).toBe('task: 5 次重试, 间隔 100ms');
    expect(describeRetry({ label: 'fetch' })).toBe('fetch: 3 次重试, 间隔 100ms');
  });

  it('显式传 0 必须保留（默认值只对 undefined 生效）', () => {
    expect(describeRetry({ label: 'fetch', delayMs: 0 })).toBe('fetch: 3 次重试, 间隔 0ms');
    expect(describeRetry({ times: 0, delayMs: 0 })).toBe('task: 0 次重试, 间隔 0ms');
  });
});

describe('1.9 numberLines', () => {
  it('跳过空白行，序号连续', () => {
    expect(numberLines(['a', '', 'b'])).toEqual(['1:a', '2:b']);
    expect(numberLines(['', '', 'only'])).toEqual(['1:only']);
  });

  it('不修改值本身', () => {
    expect(numberLines([' x ', '  ', 'y'])).toEqual(['1: x ', '2:y']);
  });

  it('空数组', () => {
    expect(numberLines([])).toEqual([]);
  });
});

describe('1.10 parseKeyValues', () => {
  it('全部合法', () => {
    expect(parseKeyValues(['port=8080', 'debug=true'])).toEqual({
      ok: true,
      entries: [
        ['port', '8080'],
        ['debug', 'true'],
      ],
      errors: [],
    });
  });

  it('空值合法，只按第一个 = 切分', () => {
    expect(parseKeyValues(['empty=', 'x=y=z'])).toEqual({
      ok: true,
      entries: [
        ['empty', ''],
        ['x', 'y=z'],
      ],
      errors: [],
    });
  });

  it('缺少 = 或 key 为空时进 errors', () => {
    expect(parseKeyValues(['a=1', 'bad', '=2', 'x=y=z'])).toEqual({
      ok: false,
      entries: [
        ['a', '1'],
        ['x', 'y=z'],
      ],
      errors: ['bad', '=2'],
    });
  });

  it('空输入', () => {
    expect(parseKeyValues([])).toEqual({ ok: true, entries: [], errors: [] });
  });
});
