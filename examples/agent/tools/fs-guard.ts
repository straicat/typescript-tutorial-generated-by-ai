/**
 * 文件工具的共同安全闸门。
 *
 * 抛出的错误会被 executeToolCall 捕获、转成 `role: 'tool'` 文本回给模型，
 * 模型会看到「路径越界」然后换个合法路径 —— 这就是「错误不要抛给用户，
 * 要抛给模型」的实际效果。
 */

import { safeResolveInsideRoot } from '../lib/safe-path.js';

export function resolveInsideOrThrow(root: string, userPath: string): string {
  const abs = safeResolveInsideRoot(root, userPath);
  if (abs == null) throw new Error(`路径越界，只允许访问 ${root} 内的文件: ${userPath}`);
  return abs;
}
