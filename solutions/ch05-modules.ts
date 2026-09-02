/**
 * 第 05 章参考答案 · 模块与工程化
 * 每题都附带「为什么这么写」的说明，看的时候重点看注释。
 */

import { basename, resolve } from 'node:path';

// ---------- 5.1 ----------
export type PluginName = 'hash' | 'platform' | 'cpus';

export async function loadPlugin(name: PluginName): Promise<string> {
  switch (name) {
    case 'hash': {
      // `await import()` 返回的是**模块命名空间对象**，可以直接解构 named export。
      // 它是运行时的表达式，所以模块只有真的走到这一行才会被加载 —— 这就是懒加载。
      const { createHash } = await import('node:crypto');
      return createHash('sha256').update('typescript').digest('hex');
    }
    case 'platform': {
      // 也可以整包拿进来当命名空间用（等价于静态写法 `import * as os from 'node:os'`）。
      const os = await import('node:os');
      return os.platform();
    }
    case 'cpus': {
      const { cpus } = await import('node:os');
      return String(cpus().length);
    }
    default: {
      // 类型上这里 name 已经是 never（穷尽了），但运行时完全可能被塞进别的字符串 ——
      // 因为类型编译后就没了，调用方一个 `as PluginName` 就能绕过。所以这个分支必须留。
      throw new Error(`unknown plugin: ${String(name)}`);
    }
  }
}

// ---------- 5.2 ----------
export function getCurrentDirName(): string {
  // ESM 里没有 __dirname / __filename。Node 20.11+ 提供了 import.meta.dirname。
  // 老一点的运行时要写：basename(dirname(fileURLToPath(import.meta.url)))
  return basename(import.meta.dirname);
}

// ---------- 5.3 ----------
export function resolveFromHere(relative: string): string {
  // resolve 会从左到右拼接，遇到绝对路径就"重新开始"，
  // 所以 resolveFromHere('/etc/hosts') 天然返回 '/etc/hosts'。
  // 常见错法：用 process.cwd() 当基准 —— 那是用户敲命令的目录，和文件所在目录无关。
  return resolve(import.meta.dirname, relative);
}

// ---------- 5.4 ----------
export interface TableRow {
  readonly [column: string]: string;
}

export type Formatter = (rows: readonly TableRow[]) => string;

export function formatAsJson(rows: readonly TableRow[]): string {
  return JSON.stringify(rows);
}

export function formatAsCsv(rows: readonly TableRow[]): string {
  const first = rows[0];
  // 开了 noUncheckedIndexedAccess，rows[0] 的类型是 TableRow | undefined，
  // 这个判空同时处理了"空数组返回 ''"的要求。
  if (first === undefined) return '';
  const columns = Object.keys(first);
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((c) => row[c] ?? '').join(','));
  return [header, ...body].join('\n');
}

export function formatAsLines(rows: readonly TableRow[]): string {
  return rows
    .map((row) =>
      Object.entries(row)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    )
    .join('\n');
}

// 注册表就是一个普通对象：key 是外部名字，value 直接引用上面的 named export。
// 关键点：这里放的是**函数本身**，不是 `(rows) => formatAsCsv(rows)` 包一层 ——
// 包一层会让 getFormatter('csv') === formatAsCsv 变成 false，
// 也会破坏 vitest.spyOn 之类基于同一引用的调试手段。
const formatterRegistry: Readonly<Record<string, Formatter>> = Object.freeze({
  json: formatAsJson,
  csv: formatAsCsv,
  lines: formatAsLines,
});

export function getFormatter(name: string): Formatter | undefined {
  // 用 Object.hasOwn 挡住原型链：直接 registry['toString'] 会拿到 Object.prototype 上的东西。
  return Object.hasOwn(formatterRegistry, name) ? formatterRegistry[name] : undefined;
}

// ---------- 5.5 ----------
export type ExitCodeName = 'ok' | 'usage' | 'dataErr' | 'noInput' | 'software' | 'config';

export function createExitCodeTable(): Readonly<Record<ExitCodeName, number>> {
  // `as const` 管编译期（值变成字面量类型且 readonly），
  // `Object.freeze` 管运行时（真的写不进去）。两件事，都要做。
  return Object.freeze({
    ok: 0,
    usage: 64,
    dataErr: 65,
    noInput: 66,
    software: 70,
    config: 78,
  } as const);
}

export function exitCodeOf(name: string): number | undefined {
  const table = createExitCodeTable();
  // 常见错法 1：`return table[name] || undefined` —— ok 的值是 0，会被 || 吃成 undefined。
  // 常见错法 2：`if (name in table)` —— `in` 会走原型链，'toString' 会被判成存在。
  if (!Object.hasOwn(table, name)) return undefined;
  return table[name as ExitCodeName];
}

// ---------- 5.6 ----------
export interface PackageSpec {
  scope: string | undefined;
  name: string;
  version: string | undefined;
  isBuiltin: boolean;
}

