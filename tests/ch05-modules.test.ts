import { describe, it, expect } from 'vitest';
import { cpus } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import {
  loadPlugin,
  getCurrentDirName,
  resolveFromHere,
  formatAsJson,
  formatAsCsv,
  formatAsLines,
  getFormatter,
  createExitCodeTable,
  exitCodeOf,
  parsePackageName,
  satisfiesCaret,
  resolveExports,
  classifyImportError,
} from '@exercises/ch05-modules';
import type { PluginName } from '@exercises/ch05-modules';

// 被测文件在 exercises/ 还是 solutions/ 下由 vitest.config.ts 的 alias 决定，
// 这里用同一个环境变量算出预期目录名（5.2 / 5.3 要用）。
const expectedDir = process.env.SOLUTIONS === '1' ? 'solutions' : 'exercises';

describe('5.1 loadPlugin', () => {
  it('动态 import node:crypto 并算出确定的 sha256', async () => {
    await expect(loadPlugin('hash')).resolves.toBe(
      '969545dde1584d88227517c6a0c969eb716015671cd6be053b3aaf14d85aa8c8',
    );
  });

  it('动态 import node:os 拿运行时信息', async () => {
    await expect(loadPlugin('platform')).resolves.toBe(process.platform);
    await expect(loadPlugin('cpus')).resolves.toBe(String(cpus().length));
  });

  it('未知插件要 reject（类型挡不住运行时传进来的脏字符串）', async () => {
    // 一个 `as` 断言就能绕过类型 —— 类型编译后不存在，运行时校验必须自己写。
    await expect(loadPlugin('yaml' as PluginName)).rejects.toThrow(/unknown plugin/);
  });
});

describe('5.2 getCurrentDirName', () => {
  it('返回当前文件所在目录的目录名（ESM 里没有 __dirname）', () => {
    expect(getCurrentDirName()).toBe(expectedDir);
  });

  it('只要最后一段，不能是完整路径', () => {
    const name = getCurrentDirName();
    expect(name.includes(sep)).toBe(false);
    expect(isAbsolute(name)).toBe(false);
  });
});

describe('5.3 resolveFromHere', () => {
  it('相对路径以【文件所在目录】为基准解析成绝对路径', () => {
    const p = resolveFromHere('ch05-modules.ts');
    expect(isAbsolute(p)).toBe(true);
    expect(p.endsWith(join(expectedDir, 'ch05-modules.ts'))).toBe(true);
  });

  it("支持 './' 和 '../'", () => {
    expect(resolveFromHere('./a/b.json').endsWith(join(expectedDir, 'a', 'b.json'))).toBe(true);
    const up = resolveFromHere('../tests');
    expect(up.endsWith(join('typescript', 'tests'))).toBe(true);
    expect(up.includes(expectedDir)).toBe(false);
  });

  it('传绝对路径时原样返回', () => {
    expect(resolveFromHere('/etc/hosts')).toBe('/etc/hosts');
  });
});

describe('5.4 formatter 注册表', () => {
  const rows = [
    { id: '1', name: 'a' },
    { id: '2', name: 'b' },
  ];

  it('三个 formatter 各自的输出', () => {
    expect(formatAsJson([{ id: '1' }])).toBe('[{"id":"1"}]');
    expect(formatAsCsv(rows)).toBe('id,name\n1,a\n2,b');
    expect(formatAsLines(rows)).toBe('id=1 name=a\nid=2 name=b');
  });

  it('空表格：csv 没有表头，json 是空数组', () => {
    expect(formatAsCsv([])).toBe('');
    expect(formatAsLines([])).toBe('');
    expect(formatAsJson([])).toBe('[]');
  });

  it('getFormatter 返回的必须是同一个函数引用，不能包一层', () => {
    expect(getFormatter('json')).toBe(formatAsJson);
    expect(getFormatter('csv')).toBe(formatAsCsv);
    expect(getFormatter('lines')).toBe(formatAsLines);
  });

  it('未注册的名字返回 undefined，且不能被原型链污染', () => {
    expect(getFormatter('yaml')).toBeUndefined();
    expect(getFormatter('toString')).toBeUndefined();
    expect(getFormatter('')).toBeUndefined();
  });
});

