/**
 * 路径安全：把模型给的路径钉死在 root 目录内。
 *
 * 只要你给 Agent 一个 readFile 工具，模型（或用户贴进来的提示注入）
 * 迟早会试 `../../../etc/passwd`。这个函数是整个示例最重要的 10 行。
 */

import { isAbsolute, relative, resolve } from 'node:path';

export function safeResolveInsideRoot(root: string, userPath: string): string | null {
  const absRoot = resolve(root);
  const resolved = resolve(absRoot, userPath);
  const rel = relative(absRoot, resolved);
  // rel === ''       -> 就是 root 自己，允许
  // rel 以 '..' 开头 -> 越界
  // isAbsolute(rel)  -> Windows 跨盘符
  //
  // ❌ 绝不能写 resolved.startsWith(absRoot)：
  //    '/srv/application/x'.startsWith('/srv/app') === true，直接被穿透。
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) return null;
  return resolved;
}
