/**
 * `jsonl stats <file>` —— 统计行数、字段出现频率、错误行。
 *
 * 分三层，一层一件事：
 *   makeStatsCommand  只做 commander 装配（参数/选项/描述）
 *   runStats          业务逻辑，只依赖注入的 AppContext（可单测）
 *   lib/jsonl.ts      纯计算，连 AppContext 都不需要
 */

import { Command } from 'commander';
import type { AppContext, ContextHolder } from '../lib/context.js';
import { requireContext } from '../lib/context.js';
import { readInputLines } from '../lib/input.js';
import { buildStats, parseJsonl } from '../lib/jsonl.js';
import type { StatsOptions } from '../lib/options.js';
import { statsOptionsSchema, validateOptions } from '../lib/options.js';
import { formatTable } from '../lib/output.js';

export async function runStats(file: string, options: StatsOptions, ctx: AppContext): Promise<void> {
  const { reporter, colors } = ctx;
  reporter.info(`读取 ${file === '-' ? '<stdin>' : file}`);

  const lines = await readInputLines({
    file,
    stdin: ctx.stdin,
    stdinIsTTY: ctx.stdinIsTTY,
    signal: ctx.signal,
  });
  const doc = parseJsonl(lines);
  const stats = buildStats(doc);
  const top = stats.fields.slice(0, options.top);

  if (ctx.globals.json) {
    // --json：机器可读，一整个对象一行，字段名稳定。
    reporter.json({ ...stats, fields: top, bad: options.showBad ? doc.bad : undefined });
    return;
  }

  reporter.data(colors.bold('概览'));
  reporter.data(
    formatTable(
      [
        ['总行数(非空)', String(stats.total)],
        ['合法记录', colors.green(String(stats.valid))],
        ['非法行', stats.invalid > 0 ? colors.red(String(stats.invalid)) : '0'],
        ['字段数', String(stats.fields.length)],
      ],
      { gap: 2 },
    ),
  );

  reporter.data('');
  reporter.data(colors.bold(`字段频率 (top ${top.length}/${stats.fields.length})`));
  reporter.data(
    formatTable(
      top.map((f) => [
        f.field,
        String(f.count),
        `${stats.valid === 0 ? 0 : Math.round((f.count / stats.valid) * 100)}%`,
        f.types.join('|'),
      ]),
      { header: ['field', 'count', 'ratio', 'types'] },
    ),
  );

  if (doc.bad.length > 0) {
    reporter.warn(`有 ${doc.bad.length} 行无法解析`);
    if (options.showBad) {
      reporter.data('');
      reporter.data(colors.bold('非法行'));
      reporter.data(formatTable(doc.bad.map((b) => [`L${b.line}`, b.reason, b.raw]), { header: ['line', 'reason', 'raw'] }));
    } else {
      reporter.info('加 --show-bad 可以看到具体内容');
    }
  }
}

export function makeStatsCommand(holder: ContextHolder): Command {
  return new Command('stats')
    .description('统计 JSONL 的行数、字段频率与非法行')
    .argument('<file>', 'JSONL 文件路径，用 - 表示读 stdin')
    .option('-t, --top <n>', '只展示出现最多的 n 个字段', '10')
    .option('--show-bad', '把非法行的内容也打出来')
    .addHelpText(
      'after',
      `
示例:
  $ jsonl stats sample.jsonl
  $ jsonl stats sample.jsonl --top 3 --show-bad
  $ cat sample.jsonl | jsonl stats -
  $ jsonl --json stats sample.jsonl | jq .fields`,
    )
    .action(async (file: string, raw: unknown) => {
      // commander 给的 raw 是 Record<string, any>，先过 zod 才拿到强类型。
      const options = validateOptions(statsOptionsSchema, raw, 'stats');
      await runStats(file, options, requireContext(holder));
    });
}
