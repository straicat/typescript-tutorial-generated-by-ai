/**
 * 工具 5：写文件 —— 标了 `dangerous: true`。
 *
 * 会改变世界的工具必须走人类确认：主流程在执行前会停下来问一句，
 * 或者要求命令行显式带 `--yes`。这是 Agent 上生产的最低安全线。
 */

import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool } from '../lib/tool-registry.js';
import { resolveInsideOrThrow } from './fs-guard.js';

export function createWriteNoteTool(root: string) {
  return defineTool({
    name: 'write_note',
    description: '把一段文本写入工作目录内的文件（会覆盖原内容）。这是危险操作。',
    dangerous: true,
    schema: z.object({
      path: z.string().describe('相对于工作目录的文件路径'),
      content: z.string(),
    }),
    execute: async ({ path, content }) => {
      const abs = resolveInsideOrThrow(root, path);
      await writeFile(abs, content, 'utf8');
      return `已写入 ${path}（${content.length} 字符）`;
    },
  });
}
