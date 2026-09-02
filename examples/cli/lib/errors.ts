/**
 * 错误类型与退出码映射。
 *
 * CLI 的退出码是它对外的 API：脚本会用 `if ! tool ...; then` 判断成败。
 * 约定（见 docs/08-cli-with-commander.md）：
 *   0   成功
 *   1   一般运行时错误
 *   2   用法错误（参数不对、配置非法）
 *   130 被 SIGINT (Ctrl-C) 中断
 */

/** 用法错误：用户传错了参数 / 配置非法。退出码 2。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    // 必须手动设 name：class 名在压缩/打包后可能变，而且 Error 的 name 不会自动跟着子类。
    this.name = 'UsageError';
  }
}

/** 业务错误：可以自带退出码。 */
export class ToolError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ToolError';
    this.exitCode = exitCode;
  }
}

/** 被取消（Ctrl-C / AbortController）。退出码 130。 */
export class CancelledError extends Error {
  constructor(message = '已取消') {
    super(message);
    this.name = 'AbortError'; // 和 Node 内置 abort 的 name 对齐，方便统一判断
  }
}

/**
 * 把任意 throw 出来的东西映射成退出码。
 * 注意 commander 的 CommanderError 也带 exitCode（`--help` 是 0），所以顺带就支持了。
 */
export function exitCodeFor(error: unknown): number {
  if (error == null) return 0;
  if (error instanceof UsageError) return 2;
  if (error instanceof Error && error.name === 'AbortError') return 130;

  if (typeof error === 'object') {
    const code = (error as { exitCode?: unknown }).exitCode;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) {
      return code;
    }
  }
  return 1;
}

/** 给用户看的一行错误描述（不含堆栈）。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
