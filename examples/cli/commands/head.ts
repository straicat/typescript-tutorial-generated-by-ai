/**
 * `jsonl head <file> -n 10 --pretty` —— 预览前 n 条。
 */

import { Command } from 'commander';
import type { AppContext, ContextHolder } from '../lib/context.js';
import { requireContext } from '../lib/context.js';
import { readInputLines } from '../lib/input.js';
import { parseJsonl } from '../lib/jsonl.js';
import type { HeadOptions } from '../lib/options.js';
import { headOptionsSchema, validateOptions } from '../lib/options.js';

export async function runHead(file: string, options: HeadOptions, ctx: AppContext): Promise<void> {
  const { reporter, colors } = ctx;
  const lines = await readInputLines({
    file,
    stdin: ctx.stdin,
    stdinIsTTY: ctx.stdinIsTTY,
    signal: ctx.signal,
  });
  const doc = parseJsonl(lines);
  const head = doc.records.slice(0, options.lines);
  reporter.info(`预览 ${head.length}/${doc.records.length} 条`);

  for (const rec of head) {
    if (ctx.globals.json) {
      reporter.json({ line: rec.line, value: rec.value });
    } else if (options.pretty) {
      // 缩进 2 空格是 JSON.stringify 的第三个参数，Java 里要靠 Jackson 的 PRETTY_PRINT。
      reporter.data(colors.gray(`── L${rec.line} ──`));
      reporter.data(JSON.stringify(rec.value, null, 2));
    } else {
      reporter.data(`${colors.gray(`L${rec.line}`)} ${JSON.stringify(rec.value)}`);
    }
  }

  if (doc.bad.length > 0) reporter.warn(`跳过 ${doc.bad.length} 行非法数据`);
}

export function makeHeadCommand(holder: ContextHolder): Command {
  return new Command('head')
    .alias('h')
    .description('预览前 n 条记录')
    .argument('<file>', 'JSONL 文件路径，用 - 表示读 stdin')
    .option('-n, --lines <n>', '预览条数', '10')
    .option('-p, --pretty', '多行缩进输出')
    .addHelpText(
      'after',
      `
示例:
  $ jsonl head sample.jsonl -n 3
  $ jsonl head sample.jsonl -n 2 --pretty
  $ cat sample.jsonl | jsonl head - -n 1`,
    )
    .action(async (file: string, raw: unknown) => {
      const options = validateOptions(headOptionsSchema, raw, 'head');
      await runHead(file, options, requireContext(holder));
    });
}