describe('5.5 常量表与查询', () => {
  it('表里的值正确', () => {
    const table = createExitCodeTable();
    expect(table.ok).toBe(0);
    expect(table.usage).toBe(64);
    expect(table.config).toBe(78);
  });

  it('Object.freeze 是运行时保护（readonly 只是编译期）', () => {
    const table = createExitCodeTable();
    expect(Object.isFrozen(table)).toBe(true);
    // 模块代码天然是严格模式，改冻结对象会直接抛 TypeError。
    expect(() => {
      (table as Record<string, number>).ok = 1;
    }).toThrow(TypeError);
  });

  it('查询命中返回数字，0 不能被当成"没查到"', () => {
    expect(exitCodeOf('config')).toBe(78);
    expect(exitCodeOf('dataErr')).toBe(65);
    expect(exitCodeOf('ok')).toBe(0); // 用 `|| undefined` 会挂在这一条
  });

  it('查询未命中返回 undefined，原型上的键不算命中', () => {
    expect(exitCodeOf('nope')).toBeUndefined();
    expect(exitCodeOf('toString')).toBeUndefined();
    expect(exitCodeOf('')).toBeUndefined();
  });
});

describe('5.6 parsePackageName', () => {
  it('普通包名，带不带版本都行', () => {
    expect(parsePackageName('lodash')).toEqual({
      scope: undefined,
      name: 'lodash',
      version: undefined,
      isBuiltin: false,
    });
    expect(parsePackageName('lodash@^4.17.0')).toEqual({
      scope: undefined,
      name: 'lodash',
      version: '^4.17.0',
      isBuiltin: false,
    });
    expect(parsePackageName('vitest@latest').version).toBe('latest');
  });

  it('scope 包名里有两个 @，不能用 split 硬拆', () => {
    expect(parsePackageName('@scope/pkg')).toEqual({
      scope: '@scope',
      name: 'pkg',
      version: undefined,
      isBuiltin: false,
    });
    expect(parsePackageName('@types/node@^26.4.0')).toEqual({
      scope: '@types',
      name: 'node',
      version: '^26.4.0',
      isBuiltin: false,
    });
  });

  it("'node:' 前缀才算内置模块，子路径要保留", () => {
    expect(parsePackageName('node:fs')).toEqual({
      scope: undefined,
      name: 'fs',
      version: undefined,
      isBuiltin: true,
    });
    expect(parsePackageName('node:fs/promises')).toEqual({
      scope: undefined,
      name: 'fs/promises',
      version: undefined,
      isBuiltin: true,
    });
    // 没有前缀就只是个普通包名（本教程要求内置模块一律写 node: 前缀）
    expect(parsePackageName('fs').isBuiltin).toBe(false);
  });

  it('非法输入抛错', () => {
    expect(() => parsePackageName('')).toThrow(/invalid package spec/);
    expect(() => parsePackageName('   ')).toThrow(/invalid package spec/);
    expect(() => parsePackageName('@scope')).toThrow(/invalid package spec/);
    expect(() => parsePackageName('@scope/')).toThrow(/invalid package spec/);
    expect(() => parsePackageName('lodash@')).toThrow(/invalid package spec/);
  });
});

