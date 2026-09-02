/**
 * 极简 ANSI 彩色输出。
 *
 * 本项目没装 chalk / picocolors，所以手写一个 —— 一共就 20 行，
 * 顺便说明「上色」真正的难点不是转义码，而是**什么时候不该上色**：
 *   - 输出被重定向到文件 / 管道（非 TTY）→ 不上色，否则文件里全是乱码
 *   - 用户设了 NO_COLOR（https://no-color.org 约定）→ 不上色
 *   - 用户设了 FORCE_COLOR → 即使非 TTY 也上色（CI 上常用）
 *   - 用户传了 --no-color → 不上色
 *
 * 生态里成熟的方案：`picocolors`（最小）、`chalk`（最全）、`kleur`。
 */

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
  gray: 90,
} as const;

export type ColorName = Exclude<keyof typeof CODES, 'reset'>;

/** 一组「上色函数」，enabled=false 时全部退化为恒等函数。 */
export type Colors = Record<ColorName, (text: string) => string>;

export interface ColorDecision {
  /** 用户是否传了 --color / --no-color（commander 的 opts().color） */
  color: boolean;
  /** 目标流是不是终端 */
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

/**
 * 决定要不要上色。优先级：--no-color > NO_COLOR > FORCE_COLOR > isTTY。
 * NO_COLOR 只要是**非空字符串**就算生效（空串视为未设置，这是 no-color.org 的约定）。
 */
export function shouldUseColor({ color, isTTY, env }: ColorDecision): boolean {
  if (!color) return false;
  if (env.NO_COLOR != null && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR != null && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  return isTTY;
}

export function createColors(enabled: boolean): Colors {
  const make = (code: number) => (text: string) =>
    // 空串不加转义码：加了也看不见，只会污染 diff 和测试断言。
    enabled && text !== '' ? `\u001B[${code}m${text}\u001B[${CODES.reset}m` : text;

  return {
    bold: make(CODES.bold),
    dim: make(CODES.dim),
    red: make(CODES.red),
    green: make(CODES.green),
    yellow: make(CODES.yellow),
    blue: make(CODES.blue),
    cyan: make(CODES.cyan),
    gray: make(CODES.gray),
  };
}

/** 去掉 ANSI 转义码。计算列宽 / 写测试断言时要用。 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}
