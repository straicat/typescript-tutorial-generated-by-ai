/**
 * 工具 1：列目录。
 *
 * 所有涉及文件系统的工具都通过 safeResolveInsideRoot 把路径钉在 root 内。
 */

import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool } from '../lib/tool-registry.js';
import { resolveInsideOrThrow } from './fs-guard.js';

export function createListDirTool(root: string) {
  return defineTool({
    name: 'list_dir',
    description: '列出目录内容。path 是相对于工作目录的路径，"." 表示工作目录本身。',
    schema: z.object({
      path: z.string().describe('相对于工作目录的目录路径'),
    }),
    // 👇 args 的类型 { path: string } 是从 schema 推导出来的，没有手写
    execute: async ({ path }) => {
      const abs = resolveInsideOrThrow(root, path);
      const entries = await readdir(abs, { withFileTypes: true });
      if (entries.length === 0) return '(空目录)';
      return entries
        .map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`)
        .sort()
        .join('\n');
    },
  });
}
