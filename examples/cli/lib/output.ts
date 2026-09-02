/**
 * 输出层。整个工具**只有这一层**允许碰 stdout / stderr。
 *
 * 铁律（第 08 章反复强调）：
 *   - stdout 只放「数据」  → 这样 `jsonl filter a.jsonl --json | jq .` 才能工作
 *   - stderr 放「日志、进度、警告、错误」
 *
 * Reporter 接收注入的 stream，所以测试里传两个内存 buffer 就能断言输出，
 * 完全不需要起子进程。
 */

import type { Writable } from 'node:stream';
import type { Colors } from './colors.js';

export interface Reporter {
  /** 一行数据 → stdout */
  data(line: string): void;
  /** 一个对象 → stdout（单行 JSON，方便 jq / 再次管道） */
  json(value: unknown): void;
  /** 只在 --verbose 时输出 → stderr */
  info(message: string): void;
  /** → stderr */
  warn(message: string): void;
  /** → stderr */
  error(message: string): void;
}

export interface ReporterOptions {
  stdout: Writable;
  stderr: Writable;
  verbose: boolean;
  colors: Colors;
}

export function createReporter({ stdout, stderr, verbose, colors }: ReporterOptions): Reporter {
  return {
    data(line) {
      stdout.write(`${line}\n`);
    },
    json(value) {
      stdout.write(`${JSON.stringify(value)}\n`);
    },
    info(message) {
      if (verbose) stderr.write(`${colors.gray(`[info] ${message}`)}\n`);
    },
    warn(message) {
      stderr.write(`${colors.yellow(`[warn] ${message}`)}\n`);
    },
    error(message) {
      stderr.write(`${colors.red(`[error] ${message}`)}\n`);
    },
  };
}

// ---------------------------------------------------------------- 表格

export interface TableOptions {
  header?: readonly string[];
  gap?: number;
}

/**
 * 显示宽度。三个容易被忽略的点：
 *   1. `.length` 是 UTF-16 码元数，emoji 会算 2 → 必须先展开成码点
 *   2. ANSI 转义码不占宽度 → 要先剥掉
 *   3. 中日韩字符在等宽终端里占 **2 列** → 不处理的话中文表格永远是歪的
 * 生态里做这件事的库叫 `string-width`。
 */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // 韩文字母
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK 部首 ~ 彝文
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // 韩文音节
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 兼容表意
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK 兼容形式
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // 全角 ASCII
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f9ff) || // emoji
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s.replace(/\u001B\[[0-9;]*m/g, '')) {
    width += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

/** 等宽对齐输出表格。返回多行字符串，**不带**结尾换行。 */
export function formatTable(rows: ReadonlyArray<readonly string[]>, options: TableOptions = {}): string {
  const { header, gap = 2 } = options;
  const all = header == null ? rows : [header, ...rows];
  if (all.length === 0) return '';

  const columnCount = Math.max(...all.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    widths[c] = Math.max(...all.map((r) => displayWidth(r[c] ?? '')));
  }

  const sep = ' '.repeat(gap);
  const renderRow = (row: readonly string[]): string =>
    Array.from({ length: columnCount }, (_, c) => {
      const cell = row[c] ?? '';
      const pad = (widths[c] ?? 0) - displayWidth(cell);
      return cell + ' '.repeat(Math.max(0, pad));
    })
      .join(sep)
      // 右侧尾随空格没有意义，还会污染 diff 和测试断言。
      .trimEnd();

  const out: string[] = [];
  if (header != null) {
    out.push(renderRow(header));
    out.push(renderRow(header.map((_, c) => '-'.repeat(widths[c] ?? 0))));
  }
  for (const row of rows) out.push(renderRow(row));
  return out.join('\n');
}

// ---------------------------------------------------------------- 人类可读

export function humanizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) throw new RangeError(`humanizeBytes 需要有限数字, 收到 ${bytes}`);
  const sign = bytes < 0 ? '-' : '';
  let n = Math.abs(bytes);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return i === 0 ? `${sign}${n} B` : `${sign}${n.toFixed(1)} ${units[i]}`;
}

export function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`humanizeDuration 需要非负有限数字, 收到 ${ms}`);
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m}m${Math.round((ms - m * 60_000) / 1000)}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  return `${h}h${Math.floor((ms - h * 3_600_000) / 60_000)}m`;
}
