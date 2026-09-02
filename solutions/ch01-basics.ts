/**
 * 第 01 章参考答案 · 基础语法
 * 每题都附带「为什么这么写」的说明，看的时候重点看注释。
 */

// ---------- 1.1 ----------
export function intDiv(a: number, b: number): number | null {
  if (b === 0) return null;
  // Math.trunc 向零取整，行为等价于 Java/Go 的整数除法。
  // 用 Math.floor 会在负数上得到 -4 而不是 -3。
  return Math.trunc(a / b);
}

// ---------- 1.2 ----------
export function parseIntStrict(input: string): number | null {
  const s = input.trim();
  // 先用正则把"形状"卡死：可选符号 + 至少一位数字，且必须整串匹配。
  // 这一步就排除了 '42abc' / '3.5' / '1e3' / '0x1f' / ''。
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  // 再排除超出 2^53-1 的值（此时 Number 会静默丢精度）。
  return Number.isSafeInteger(n) ? n : null;
}

// ---------- 1.3 ----------
export function isBlank(value: string | null | undefined): boolean {
  // `== null` 是唯一推荐使用 == 的场合：一次命中 null 和 undefined。
  if (value == null) return true;
  return value.trim().length === 0;
  // 注意不能写 `return !value.trim()` —— 逻辑上这里恰好也对，
  // 但养成 `.length === 0` 的习惯能避免 '0' 这类假值坑。
}

// ---------- 1.4 ----------
export function pickPort(raw: number | null | undefined, fallback: number): number {
  // ?? 只在左侧是 null/undefined 时取右侧；|| 会把 0 也吃掉。
  return raw ?? fallback;
}

// ---------- 1.5 ----------
export function truthyCount(values: readonly unknown[]): number {
  // Boolean 既是类型也是函数，可以直接当谓词用。
  return values.filter(Boolean).length;
  // 等价写法：values.reduce((n, v) => (v ? n + 1 : n), 0)
}

// ---------- 1.6 ----------
export function kindOf(value: unknown): string {
  // typeof null === 'object' 是 JS 的历史 bug，必须先特判。
  if (value === null) return 'null';
  // 数组也是 object，只能用 Array.isArray 区分。
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ---------- 1.7 ----------
export function countCodePoints(s: string): number {
  // 字符串是可迭代对象，迭代器按【码点】走，所以展开后 emoji 只占一项。
  // s.length 走的是 UTF-16 码元，'👍' 会算 2。
  return [...s].length;
  // 等价：Array.from(s).length
}

// ---------- 1.8 ----------
export interface RetryOptions {
  times?: number;
  delayMs?: number;
  label?: string;
}

export function describeRetry(options: RetryOptions): string {
  // 解构 + 默认值：默认值只在属性为 undefined 时生效，
  // 所以 delayMs: 0 会被保留（这正是我们想要的）。
  const { times = 3, delayMs = 100, label = 'task' } = options;
  return `${label}: ${times} 次重试, 间隔 ${delayMs}ms`;
}

// ---------- 1.9 ----------
export function numberLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let n = 1;
  // 用 for...of 拿值。这里不能直接用 map + index，
  // 因为被跳过的项不能占用序号。
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    out.push(`${n}:${line}`);
    n += 1;
  }
  return out;
  // 也可以写成 lines.filter(l => l.trim() !== '').map((l, i) => `${i + 1}:${l}`)
}

// ---------- 1.10 ----------
export interface KeyValueParseResult {
  ok: boolean;
  entries: Array<[string, string]>;
  errors: string[];
}

export function parseKeyValues(args: readonly string[]): KeyValueParseResult {
  const entries: Array<[string, string]> = [];
  const errors: string[] = [];

  for (const arg of args) {
    const idx = arg.indexOf('=');
    // idx === -1 -> 没有 '='；idx === 0 -> key 为空。
    if (idx <= 0) {
      errors.push(arg);
      continue;
    }
    const key = arg.slice(0, idx);
    const value = arg.slice(idx + 1); // 只按第一个 '=' 切，右边原样保留
    entries.push([key, value]);
  }

  return { ok: errors.length === 0, entries, errors };
}
