/**
 * 选项校验层：**commander 只负责收集字符串，zod 负责校验和转换**。
 *
 * 为什么不用 commander 自带的 argParser 做校验？
 *   1. commander 的 `.opts()` 返回 `Record<string, any>`，类型完全是松的，
 *      拿到手之后你以为 `opts.top` 是 number，实际可能是 string —— 编译器不管你。
 *   2. 校验逻辑散落在十几个 `.option()` 调用里，没法复用、没法单测。
 * 所以这里的做法是：一次 `schema.safeParse(rawOpts)`，
 * 出来就是**强类型**的 options 对象，错误信息也统一。
 */

import { z } from 'zod';
import { UsageError } from './errors.js';

/** 命令行给的字符串 → 正整数。 */
const positiveInt = z.coerce.number().int().positive();

export const globalOptionsSchema = z.object({
  json: z.boolean().default(false),
  color: z.boolean().default(true),
  verbose: z.boolean().default(false),
});
export type GlobalOptions = z.infer<typeof globalOptionsSchema>;

export const statsOptionsSchema = z.object({
  top: positiveInt.max(1000).default(10),
  showBad: z.boolean().default(false),
});
export type StatsOptions = z.infer<typeof statsOptionsSchema>;

export const filterOptionsSchema = z.object({
  // commander 只把 -w 收集成 string[]，「至少要有一个」这条业务规则写在这里。
  where: z.array(z.string()).min(1, '至少需要一个 --where 条件，例如 --where level=error'),
  limit: positiveInt.optional(),
  fields: z.array(z.string()).min(1).optional(),
  failIfEmpty: z.boolean().default(false),
});
export type FilterOptions = z.infer<typeof filterOptionsSchema>;

export const headOptionsSchema = z.object({
  lines: positiveInt.max(10_000).default(10),
  pretty: z.boolean().default(false),
});
export type HeadOptions = z.infer<typeof headOptionsSchema>;

/**
 * 统一入口：校验失败就抛 UsageError（退出码 2），并把 zod 的报错格式化成人能读的样子。
 * 注意用 safeParse 而不是 parse —— 我们要自己控制错误类型和退出码。
 */
export function validateOptions<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new UsageError(`${label} 选项非法:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
