/**
 * 第 05 章练习 · 模块与工程化
 * =====================================================================
 * 对应文档：docs/05-modules-and-tooling.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch05`  或者 `pnpm vitest tests/ch05`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch05-modules.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 说明：模块这一章的知识点大多"跨文件"，但练习全部收在这一个文件里。
 *       办法是：动态 import Node 内置模块、用 import.meta 认路、
 *       以及把 package.json / 语义化版本 / 报错信息当成**纯数据**来解析。
 * =====================================================================
 */

import { basename, resolve } from 'node:path';

/**
 * 练习 5.1 ⭐⭐ —— 动态 import（`await import()`）
 *
 * 实现一个"插件加载器"：**运行时**按名字动态加载 Node 内置模块并取一条信息。
 * 要求必须用 `await import('node:xxx')`，不许在文件顶部静态 import 这两个模块
 * （静态 import 会让模块在启动时就被加载，动态 import 才是懒加载）。
 *
 *   'hash'     -> 用 node:crypto 算 'typescript' 的 sha256，返回 hex 字符串
 *   'platform' -> 用 node:os 返回 os.platform()（等于 process.platform）
 *   'cpus'     -> 用 node:os 返回 CPU 核数的**字符串**形式，如 '8'
 *   其它       -> reject（抛出）Error，message 里必须包含 'unknown plugin'
 *
 * await loadPlugin('hash')     === '969545dde1584d88227517c6a0c969eb716015671cd6be053b3aaf14d85aa8c8'
 * await loadPlugin('platform') === 'linux'   // 取决于你的机器
 * await loadPlugin('cpus')     === '16'      // 取决于你的机器
 */
export type PluginName = 'hash' | 'platform' | 'cpus';

export async function loadPlugin(name: PluginName): Promise<string> {
  throw new Error('TODO 5.1: 实现 loadPlugin');
}

/**
 * 练习 5.2 ⭐ —— ESM 里没有 `__dirname`
 *
 * 返回**当前这个文件所在目录的目录名**（只要最后一段，不要完整路径）。
 * 本文件在 exercises/ 下，所以结果是 'exercises'；
 * 参考答案在 solutions/ 下跑，结果就是 'solutions'。
 *
 * 提示：ESM 里 `__dirname` / `__filename` 根本不存在，用 `import.meta`。
 *
 * getCurrentDirName() === 'exercises'
 */
export function getCurrentDirName(): string {
  throw new Error('TODO 5.2: 实现 getCurrentDirName');
}

/**
 * 练习 5.3 ⭐⭐ —— 相对当前文件解析路径
 *
 * 把一个相对路径解析成**绝对路径**，基准点是**当前文件所在目录**
 * （不是进程的 cwd —— 这两个是完全不同的东西，CLI 里最容易搞混）。
 *
 * resolveFromHere('ch05-modules.ts')  -> '/abs/path/to/exercises/ch05-modules.ts'
 * resolveFromHere('./a/b.json')       -> '/abs/path/to/exercises/a/b.json'
 * resolveFromHere('../tests')         -> '/abs/path/to/tests'
 * resolveFromHere('/etc/hosts')       -> '/etc/hosts'    // 绝对路径原样返回
 */
export function resolveFromHere(relative: string): string {
  throw new Error('TODO 5.3: 实现 resolveFromHere');
}

/**
 * 练习 5.4 ⭐⭐ —— named export 的组织：formatter 注册表
 *
 * 这是 barrel / 插件注册表的最小版本：三个独立的 named export，
 * 外加一个按名字查找的入口。真实项目里三个 formatter 会在三个文件里，
 * 由 index.ts 用 `export { formatAsJson } from './json.js'` 汇总。
 *
 * 表格数据保证：所有行的**列名和顺序都一致**，值里不含逗号和换行。
 *
 *   formatAsJson([{ id: '1' }])                        === '[{"id":"1"}]'
 *   formatAsCsv([{ id: '1', name: 'a' }, { id: '2', name: 'b' }])
 *                                                      === 'id,name\n1,a\n2,b'
 *   formatAsCsv([])                                    === ''      // 没有行就没有表头
 *   formatAsLines([{ id: '1', name: 'a' }, { id: '2', name: 'b' }])
 *                                                      === 'id=1 name=a\nid=2 name=b'
 *
 * getFormatter 按名字返回上面**同一个函数对象**（不是包一层新函数！）：
 *   getFormatter('json')  === formatAsJson
 *   getFormatter('csv')   === formatAsCsv
 *   getFormatter('lines') === formatAsLines
 *   getFormatter('yaml')  === undefined
 */
export interface TableRow {
  readonly [column: string]: string;
}

export type Formatter = (rows: readonly TableRow[]) => string;

export function formatAsJson(rows: readonly TableRow[]): string {
  throw new Error('TODO 5.4: 实现 formatAsJson');
}

