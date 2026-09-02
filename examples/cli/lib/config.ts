/**
 * 配置加载：命令行参数 > 环境变量 > 配置文件 > 默认值。
 *
 * 查找顺序：
 *   1. 从 cwd 一路往上找 `.jsonlrc.json`（monorepo 里每个子包能有自己的配置）
 *   2. 找不到就看 `~/.config/jsonl/config.json`
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { UsageError } from './errors.js';

export const CONFIG_FILE_NAME = '.jsonlrc.json';

/** 从 startDir 逐级向上找 fileName，返回第一个命中的绝对路径。existsFn 注入以便测试。 */
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
    // 到根目录时 dirname('/') === '/'，必须靠这个条件终止，否则死循环。
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 配置文件里允许出现的字段（全部可选，缺了就走上一级优先级）。 */
const fileConfigSchema = z.object({
  json: z.boolean().optional(),
  color: z.boolean().optional(),
  verbose: z.boolean().optional(),
  top: z.number().int().positive().optional(),
});
export type FileConfig = z.infer<typeof fileConfigSchema>;

export async function loadConfigFile(path: string): Promise<FileConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new UsageError(`读取配置文件失败 ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`配置文件不是合法 JSON ${path}: ${(err as Error).message}`);
  }
  const parsed = fileConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UsageError(`配置文件字段非法 ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function userConfigPath(home = homedir()): string {
  return join(home, '.config', 'jsonl', 'config.json');
}

/** 环境变量 → 配置片段。只认显式设置过的项。 */
export function configFromEnv(env: Record<string, string | undefined>): FileConfig {
  const out: FileConfig = {};
  if (env.JSONL_JSON != null) out.json = env.JSONL_JSON === '1' || env.JSONL_JSON === 'true';
  if (env.JSONL_VERBOSE != null) out.verbose = env.JSONL_VERBOSE === '1' || env.JSONL_VERBOSE === 'true';
  if (env.NO_COLOR != null && env.NO_COLOR !== '') out.color = false;
  return out;
}

/**
 * 四级合并。关键点：**只有值不是 undefined 才允许覆盖下一级**。
 * commander 对未传的选项给的是 undefined，一个朴素的 `{...a, ...b}`
 * 会让 `{ verbose: undefined }` 把下层的 true 覆盖掉 —— 这是最常见的配置 bug。
 */
export function mergeLayers<T extends object>(...layers: ReadonlyArray<Partial<T>>): Partial<T> {
  const out: Partial<T> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
