import { describe, it, expect } from 'vitest';
import {
  dedupe,
  chunk,
  rankPlayers,
  minMaxAvg,
  topWords,
  groupBy,
  flattenDeep,
  compareSets,
  serviceStats,
  deepMerge,
  safeJsonParse,
  windows,
  type Player,
} from '@exercises/ch03-data-structures';

describe('3.1 dedupe', () => {
  it('保持首次出现顺序', () => {
    expect(dedupe([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
    expect(dedupe(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(dedupe([])).toEqual([]);
  });

  it('NaN 也能去重（indexOf 做不到，Set 用 SameValueZero）', () => {
    expect(dedupe([NaN, NaN, 1]).length).toBe(2);
    expect(dedupe([0, -0]).length).toBe(1);
  });

  it('不修改入参', () => {
    const input = [2, 2, 1];
    expect(dedupe(input)).toEqual([2, 1]);
    expect(input).toEqual([2, 2, 1]); // 原数组必须原封不动
  });

  it('对象按引用去重（不是按内容）', () => {
    const shared = { id: 1 };
    expect(dedupe([shared, shared])).toEqual([{ id: 1 }]);
    expect(dedupe([{ id: 1 }, { id: 1 }]).length).toBe(2); // 😱 两个不同引用
  });
});

describe('3.2 chunk', () => {
  it('正常切分，最后一块可以不满', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('空数组返回空数组，且不修改入参', () => {
    const input = [1, 2, 3];
    expect(chunk([], 2)).toEqual([]);
    chunk(input, 2);
    expect(input).toEqual([1, 2, 3]);
  });

  it('size 非正整数抛错（0 会死循环，必须拦住）', () => {
    expect(chunk([1], 1)).toEqual([[1]]); // 先确认实现存在
    expect(() => chunk([1], 0)).toThrow(/正整数/);
    expect(() => chunk([1], -1)).toThrow(/正整数/);
    expect(() => chunk([1], 1.5)).toThrow(/正整数/);
  });
});

describe('3.3 rankPlayers', () => {
  const players: readonly Player[] = [
    { name: 'bob', score: 10, level: 1 },
    { name: 'amy', score: 100, level: 1 },
    { name: 'cid', score: 10, level: 9 },
  ];

  it('score 降序，score 相同看 level 降序', () => {
    expect(rankPlayers(players).map((p) => p.name)).toEqual(['amy', 'cid', 'bob']);
  });

  it('数字要按数值比，不能按字符串字典序', () => {
    const nums: readonly Player[] = [
      { name: 'a', score: 9, level: 0 },
      { name: 'b', score: 10, level: 0 },
      { name: 'c', score: 1, level: 0 },
    ];
    // 默认 sort() 会得到 1, 10, 9 —— 这题就是在考这个坑
    expect(rankPlayers(nums).map((p) => p.score)).toEqual([10, 9, 1]);
  });

  it('score 和 level 都相同时按名字升序，中文按拼音（localeCompare）', () => {
    const same: readonly Player[] = [
      { name: '张三', score: 1, level: 1 },
      { name: '李四', score: 1, level: 1 },
      { name: '王五', score: 1, level: 1 },
    ];
    expect(rankPlayers(same).map((p) => p.name)).toEqual(['李四', '王五', '张三']);
  });

  it('绝不修改传进来的数组', () => {
    const input: Player[] = [
      { name: 'x', score: 1, level: 1 },
      { name: 'y', score: 2, level: 1 },
    ];
    const out = rankPlayers(input);
    expect(out.map((p) => p.name)).toEqual(['y', 'x']);
    expect(input.map((p) => p.name)).toEqual(['x', 'y']); // 用 sort 就会挂在这一条
    expect(out).not.toBe(input);
  });
});

describe('3.4 minMaxAvg', () => {
  it('返回 [min, max, avg] 元组', () => {
    expect(minMaxAvg([3, 1, 2])).toEqual([1, 3, 2]);
    expect(minMaxAvg([5])).toEqual([5, 5, 5]);
    expect(minMaxAvg([1, 2])).toEqual([1, 2, 1.5]);
  });

  it('平均值四舍五入到 2 位小数，支持负数', () => {
    expect(minMaxAvg([-3, 0, 1])).toEqual([-3, 1, -0.67]);
    expect(minMaxAvg([0.1, 0.2])).toEqual([0.1, 0.2, 0.15]); // 不要出现浮点尾巴
  });

  it('空数组返回 null（不是 [Infinity, -Infinity, NaN]）', () => {
    expect(minMaxAvg([])).toBeNull();
  });

  it('解构出来就是 Go 风格的多返回值', () => {
    const result = minMaxAvg([4, 8]);
    expect(result).not.toBeNull();
    if (result !== null) {
      const [lo, hi, avg] = result;
      expect(lo).toBe(4);
      expect(hi).toBe(8);
      expect(avg).toBe(6);
    }
  });
});

describe('3.5 topWords', () => {
  it('按次数降序取前 n 个', () => {
    expect(topWords(['a', 'b', 'a', 'c', 'b', 'a'], 2)).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('次数相同按词升序；n 超出词种类数就全返回', () => {
    expect(topWords(['y', 'x'], 5)).toEqual([
      ['x', 1],
      ['y', 1],
    ]);
  });

  it('trim 后统计，空白词忽略', () => {
    expect(topWords(['  ', ' a ', 'a', '\t'], 3)).toEqual([['a', 2]]);
  });

  it('n <= 0 返回空数组', () => {
    expect(topWords(['a'], 0)).toEqual([]);
    expect(topWords(['a'], -1)).toEqual([]);
    expect(topWords([], 3)).toEqual([]);
  });
});

describe('3.6 groupBy', () => {
  it('分组，键的顺序是首次出现顺序', () => {
    const grouped = groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'even' : 'odd'));
    expect([...grouped.keys()]).toEqual(['odd', 'even']);
    expect(grouped.get('odd')).toEqual([1, 3]);
    expect(grouped.get('even')).toEqual([2, 4]);
  });

  it('返回的是 Map，所以键可以是非字符串', () => {
    const grouped = groupBy([1.2, 1.8, 2.4], (n) => Math.trunc(n));
    expect(grouped).toBeInstanceOf(Map);
    expect(grouped.get(1)).toEqual([1.2, 1.8]);
    expect(grouped.get(2)).toEqual([2.4]);
    expect(grouped.get('1' as unknown as number)).toBeUndefined(); // 数字键没被转成字符串
  });

  it('空输入得到空 Map，且不修改入参', () => {
    const input = [3, 1];
    expect(groupBy([], (n: number) => n).size).toBe(0);
    groupBy(input, (n) => n);
    expect(input).toEqual([3, 1]);
  });
});

describe('3.7 flattenDeep', () => {
  it('任意深度都拉平（flat() 不带参数只展开一层）', () => {
    expect(flattenDeep([1, [2, [3, [4]]], 5])).toEqual([1, 2, 3, 4, 5]);
    expect(flattenDeep([[1], [2, 3]])).toEqual([1, 2, 3]);
  });

  it('空数组和全空嵌套', () => {
    expect(flattenDeep([])).toEqual([]);
    expect(flattenDeep([[], [[]], [[[1]]]])).toEqual([1]);
  });

  it('顺序是深度优先、从左到右', () => {
    expect(flattenDeep([[1, [2]], 3, [[4], 5]])).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('3.8 compareSets', () => {
  it('交集 + 两侧差集，全部去重', () => {
    expect(compareSets(['a', 'b', 'c', 'a'], ['c', 'd', 'b'])).toEqual({
      both: ['b', 'c'],
      onlyA: ['a'],
      onlyB: ['d'],
    });
  });

  it('顺序：both 和 onlyA 按 a 的首次出现顺序，onlyB 按 b 的顺序', () => {
    expect(compareSets(['z', 'm', 'a'], ['a', 'z', 'q', 'q'])).toEqual({
      both: ['z', 'a'],
      onlyA: ['m'],
      onlyB: ['q'],
    });
  });

  it('空数组边界', () => {
    expect(compareSets([], ['x'])).toEqual({ both: [], onlyA: [], onlyB: ['x'] });
    expect(compareSets(['x'], [])).toEqual({ both: [], onlyA: ['x'], onlyB: [] });
    expect(compareSets([], [])).toEqual({ both: [], onlyA: [], onlyB: [] });
  });
});

describe('3.9 serviceStats', () => {
  it('统计每个服务，按 total 降序', () => {
    expect(serviceStats({ auth: [10, 20], db: [100], idle: [] })).toEqual([
      { name: 'db', count: 1, total: 100, avg: 100 },
      { name: 'auth', count: 2, total: 30, avg: 15 },
      { name: 'idle', count: 0, total: 0, avg: 0 },
    ]);
  });

  it('空采样不能算出 NaN（防除零）', () => {
    const [only] = serviceStats({ nothing: [] });
    expect(only).toEqual({ name: 'nothing', count: 0, total: 0, avg: 0 });
    expect(Number.isNaN(only?.avg)).toBe(false);
  });

  it('avg 四舍五入到 2 位小数；total 相同按名字升序', () => {
    expect(serviceStats({ a: [1, 1, 1], b: [10, 10, 10] })).toEqual([
      { name: 'b', count: 3, total: 30, avg: 10 },
      { name: 'a', count: 3, total: 3, avg: 1 },
    ]);
    expect(serviceStats({ z: [1, 2], y: [3] })).toEqual([
      { name: 'y', count: 1, total: 3, avg: 3 },
      { name: 'z', count: 2, total: 3, avg: 1.5 },
    ]);
    expect(serviceStats({ s: [1, 1, 2] })[0]?.avg).toBe(1.33);
  });

  it('空对象返回空数组', () => {
    expect(serviceStats({})).toEqual([]);
  });
});

describe('3.10 deepMerge', () => {
  it('嵌套对象递归合并', () => {
    expect(deepMerge({ a: 1, db: { host: 'x', port: 1 } }, { db: { port: 2 }, c: 3 })).toEqual({
      a: 1,
      db: { host: 'x', port: 2 },
      c: 3,
    });
  });

  it('数组整体替换，undefined 不覆盖，null / 0 / false 会覆盖', () => {
    expect(deepMerge({ list: [1, 2] }, { list: [9] })).toEqual({ list: [9] });
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: null });
    expect(deepMerge({ a: 1, b: true }, { a: 0, b: false })).toEqual({ a: 0, b: false });
  });

  it('不修改任何入参', () => {
    const base = { db: { host: 'x' } };
    const patch = { db: { port: 2 } };
    const out = deepMerge(base, patch);
    expect(out).toEqual({ db: { host: 'x', port: 2 } });
    expect(base).toEqual({ db: { host: 'x' } });
    expect(patch).toEqual({ db: { port: 2 } });
    expect(out).not.toBe(base);
  });

  it('🔴 防原型污染：__proto__ / constructor / prototype 键被忽略', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true},"safe":1}') as Record<
      string,
      unknown
    >;
    const out = deepMerge({}, payload);
    expect(out).toEqual({ safe: 1 });
    // 全进程的 Object.prototype 不能被写脏
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(deepMerge({}, { constructor: 'evil', prototype: 'evil', ok: 1 })).toEqual({ ok: 1 });
  });
});

describe('3.11 safeJsonParse', () => {
  const isNums = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'number');

  it('合法且形状正确', () => {
    expect(safeJsonParse('[1,2]', isNums)).toEqual({ ok: true, value: [1, 2] });
    expect(safeJsonParse('[]', isNums)).toEqual({ ok: true, value: [] });
  });

  it('形状不对返回 invalid shape（而不是让 any 蒙混过关）', () => {
    expect(safeJsonParse('[1,"a"]', isNums)).toEqual({ ok: false, error: 'invalid shape' });
    expect(safeJsonParse('{"a":1}', isNums)).toEqual({ ok: false, error: 'invalid shape' });
    expect(safeJsonParse('null', isNums)).toEqual({ ok: false, error: 'invalid shape' });
  });

  it('语法错误不抛异常，返回 invalid json', () => {
    expect(safeJsonParse('{oops', isNums)).toEqual({ ok: false, error: 'invalid json' });
    expect(safeJsonParse('', isNums)).toEqual({ ok: false, error: 'invalid json' });
    expect(safeJsonParse('undefined', isNums)).toEqual({ ok: false, error: 'invalid json' });
  });

  it('ok 为 true 时才允许访问 value（可辨识联合）', () => {
    const r = safeJsonParse('[7]', isNums);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]).toBe(7);
  });
});

describe('3.12 windows', () => {
  it('默认 step = 1，窗口重叠', () => {
    expect([...windows([1, 2, 3, 4], 2)]).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it('step > 1 时跳步，末尾不足一个窗口的丢掉', () => {
    expect([...windows([1, 2, 3, 4, 5], 2, 2)]).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect([...windows([1, 2, 3, 4, 5, 6], 2, 3)]).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect([...windows([1, 2], 3)]).toEqual([]);
  });

  it('任何可迭代对象都能吃（字符串 / Set）', () => {
    expect([...windows('abc', 2)]).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect([...windows(new Set([1, 2, 3]), 3)]).toEqual([[1, 2, 3]]);
  });

  it('必须惰性：无限生成器也能只取前两个窗口', () => {
    function* naturals(): Generator<number, void, undefined> {
      let i = 1;
      while (true) yield i++;
    }
    const it = windows(naturals(), 3);
    expect(it.next().value).toEqual([1, 2, 3]);
    expect(it.next().value).toEqual([2, 3, 4]);
  });

  it('每个窗口都是新数组（不能复用同一个 buffer）', () => {
    const got = [...windows([1, 2, 3], 2)];
    expect(got[0]).toEqual([1, 2]); // 如果 yield 的是同一个 buffer，这里会变成 [2,3]
    expect(got[0]).not.toBe(got[1]);
  });

  it('size / step 非正整数抛错', () => {
    expect([...windows([1], 1)]).toEqual([[1]]);
    expect(() => [...windows([1, 2], 0)]).toThrow(/正整数/);
    expect(() => [...windows([1, 2], 2, 0)]).toThrow(/正整数/);
    expect(() => [...windows([1, 2], 1.5)]).toThrow(/正整数/);
  });
});
