/**
 * 第 08 章参考答案 · 命令行工具实战
 * 每题都附带「为什么这么写 / 常见错法是什么」的说明，看的时候重点看注释。
 */

import { Command } from 'commander';
import { dirname, join } from 'node:path';
import { z } from 'zod';

// ---------- 已给出的错误类（和 exercises 保持完全一致） ----------

/** 用法错误：用户传错了参数 / 配置非法。约定退出码 2。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** 业务错误：自带退出码。 */
export class ToolError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ToolError';
    this.exitCode = exitCode;
  }
}

// ---------- 8.1 ----------
export function splitLines(input: string): string[] {
  // ① BOM 必须最先剥：'\uFEFF{"a":1}' 直接喂 JSON.parse 会报
  //    "Unexpected token" —— 经典 Windows 文件坑，报错信息还完全看不出原因。
  const body = input.startsWith('\uFEFF') ? input.slice(1) : input;

  // ② 空输入是 0 行。不特判的话 ''.split('\n') === [''] 会变成 1 个空行。
  if (body === '') return [];

  // ③ 统一按 '\n' 切，再逐行剥掉尾部的 '\r'。
  //    常见错法是 body.split(/\r?\n/)：结果对，但下一步「只丢一个末尾空元素」
  //    的语义会变得难解释，而且正则比 endsWith 慢。
  const lines = body.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  // ④ 只丢掉「末尾换行造成的那一个」空元素。
  //    ❌ 别写 lines.filter(l => l !== '')：中间的空行是有意义的，
  //       丢掉之后行号就对不上原文件了，用户拿着 L7 去文件里找不到。
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------- 8.2 ----------
export function humanizeBytes(bytes: number): string {
  // 先挡掉 NaN / Infinity。CLI 里这两个值的来源几乎总是 Number(用户输入)，
  // 不挡就会打印 'NaN B' 这种既不报错又没法用的东西。
  if (!Number.isFinite(bytes)) throw new RangeError(`humanizeBytes 需要有限数字, 收到 ${bytes}`);

  // 符号单独拿出来，换算只处理绝对值 —— 否则 -2048 会算成 '-2.0 KiB' 还是 '-2048 B'
  // 取决于比较写法，很容易写错。
  const sign = bytes < 0 ? '-' : '';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let n = Math.abs(bytes);
  let i = 0;
  // 注意 `i < units.length - 1`：到 PiB 就停，不会越界拿到 undefined。
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  // B 档不加小数位（'999 B' 而不是 '999.0 B'）。
  return i === 0 ? `${sign}${n} B` : `${sign}${n.toFixed(1)} ${units[i]}`;
}

// ---------- 8.3 ----------
export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`humanizeDuration 需要非负有限数字, 收到 ${ms}`);
  }
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    // Math.floor 而不是 Math.round：90_000ms 是 1m30s，不是 2m30s。
    const m = Math.floor(ms / 60_000);
    return `${m}m${Math.round((ms - m * 60_000) / 1000)}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  return `${h}h${Math.floor((ms - h * 3_600_000) / 60_000)}m`;
}

// ---------- 8.4 ----------
export type ColorName = 'red' | 'green' | 'yellow' | 'gray' | 'bold';

export interface ColorTarget {
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

const COLOR_CODES: Record<ColorName, number> = {
  red: 31,
  green: 32,
  yellow: 33,
  gray: 90,
  bold: 1,
};

/** 单独抽出来是因为「要不要上色」这个决策本身就该能独立测试。 */
function shouldUseColor({ isTTY, env }: ColorTarget): boolean {
  // ❌ 常见错法：`if (env.NO_COLOR)`。空串是假值，写法上恰好也对；
  //    但 `NO_COLOR=0` 会被当成「要禁用」，而 no-color.org 的约定是
  //    「只要设置了（非空）就禁用」，值是什么都不看。写清楚更好。
  if (env.NO_COLOR != null && env.NO_COLOR !== '') return false;
  // FORCE_COLOR=0 是「明确不要」，是唯一的例外值。
  if (env.FORCE_COLOR != null && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  return isTTY;
}

export function colorize(text: string, color: ColorName, target: ColorTarget): string {
  // 空串加转义码只会污染 diff 和测试断言，看不出任何效果。
  if (text === '') return '';
  if (!shouldUseColor(target)) return text;
  return `\u001B[${COLOR_CODES[color]}m${text}\u001B[0m`;
}

// ---------- 8.5 ----------
export function exitCodeFor(error: unknown): number {
  // `== null` 一次命中 null 和 undefined（第 01 章）。
  if (error == null) return 0;
  if (error instanceof UsageError) return 2;
  // Node 的 AbortController / fs 的 signal 抛出来的错就是 name === 'AbortError'。
  // 用 name 而不是 instanceof：跨版本、跨库都能对上，AbortError 也没有公开的类。
  if (error instanceof Error && error.name === 'AbortError') return 130;

  if (typeof error === 'object') {
    const code = (error as { exitCode?: unknown }).exitCode;
    // 三重校验：是数字、是整数、在合法范围。退出码只有低 8 位有效，
    // `process.exit(300)` 实际会变成 44，与其猜不如不信任。
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) {
      return code;
    }
  }
  return 1;
  // ❌ 常见错法：`return (error as any).exitCode || 1`
  //    —— exitCode 是 0（commander 的 --help）时会被 || 吃掉变成 1，
  //    于是 `tool --help` 的退出码变成 1，把调用方的脚本搞挂。
}

// ---------- 8.6 ----------
export interface TableOptions {
  header?: readonly string[];
  gap?: number;
}

/**
 * 显示宽度 = 码点数。用 [...s] 而不是 s.length，否则 emoji 会被算成 2。
 * ⚠️ 本题不处理 CJK 全角（终端里占 2 列）—— 见 examples/cli/lib/output.ts 的
 * displayWidth，那里有能处理全角 + 剥 ANSI 的完整版本。生态里叫 `string-width`。
 */
function displayWidth(s: string): number {
  return [...s].length;
}

export function formatTable(rows: ReadonlyArray<readonly string[]>, options: TableOptions = {}): string {
  const { header, gap = 2 } = options;
  const all = header == null ? rows : [header, ...rows];
  if (all.length === 0) return '';

  // 行可以长短不齐，列数取最大值；缺的单元格按 '' 处理。
  const columnCount = Math.max(...all.map((row) => row.length));
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    // noUncheckedIndexedAccess 开着，所以 row[c] 是 string | undefined，必须 ?? ''
    widths[c] = Math.max(...all.map((row) => displayWidth(row[c] ?? '')));
  }

  const sep = ' '.repeat(gap);
  const renderRow = (row: readonly string[]): string =>
    Array.from({ length: columnCount }, (_, c) => {
      const cell = row[c] ?? '';
      const pad = (widths[c] ?? 0) - displayWidth(cell);
      // Math.max(0, pad) 兜底：' '.repeat(-1) 会抛 RangeError。
      return cell + ' '.repeat(Math.max(0, pad));
    })
      .join(sep)
      // trimEnd 是关键：最后一列补出来的空格没有意义，
      // 留着会让 `git diff` 报 trailing whitespace，也让测试断言难写。
      .trimEnd();

  const out: string[] = [];
  if (header != null) {
    out.push(renderRow(header));
    out.push(renderRow(header.map((_, c) => '-'.repeat(widths[c] ?? 0))));
  }
  for (const row of rows) out.push(renderRow(row));
  // 不带结尾换行：换行由输出层（reporter.data）负责加。
  return out.join('\n');
}

// ---------- 8.7 ----------
export interface ParsedArgv {
  options: Record<string, string | true>;
  positionals: string[];
}

export function parseArgvBasic(argv: readonly string[]): ParsedArgv {
  const options: Record<string, string | true> = {};
  const positionals: string[] = [];

  // 用带下标的 while 而不是 for...of：规则 2 需要「往前偷看一个并消耗掉」。
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined) break; // 只是为了让 TS 收窄，实际不会发生

    // 规则 5：`--` 之后一律是位置参数，连 '--port' 也照抄。
    // 这就是 `rm -- -rf` 能删掉名叫 "-rf" 的文件的原理。
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    // 规则 6：单独的 '-' 是位置参数（Unix 约定：从 stdin 读）。
    // 必须放在 startsWith('-') 判断【之前】，否则会被当成空的短选项组。
    if (token === '-') {
      positionals.push(token);
      i += 1;
      continue;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        // 规则 1：`--key=` 的值是 ''，不是 true。
        options[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (isValue(argv[i + 1])) {
        // 规则 2：下一个 token 不像选项 -> 当成值并消耗掉
        options[body] = argv[i + 1] as string;
        i += 1;
      } else {
        options[body] = true;
      }
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      const letters = [...token.slice(1)];
      if (letters.length === 1) {
        // 规则 4：单个短选项才去取值（`-n 3`）
        const key = letters[0] as string;
        if (isValue(argv[i + 1])) {
          options[key] = argv[i + 1] as string;
          i += 1;
        } else {
          options[key] = true;
        }
      } else {
        // 规则 3：`-abc` 全部当布尔。真正的 getopt 会让最后一个字母吃值，
        // 那样歧义更多（`-n5` 到底是 n=5 还是 n 和 5 两个开关？），
        // 所以这里刻意简化 —— 真项目请直接用 commander，别自己撕。
        for (const letter of letters) options[letter] = true;
      }
      i += 1;
      continue;
    }

    positionals.push(token);
    i += 1;
  }

  return { options, positionals };
}

/** 「下一个 token 能当值吗」。以 '-' 开头的一律不算，所以 `--flag --other` 得到两个 true。 */
function isValue(next: string | undefined): boolean {
  return next !== undefined && !next.startsWith('-');
  // ⚠️ 代价：`--num -1` 里的 -1 会被当成选项。真实解析器（包括 commander）
  //    对负数有特殊处理，这也是「别手写解析器」的又一个理由。
}

// ---------- 8.8 ----------
export interface WhereFilter {
  path: string[];
  value: string;
  negated: boolean;
}

export function parseWhereFilter(spec: string): WhereFilter {
  const eq = spec.indexOf('='); // 只认第一个 '='，右边原样留给 value
  if (eq < 0) throw new UsageError(`--where 必须是 key=value 形式, 收到: ${JSON.stringify(spec)}`);

  // eq > 0 的前提很重要：spec 是 '=x' 时 spec[-1] 是 undefined，判断会崩逻辑。
  const negated = eq > 0 && spec[eq - 1] === '!';
  const rawKey = spec.slice(0, negated ? eq - 1 : eq);
  const value = spec.slice(eq + 1);

  if (rawKey === '') throw new UsageError(`--where 的 key 不能为空: ${JSON.stringify(spec)}`);
  const path = rawKey.split('.');
  // 'a..b' 会切出一个空段，静默放过的话 getByPath 行为很诡异，不如直接报错。
  if (path.some((seg) => seg === '')) {
    throw new UsageError(`--where 的路径含空段: ${JSON.stringify(spec)}`);
  }
  return { path, value, negated };
}

/** 原型污染防护：这三个键一律视为「取不到」。 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function getByPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    // 🔴 这一行是安全边界：用户输入的路径直接下钻，不挡 __proto__
    //    就等于把原型链暴露给命令行。CVE 里这类问题非常多。
    if (FORBIDDEN_KEYS.has(seg)) return undefined;
    // typeof null === 'object'，所以必须显式排 null（第 01 章那个著名的 JS bug）。
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function scalarToString(v: unknown): string {
  // 对象/数组用 JSON.stringify（String({}) 会得到没用的 '[object Object]'），
  // 其它值用 String（null -> 'null'，504 -> '504'，命令行传进来的永远是字符串）。
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

export function matchesFilter(obj: unknown, filter: WhereFilter): boolean {
  const resolved = getByPath(obj, filter.path);
  // 字段缺失时 equal = false；配合 negated 就得到「缺失算不等于」，
  // 和 grep -v 的直觉一致。注意不能把 undefined 转成 'undefined' 去比，
  // 否则 `--where a=undefined` 会莫名其妙地匹配上所有缺字段的记录。
  const equal = resolved === undefined ? false : scalarToString(resolved) === filter.value;
  return filter.negated ? !equal : equal;
}

// ---------- 8.9 ----------
export function findConfigUpwards(
  startDir: string,
  fileName: string,
  existsFn: (path: string) => boolean,
): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsFn(candidate)) return candidate;
    const parent = dirname(dir);
    // 到根目录时 dirname('/') === '/'（Windows 上 dirname('C:\\') === 'C:\\'），
    // 😱 必须靠 parent === dir 终止，否则死循环 —— 这是本题唯一的坑。
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------- 8.10 ----------
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ResolvedConfig {
  port: number;
  logLevel: LogLevel;
  color: boolean;
  retries: number;
}

export interface ConfigSources {
  file?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  cli?: Record<string, unknown>;
}

/**
 * schema 是类型的唯一来源（第 07 章）。z.coerce 是必须的：
 * 环境变量和命令行参数永远是字符串，配置文件里可能是数字。
 */
const configSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  color: z.boolean(),
  retries: z.coerce.number().int().min(0).max(10),
});
// 默认 strip：配置文件里多余的键静默丢掉，不会污染结果。

/** 环境变量 -> 配置片段。只认「显式设置且非空」的项。 */
function configFromEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // 🔴 `!= null && !== ''` 缺一不可：`TOOL_PORT=` 在 process.env 里是空串而不是
  //    undefined，直接交给 z.coerce.number() 会变成 0（Number('') === 0），
  //    于是用户「清空了这个变量」反而得到一个非法端口。第 07 章 §10.5 的坑。
  const pick = (name: string): string | undefined => {
    const raw = env[name];
    return raw != null && raw.trim() !== '' ? raw : undefined;
  };
  const port = pick('TOOL_PORT');
  if (port !== undefined) out['port'] = port;
  const logLevel = pick('TOOL_LOG_LEVEL');
  if (logLevel !== undefined) out['logLevel'] = logLevel;
  const retries = pick('TOOL_RETRIES');
  if (retries !== undefined) out['retries'] = retries;
  // NO_COLOR 是「设了就生效」的约定型变量，值不参与判断。
  if (env.NO_COLOR != null && env.NO_COLOR !== '') out['color'] = false;
  return out;
}

/**
 * 按优先级从低到高合并，**只有值不是 undefined 才允许覆盖**。
 * ❌ `{ ...defaults, ...file, ...env, ...cli }` 是错的：commander 对没传的选项
 *    给的是 undefined，`{ color: undefined }` 会把下层的 false 冲成 undefined。
 */
function mergeLayers(...layers: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

export function resolveConfig(sources: ConfigSources): ResolvedConfig {
  const defaults: Record<string, unknown> = { port: 8080, logLevel: 'info', color: true, retries: 0 };
  const merged = mergeLayers(
    defaults,
    sources.file ?? {},
    configFromEnv(sources.env ?? {}),
    sources.cli ?? {},
  );

  // safeParse 而不是 parse：我们要自己控制错误类型（UsageError -> 退出码 2）
  // 和错误文案。ZodError 的 .message 是一整个 JSON 数组，绝对不能直接给用户看。
  const result = configSchema.safeParse(merged);
  if (!result.success) {
    // z.prettifyError 是 zod v4 的顶层函数，输出多行 '✖ ...\n  → at port'，
    // 直接打到 stderr 就很好看。
    throw new UsageError(`配置非法:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

// ---------- 8.11 ----------
export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error: Error | null;
}

/**
 * commander 的 .opts() 返回 Record<string, any> —— 类型完全是松的。
 * 所以拿到之后立刻过一次 zod，从这一行往后才有真正的类型安全。
 * 注意 times 的默认值在 commander 那边是字符串 '1'，靠 z.coerce 转成 number。
 */
const greetOptionsSchema = z.object({
  times: z.coerce.number().int().min(1).max(10),
  upper: z.boolean().default(false),
  // --no-exclaim 是「取反选项」：单独定义时 commander 会让它默认为 true。
  exclaim: z.boolean().default(true),
  verbose: z.boolean().default(false),
});

export function buildGreetCommand(): Command {
  // 用局部 new Command() 而不是 commander 导出的全局 program：
  // 全局单例在同一个测试进程里会被多个用例互相污染。
  const command = new Command('greet');

  command
    .description('打招呼')
    .version('1.0.0')
    .argument('<name>', '要打招呼的人')
    // 默认值写成字符串 '1'：commander 只收集字符串，转换交给 zod。
    // 写成数字 1 也能跑，但类型就不统一了，schema 反而更难写。
    .option('-t, --times <n>', '重复次数', '1')
    .option('-u, --upper', '转成大写')
    .option('--no-exclaim', '不要末尾的感叹号')
    .option('-v, --verbose', '把诊断信息打到 stderr')
    .showHelpAfterError('(用 --help 查看用法)')
    .action((name: string, raw: unknown) => {
      // 关键：**通过 commander 的输出通道写**，而不是 console.log / process.stdout。
      // 这样 runCommand 换掉 writeOut 就能把输出全部收进内存。
      // 真实运行时这两个默认就是 process.stdout.write / process.stderr.write。
      const io = command.configureOutput();
      const write = io.writeOut ?? ((s: string) => void process.stdout.write(s));
      const writeErr = io.writeErr ?? ((s: string) => void process.stderr.write(s));

      const parsed = greetOptionsSchema.safeParse(raw);
      if (!parsed.success) {
        // 抛 UsageError 而不是 command.error()：这样退出码由 exitCodeFor 统一决定（2），
        // 而 command.error() 默认给 1，还会绕过我们自己的错误格式。
        throw new UsageError(`greet 选项非法:\n${z.prettifyError(parsed.error)}`);
      }
      const { times, upper, exclaim, verbose } = parsed.data;

      // 铁律：诊断信息走 stderr，数据走 stdout。
      if (verbose) writeErr(`[info] name=${name} times=${times}\n`);

      const base = `Hello, ${name}${exclaim ? '!' : ''}`;
      const line = upper ? base.toUpperCase() : base;
      for (let i = 0; i < times; i += 1) write(`${line}\n`);
    });

  return command;
}

interface CapturedOutput {
  writeOut: (str: string) => void;
  writeErr: (str: string) => void;
  getOutHasColors: () => boolean;
  getErrHasColors: () => boolean;
  getOutHelpWidth: () => number;
  getErrHelpWidth: () => number;
}

/**
 * 递归装配。`.command()` 创建的子命令会自动 copyInheritedSettings，
 * 但 `.addCommand(cmd)` 加进来的**不会** —— 漏了这一步，子命令报错时会
 * 绕过 exitOverride 直接 process.exit()，测试进程当场消失（连报错都看不到）。
 */
function applyTestIo(command: Command, io: CapturedOutput): void {
  command.exitOverride().configureOutput(io);
  for (const child of command.commands) applyTestIo(child, io);
}

export function runCommand(command: Command, argv: readonly string[]): CommandRunResult {
  const outChunks: string[] = [];
  const errChunks: string[] = [];

  applyTestIo(command, {
    writeOut: (str) => void outChunks.push(str),
    writeErr: (str) => void errChunks.push(str),
    // 固定颜色和宽度，否则帮助文本在本机终端和 CI 上不一样，断言会飘。
    getOutHasColors: () => false,
    getErrHasColors: () => false,
    getOutHelpWidth: () => 80,
    getErrHelpWidth: () => 80,
  });

  let error: Error | null = null;
  try {
    // from: 'user' —— argv 里只有真实参数。不写它 commander 会按
    // [node 路径, 脚本路径, ...] 的形状去吃掉前两个元素。
    command.parse(argv, { from: 'user' });
  } catch (thrown) {
    // JS 能 throw 任何值（第 07 章），所以先归一化成 Error。
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  }

  return {
    stdout: outChunks.join(''),
    stderr: errChunks.join(''),
    // 复用 8.5：CommanderError 自带 exitCode，所以 --help / --version 得到 0，
    // 未知选项得到 1，我们自己的 UsageError 得到 2。一条规则覆盖全部。
    exitCode: exitCodeFor(error),
    error,
  };
}

// ---------- 8.12 ----------
export interface FieldStat {
  field: string;
  count: number;
  types: string[];
}

export interface JsonlStats {
  total: number;
  valid: number;
  invalid: number;
  badLines: number[];
  fields: FieldStat[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  // Array.isArray 是判断数组的唯一正确方式（typeof [] === 'object'）。
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function runtimeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function buildJsonlStats(lines: readonly string[]): JsonlStats {
  const badLines: number[] = [];
  // Map 保持插入顺序，配合下面的 sort 就得到确定性输出。
  // 用普通对象也行，但 key 是用户数据，普通对象会碰到 __proto__ 这类麻烦。
  const counts = new Map<string, { count: number; types: Set<string> }>();
  let total = 0;
  let valid = 0;

  // .entries() 拿到 [下标, 值]，比手写 i 更不容易错（第 01 章）。
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue; // 空白行完全不参与统计
    total += 1;
    const lineNo = index + 1; // 1-based，和编辑器/grep 的行号对齐

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // JSON.parse 抛的是 SyntaxError。这里只关心「这行废了」，不需要细节。
      badLines.push(lineNo);
      continue;
    }
    // '[1,2]' 和 'null' 都是合法 JSON 但不是记录，算非法 —— 一行一个对象才是 JSONL。
    if (!isPlainObject(parsed)) {
      badLines.push(lineNo);
      continue;
    }

    valid += 1;
    for (const [key, value] of Object.entries(parsed)) {
      let slot = counts.get(key);
      if (slot == null) {
        slot = { count: 0, types: new Set<string>() };
        counts.set(key, slot);
      }
      slot.count += 1;
      slot.types.add(runtimeType(value));
    }
  }

  const fields = [...counts.entries()]
    .map(([field, { count, types }]) => ({ field, count, types: [...types].sort() }))
    // 出现次数降序，同次数按字段名升序。
    // ⚠️ 排序必须完全确定：`sort((a, b) => b.count - a.count)` 单独用是不够的，
    //    同 count 的顺序会依赖插入顺序（也就是依赖输入文件），断言会飘。
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

  return { total, valid, invalid: badLines.length, badLines, fields };
}