describe('5.7 satisfiesCaret', () => {
  it('major >= 1：允许 minor / patch 往上升，不许跨 major', () => {
    expect(satisfiesCaret('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfiesCaret('1.2.9', '^1.2.3')).toBe(true);
    expect(satisfiesCaret('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfiesCaret('1.2.2', '^1.2.3')).toBe(false);
    expect(satisfiesCaret('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesCaret('0.9.9', '^1.2.3')).toBe(false);
  });

  it('0.x 的两条特例', () => {
    expect(satisfiesCaret('0.2.3', '^0.2.3')).toBe(true);
    expect(satisfiesCaret('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfiesCaret('0.3.0', '^0.2.3')).toBe(false); // 0.x 里 minor 也是破坏性的
    expect(satisfiesCaret('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfiesCaret('0.0.4', '^0.0.3')).toBe(false); // 0.0.x 锁死 patch
  });

  it('按数字比而不是按字符串比', () => {
    expect(satisfiesCaret('1.10.0', '^1.9.0')).toBe(true); // 字符串比较会得出 false
    expect(satisfiesCaret('1.9.0', '^1.10.0')).toBe(false);
    expect(satisfiesCaret('1.2.10', '^1.2.9')).toBe(true);
  });

  it('格式不合法要抛错', () => {
    expect(() => satisfiesCaret('1.2', '^1.2.3')).toThrow(/invalid version/);
    expect(() => satisfiesCaret('1.2.3', '1.2.3')).toThrow(/invalid version/);
    expect(() => satisfiesCaret('1.2.3', '~1.2.3')).toThrow(/invalid version/);
    expect(() => satisfiesCaret('v1.2.3', '^1.2.3')).toThrow(/invalid version/);
  });
});

describe('5.8 resolveExports', () => {
  it('字符串形式的 exports 只导出根路径', () => {
    expect(resolveExports('./dist/index.js', '.')).toBe('./dist/index.js');
    expect(resolveExports('./dist/index.js', './utils')).toBeUndefined();
  });

  it('子路径导出：精确匹配', () => {
    const field = { '.': './dist/index.js', './utils': './dist/utils.js' };
    expect(resolveExports(field, '.')).toBe('./dist/index.js');
    expect(resolveExports(field, './utils')).toBe('./dist/utils.js');
  });

  it('条件导出：忽略 types，按 node → import → default 取', () => {
    expect(
      resolveExports(
        { '.': { types: './dist/index.d.ts', node: './dist/node.js', default: './dist/any.js' } },
        '.',
      ),
    ).toBe('./dist/node.js');
    expect(resolveExports({ '.': { types: './x.d.ts', import: './dist/esm.js' } }, '.')).toBe(
      './dist/esm.js',
    );
    expect(resolveExports({ '.': { types: './x.d.ts', default: './dist/any.js' } }, '.')).toBe(
      './dist/any.js',
    );
    // 只有 types 的话运行时无路可走
    expect(resolveExports({ '.': { types: './x.d.ts' } }, '.')).toBeUndefined();
  });

  it('通配导出，且精确 key 优先于通配 key', () => {
    expect(resolveExports({ './features/*': './dist/features/*.js' }, './features/log')).toBe(
      './dist/features/log.js',
    );
    const field = {
      './features/*': './dist/features/*.js',
      './features/log': './dist/features/log-special.js',
    };
    expect(resolveExports(field, './features/log')).toBe('./dist/features/log-special.js');
    expect(resolveExports(field, './features/other')).toBe('./dist/features/other.js');
  });

  it('没导出的子路径解析不到（别人没法 deep import）', () => {
    expect(resolveExports({ '.': './dist/index.js' }, './internal/secret')).toBeUndefined();
    expect(resolveExports({ './features/*': './dist/features/*.js' }, './features/')).toBeUndefined();
    expect(resolveExports({}, '.')).toBeUndefined();
  });
});

describe('5.9 classifyImportError', () => {
  it('CJS/ESM 互操作的两个经典报错', () => {
    expect(
      classifyImportError(
        'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/chalk/index.js not supported',
      ),
    ).toBe('require-esm');
    expect(
      classifyImportError('SyntaxError: Cannot use import statement outside a module'),
    ).toBe('import-outside-module');
  });

  it('ESM 里用了 CJS 的全局变量', () => {
    expect(classifyImportError('ReferenceError: __dirname is not defined in ES module scope')).toBe(
      'cjs-global-in-esm',
    );
    expect(classifyImportError('ReferenceError: require is not defined in ES module scope')).toBe(
      'cjs-global-in-esm',
    );
  });

  it('找不到模块：区分"少写扩展名"和"包真的没装"', () => {
    expect(
      classifyImportError(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/utils' imported from " +
          '/app/main.js. Did you mean to import "./utils.js"?',
      ),
    ).toBe('missing-extension');
    expect(
      classifyImportError("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash' imported from /app/main.js"),
    ).toBe('module-not-found');
    expect(
      classifyImportError("Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '/app/lib' is not supported"),
    ).toBe('unsupported-dir-import');
  });

  it('认不出来就是 unknown', () => {
    expect(classifyImportError('TypeError: x is not a function')).toBe('unknown');
    expect(classifyImportError('')).toBe('unknown');
  });
});