export function parsePackageName(spec: string): PackageSpec {
  const s = spec.trim();
  const fail = (): never => {
    throw new Error(`invalid package spec: ${JSON.stringify(spec)}`);
  };
  if (s === '') fail();

  // 内置模块最先判：'node:' 前缀后面整段都是模块名（可以带子路径 fs/promises）。
  if (s.startsWith('node:')) {
    const builtin = s.slice('node:'.length);
    if (builtin === '') fail();
    return { scope: undefined, name: builtin, version: undefined, isBuiltin: true };
  }

  let scope: string | undefined;
  let rest = s;
  if (s.startsWith('@')) {
    // scope 包名形如 @types/node，里面有两个 '@'（第二个才是版本分隔符），
    // 所以必须先把 scope 摘掉再找版本 —— 直接 split('@') 一定错。
    const slash = s.indexOf('/');
    if (slash <= 1) fail(); // '@scope'（没有 /）和 '@/x'（scope 为空）都非法
    scope = s.slice(0, slash);
    rest = s.slice(slash + 1);
  }

  const at = rest.indexOf('@');
  let name = rest;
  let version: string | undefined;
  if (at !== -1) {
    name = rest.slice(0, at);
    version = rest.slice(at + 1);
    if (version === '') fail(); // 'lodash@'
  }
  if (name === '') fail(); // '@scope/' 或 '@x'

  return { scope, name, version, isBuiltin: false };
}

// ---------- 5.7 ----------
type Triple = readonly [number, number, number];

function parseTriple(raw: string, label: string): Triple {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (m === null) throw new Error(`invalid version (${label}): ${raw}`);
  // 解构出来的每一项在 noUncheckedIndexedAccess 下都是 string | undefined，
  // 但正则整串匹配保证了三个捕获组一定存在，Number() 接受 undefined（得 NaN）所以能编译过。
  const [, major, minor, patch] = m;
  return [Number(major), Number(minor), Number(patch)];
}

function compareTriple(a: Triple, b: Triple): number {
  // 逐段按【数字】比。常见错法：直接 a > b 比字符串，'1.10.0' < '1.9.0' 就翻车了。
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function satisfiesCaret(version: string, range: string): boolean {
  if (!range.startsWith('^')) throw new Error(`invalid version range: ${range}`);
  const lower = parseTriple(range.slice(1), 'range');
  const v = parseTriple(version, 'version');

  // 下界统一：必须 >= ^ 后面那个版本。
  if (compareTriple(v, lower) < 0) return false;

  const [lMajor, lMinor, lPatch] = lower;
  const [vMajor, vMinor, vPatch] = v;

  // 上界分三种情况，这正是 npm 对 0.x 的特殊照顾（0.x 被当作"随时可能不兼容"）。
  if (lMajor > 0) return vMajor === lMajor; // ^1.2.3 -> <2.0.0
  if (lMinor > 0) return vMajor === 0 && vMinor === lMinor; // ^0.2.3 -> <0.3.0
  return vMajor === 0 && vMinor === 0 && vPatch === lPatch; // ^0.0.3 -> <0.0.4
}

// ---------- 5.8 ----------
export type ExportCondition = Record<string, string>;
export type ExportsField = string | Record<string, string | ExportCondition>;

// 运行时条件的优先级。注意 'types' 不在里面：它只服务于 tsc，
// 而且在真实 package.json 里必须写在最前面（Node 忽略它，tsc 需要先看到它）。
const CONDITION_ORDER = ['node', 'import', 'default'] as const;

function pickTarget(value: string | ExportCondition): string | undefined {
  if (typeof value === 'string') return value;
  for (const condition of CONDITION_ORDER) {
    const hit = value[condition];
    if (typeof hit === 'string') return hit;
  }
  return undefined;
}

export function resolveExports(exportsField: ExportsField, subpath: string): string | undefined {
  // 形式一：`"exports": "./dist/index.js"` 是 `{ ".": "./dist/index.js" }` 的简写。
  if (typeof exportsField === 'string') {
    return subpath === '.' ? exportsField : undefined;
  }

  // 精确匹配优先于通配 —— 和 Node 的真实行为一致。
  const exact = exportsField[subpath];
  if (exact !== undefined) return pickTarget(exact);

  for (const [key, value] of Object.entries(exportsField)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    // `*` 至少要捕获一个字符：'./features/' 这种"只有前缀"的路径不算命中。
    if (subpath.length <= prefix.length + suffix.length) continue;
    const captured = subpath.slice(prefix.length, subpath.length - suffix.length);
    const target = pickTarget(value);
    // 目标里的 '*' 用捕获到的那一段替换（Node 只替换第一个 '*'）。
    return target?.replace('*', captured);
  }

  // 没命中就是没导出。这正是 exports 字段的价值：
  // 它把包的对外形状锁死了，别人 deep import 你的内部文件会直接失败。
  return undefined;
}

// ---------- 5.9 ----------
export type ImportErrorKind =
  | 'require-esm'
  | 'import-outside-module'
  | 'cjs-global-in-esm'
  | 'unsupported-dir-import'
  | 'missing-extension'
  | 'module-not-found'
  | 'unknown';

export function classifyImportError(message: string): ImportErrorKind {
  // 顺序很重要：一条真实报错可能同时含多个特征词（比如 ERR_MODULE_NOT_FOUND
  // 的消息里也会出现 'Did you mean to import'），先判特例再判通用。
  if (message.includes('ERR_REQUIRE_ESM')) return 'require-esm';
  if (message.includes('Cannot use import statement outside a module')) {
    return 'import-outside-module';
  }
  if (message.includes('__dirname is not defined') || message.includes('require is not defined')) {
    return 'cjs-global-in-esm';
  }
  if (message.includes('ERR_UNSUPPORTED_DIR_IMPORT')) return 'unsupported-dir-import';
  if (message.includes('ERR_MODULE_NOT_FOUND')) {
    // Node 很贴心：少写扩展名时它会额外提示 'Did you mean to import "./x.js"?'
    return message.includes('Did you mean to import') ? 'missing-extension' : 'module-not-found';
  }
  return 'unknown';
}