export function formatAsCsv(rows: readonly TableRow[]): string {
  throw new Error('TODO 5.4: 实现 formatAsCsv');
}

export function formatAsLines(rows: readonly TableRow[]): string {
  throw new Error('TODO 5.4: 实现 formatAsLines');
}

export function getFormatter(name: string): Formatter | undefined {
  throw new Error('TODO 5.4: 实现 getFormatter（内部建一个 registry 对象）');
}

/**
 * 练习 5.5 ⭐⭐ —— `as const` + `Object.freeze` 的常量表
 *
 * 导出一张"退出码"常量表（沿用 BSD sysexits 的取值），要求：
 *   - 返回的对象必须被 `Object.freeze` 冻结（运行时也改不动，不只是编译期 readonly）
 *   - 值：ok=0, usage=64, dataErr=65, noInput=66, software=70, config=78
 *
 * 再实现一个查询函数，输入是**任意字符串**（比如命令行传进来的），
 * 命中表里的键就返回对应数字，否则返回 undefined。
 *
 * createExitCodeTable().usage        === 64
 * Object.isFrozen(createExitCodeTable()) === true
 * exitCodeOf('config')               === 78
 * exitCodeOf('ok')                   === 0          // 注意 0，别被 falsy 坑
 * exitCodeOf('nope')                 === undefined
 * exitCodeOf('toString')             === undefined   // 别把原型上的属性算进来
 */
export type ExitCodeName = 'ok' | 'usage' | 'dataErr' | 'noInput' | 'software' | 'config';

export function createExitCodeTable(): Readonly<Record<ExitCodeName, number>> {
  throw new Error('TODO 5.5: 实现 createExitCodeTable');
}

export function exitCodeOf(name: string): number | undefined {
  throw new Error('TODO 5.5: 实现 exitCodeOf');
}

/**
 * 练习 5.6 ⭐⭐⭐ —— 解析 npm 包名规格（`pnpm add` 的参数长什么样）
 *
 * 输入一个包规格字符串，拆成 { scope, name, version, isBuiltin }：
 *   - scope   带 `@`，如 '@types'；没有 scope 时为 undefined
 *   - name    **不含** scope 的包名；内置模块不含 'node:' 前缀
 *   - version 版本区间原样保留（`^4.17.0` / `1.0.0` / `latest`）；没写时 undefined
 *   - isBuiltin 只有 'node:' 前缀的才算内置模块
 *
 * parsePackageName('lodash')
 *   -> { scope: undefined, name: 'lodash',  version: undefined,  isBuiltin: false }
 * parsePackageName('lodash@^4.17.0')
 *   -> { scope: undefined, name: 'lodash',  version: '^4.17.0',  isBuiltin: false }
 * parsePackageName('@scope/pkg')
 *   -> { scope: '@scope',  name: 'pkg',     version: undefined,  isBuiltin: false }
 * parsePackageName('@scope/pkg@1.0.0')
 *   -> { scope: '@scope',  name: 'pkg',     version: '1.0.0',    isBuiltin: false }
 * parsePackageName('node:fs')
 *   -> { scope: undefined, name: 'fs',      version: undefined,  isBuiltin: true }
 * parsePackageName('node:fs/promises')
 *   -> { scope: undefined, name: 'fs/promises', version: undefined, isBuiltin: true }
 *
 * 非法输入抛 Error（message 含 'invalid package spec'）：
 *   ''、'   '、'@scope'（scope 后面没有包名）、'@scope/'、'lodash@'（有 @ 没版本）
 *
 * 😱 坑：scope 包名里有**两个** '@'，不能用 split('@') 硬拆。
 */
export interface PackageSpec {
  scope: string | undefined;
  name: string;
  version: string | undefined;
  isBuiltin: boolean;
}

export function parsePackageName(spec: string): PackageSpec {
  throw new Error('TODO 5.6: 实现 parsePackageName');
}

/**
 * 练习 5.7 ⭐⭐⭐ —— `^` 到底允许升到哪
 *
 * 判断一个精确版本号是否满足 caret 区间。规则（npm 的真实规则）：
 *   - major >= 1：`^1.2.3` 等价于 >=1.2.3 <2.0.0
 *   - major === 0 且 minor > 0：`^0.2.3` 等价于 >=0.2.3 <0.3.0    ← 只锁到 minor
 *   - major === 0 且 minor === 0：`^0.0.3` 等价于 >=0.0.3 <0.0.4  ← 锁死 patch
 *   （0.x 这两条特例正是"0.x 版本别当稳定版用"的原因）
 *
 * 只处理 `x.y.z` 三段纯数字，不考虑预发布标签（`1.0.0-beta`）。
 * version 或 range 格式不合法时抛 Error（message 含 'invalid version'）。
 *
 * satisfiesCaret('1.2.3',  '^1.2.3') === true
 * satisfiesCaret('1.9.0',  '^1.2.3') === true
 * satisfiesCaret('1.2.2',  '^1.2.3') === false   // 比下界还小
 * satisfiesCaret('2.0.0',  '^1.2.3') === false   // 跨 major
 * satisfiesCaret('0.2.9',  '^0.2.3') === true
 * satisfiesCaret('0.3.0',  '^0.2.3') === false   // 0.x 里 minor 也是破坏性的
 * satisfiesCaret('0.0.4',  '^0.0.3') === false   // 0.0.x 锁死 patch
 * satisfiesCaret('1.10.0', '^1.9.0') === true    // 😱 别按字符串比大小
 */
