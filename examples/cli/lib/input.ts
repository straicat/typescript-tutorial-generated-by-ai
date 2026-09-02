/**
 * 输入层：把「文件路径」或「stdin」统一成一个 string[]。
 *
 * 关键设计：`file === '-'` 表示读 stdin，这是 Unix 工具的通用约定
 * （`cat x.jsonl | jsonl stats -`）。另外 stdin 也可以在 file 缺省时自动启用。
 */

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
// ⚠️ ESM + moduleResolution:nodenext 下，相对导入必须带扩展名，而且写 `.js`（不是 `.ts`）
import { ToolError, UsageError } from './errors.js';

/** 把一整块文本切成行：处理 \r\n、BOM、末尾换行。 */
export function splitLines(text: string): string[] {
  // BOM 必须先剥掉，否则第一行的 JSON.parse 会因为 \uFEFF 报错 —— 经典 Windows 坑。
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (body === '') return [];
  const lines = body.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  // 只丢掉「末尾换行造成的那一个」空元素，中间的空行要保留。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** 按行流式读取一个可读流（readline 自带 \r\n 处理）。 */
export async function readLinesFromStream(stream: Readable): Promise<string[]> {
  const out: string[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) out.push(line);
  return out;
}

export interface InputSource {
  /** 命令行给的 file 参数；'-' 或 undefined 表示 stdin */
  file: string | undefined;
  stdin: Readable;
  stdinIsTTY: boolean;
  signal?: AbortSignal;
}

export async function readInputLines({ file, stdin, stdinIsTTY, signal }: InputSource): Promise<string[]> {
  if (file == null || file === '-') {
    if (stdinIsTTY) {
      // 交互式终端里直接跑 `tool stats` 会挂住等输入，用户以为程序卡了。
      throw new UsageError('没有指定文件，且 stdin 是终端。请给出文件名，或用管道传入数据。');
    }
    return readLinesFromStream(stdin);
  }

  try {
    const text = await readFile(file, { encoding: 'utf8', signal });
    return splitLines(text);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') throw new UsageError(`文件不存在: ${file}`);
    if (code === 'EISDIR') throw new UsageError(`这是一个目录，不是文件: ${file}`);
    if (code === 'EACCES') throw new UsageError(`没有读权限: ${file}`);
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ToolError(`读取失败 ${file}: ${(err as Error).message}`);
  }
}
