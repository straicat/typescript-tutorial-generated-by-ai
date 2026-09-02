/**
 * 应用上下文：所有命令需要的「环境」都放这里，靠**注入**传进业务函数。
 * 这样单测里可以塞内存 stream + 假 env，完全不碰真实进程。
 */

import type { Readable, Writable } from 'node:stream';
import type { Colors } from './colors.js';
import type { GlobalOptions } from './options.js';
import type { Reporter } from './output.js';

export interface AppContext {
  reporter: Reporter;
  colors: Colors;
  globals: GlobalOptions;
  stdin: Readable;
  stdinIsTTY: boolean;
  stdout: Writable;
  signal: AbortSignal;
}

/**
 * commander 的 action 是同步装配、异步执行的，而 preAction hook 才知道最终的全局选项。
 * 所以这里用一个「延迟填充」的容器：装配阶段拿到 holder，运行阶段 hook 把 ctx 填进去。
 */
export interface ContextHolder {
  current: AppContext | null;
}

export function requireContext(holder: ContextHolder): AppContext {
  if (holder.current == null) {
    throw new Error('AppContext 尚未初始化（preAction hook 没跑？）');
  }
  return holder.current;
}