export function satisfiesCaret(version: string, range: string): boolean {
  throw new Error('TODO 5.7: 实现 satisfiesCaret');
}

/**
 * 练习 5.8 ⭐⭐⭐ —— 手写一遍 package.json 的 `exports` 解析
 *
 * 这是 Node 决定"`import 'pkg/sub'` 到底读哪个文件"的逻辑（简化版）。
 * 规则，按顺序：
 *   1. exportsField 是字符串 —— 相当于只导出了 '.'；subpath 是 '.' 就返回它，否则 undefined
 *   2. 是对象 —— 先找**完全相等**的 key
 *   3. 没有完全相等的 key，再找带 `*` 的 key（如 './features/*'）；
 *      匹配上就把目标里的 `*` 替换成实际捕获到的那一段
 *   4. 命中的值可能是"条件导出"对象 —— 按 **node → import → default** 的顺序取第一个存在的；
 *      `types` 键要**忽略**（那是给 tsc 看的，不是运行时解析用的）
 *   5. 都没命中返回 undefined（这就是"别人没法 deep import 你没导出的路径"）
 *
 * resolveExports('./dist/index.js', '.')          === './dist/index.js'
 * resolveExports('./dist/index.js', './utils')    === undefined
 * resolveExports({ '.': './dist/index.js', './utils': './dist/utils.js' }, './utils')
 *                                                 === './dist/utils.js'
 * resolveExports({ '.': { types: './dist/index.d.ts', node: './dist/index.js',
 *                         default: './dist/fallback.js' } }, '.')
 *                                                 === './dist/index.js'
 * resolveExports({ '.': { types: './x.d.ts', import: './dist/esm.js' } }, '.')
 *                                                 === './dist/esm.js'
 * resolveExports({ './features/*': './dist/features/*.js' }, './features/log')
 *                                                 === './dist/features/log.js'
 * resolveExports({ '.': './dist/index.js' }, './internal/secret')  === undefined
 */
export type ExportCondition = Record<string, string>;
export type ExportsField = string | Record<string, string | ExportCondition>;

export function resolveExports(exportsField: ExportsField, subpath: string): string | undefined {
  throw new Error('TODO 5.8: 实现 resolveExports');
}

/**
 * 练习 5.9 ⭐⭐⭐ —— 综合：把 ESM/CJS 报错翻译成人话
 *
 * 你以后 80% 的"模块系统卡住了"都是下面这几种。写一个诊断器，
 * 按**优先级从上到下**匹配（一条命中就返回，不要继续往下判）：
 *
 *   1. 含 'ERR_REQUIRE_ESM'                                -> 'require-esm'
 *   2. 含 'Cannot use import statement outside a module'    -> 'import-outside-module'
 *   3. 含 '__dirname is not defined' 或 'require is not defined'
 *                                                          -> 'cjs-global-in-esm'
 *   4. 含 'ERR_UNSUPPORTED_DIR_IMPORT'                      -> 'unsupported-dir-import'
 *   5. 含 'ERR_MODULE_NOT_FOUND'：
 *        再含 'Did you mean to import'                      -> 'missing-extension'
 *        否则                                               -> 'module-not-found'
 *   6. 其它                                                 -> 'unknown'
 *
 * classifyImportError("Error [ERR_REQUIRE_ESM]: require() of ES Module ...")
 *   === 'require-esm'
 * classifyImportError('ReferenceError: __dirname is not defined in ES module scope')
 *   === 'cjs-global-in-esm'
 * classifyImportError("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/utils' " +
 *                     'imported from /app/main.js. Did you mean to import "./utils.js"?')
 *   === 'missing-extension'
 * classifyImportError('Error [ERR_MODULE_NOT_FOUND]: Cannot find package \'lodash\'')
 *   === 'module-not-found'
 * classifyImportError('TypeError: x is not a function')
 *   === 'unknown'
 */
export type ImportErrorKind =
  | 'require-esm'
  | 'import-outside-module'
  | 'cjs-global-in-esm'
  | 'unsupported-dir-import'
  | 'missing-extension'
  | 'module-not-found'
  | 'unknown';

export function classifyImportError(message: string): ImportErrorKind {
  throw new Error('TODO 5.9: 实现 classifyImportError');
}
