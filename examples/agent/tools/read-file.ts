/**
 * 工具 2：读文件。
 *
 * ⚠️ strict 模式的硬限制：schema 里**不能用 `.optional()`**，必须 `.nullable()`。
 * openai@7 的 zod helper 会直接抛错提醒你：
 *   Schema field at `properties/maxBytes` uses `.optional()` without `.nullable()`
 * 因为 Structured Outputs 要求所有字段都列在 required 里。
 */

import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool } from '../lib/tool-registry.js';
import { resolveInsideOrThrow } from './fs-guard.js';

export const MAX_READ_BYTES = 8 * 1024;

export function createReadFileTool(root: string) {
  return defineTool({
    name: 'read_file',
    description: `读取文本文件内容，最多 ${MAX_READ_BYTES} 字符。maxBytes 传 null 表示用默认上限。`,
    schema: z.object({
      path: z.string().describe('相对于工作目录的文件路径'),
      maxBytes: z
        .number()
        .int()
        .positive()
        .nullable() // ← 不是 .optional()！
        .describe('最多读取多少字符，传 null 用默认上限'),
    }),
    execute: async ({ path, maxBytes }) => {
      const abs = resolveInsideOrThrow(root, path);
      const info = await stat(abs);
      if (info.isDirectory()) throw new Error(`${path} 是目录，不是文件`);
      // ?? 而不是 ||：maxBytes 是 0 时也该按 0 处理（虽然 schema 已排除）
      const limit = Math.min(maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES);
      const text = await readFile(abs, 'utf8');
      return text.length <= limit
        ? text
        : `${text.slice(0, limit)}\n...(已截断，原文共 ${text.length} 字符)`;
    },
  });
}
