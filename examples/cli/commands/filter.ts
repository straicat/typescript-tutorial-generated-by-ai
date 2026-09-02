/**
 * `jsonl filter <file> --where key=value` —— 过滤并输出。
 *
 * 这个命令刻意示范本章的核心主张：
 *   **commander 只负责把字符串收集起来，校验和转换全部交给 zod。**
 * 所以 `--where` 用普通的 `.option()` + collect 收集成 string[]，
 * 「至少要有一个条件」这条规则写在 zod schema 里（错了退出码是 2，而不是 commander 默认的 1）。
 */

import { Command } from 'commander';
import type { AppContext, ContextHolder } from '../lib/context.js';
import { requireContext } from '../lib/context.js';
import { ToolError, UsageError } from '../lib/errors.js';
import { readInputLines } from '../lib/input.js';
import type { WhereFilter } from '../lib/jsonl.js';
import { getByPath, matchesAll, parseJsonl, parseWhere } from '../lib/jsonl.js';
import type { FilterOptions } from '../lib/options.js';
import { filterOptionsSchema, validateOptions } from '../lib/options.js';

/** 可重复选项的收集器。commander 的自定义解析器签名就是 `(value, previous) => next`。 */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function compileFilters(specs: readonly string[]): WhereFilter[] {
  return specs.map((spec) => {
    try {
      return parseWhere(spec);
    } catch (err) {
      // 纯逻辑层只抛普通 Error；到了命令层才知道「这属于用法错误」→ 退出码 2。
      throw new UsageError((err as Error).message);
    }
  });
}

export async function runFilter(file: string, options: FilterOptions, ctx: AppContext): Promise<void> {
  const { reporter } = ctx;
  const filters = compileFilters(options.where);
  reporter.info(`${filters.length} 个过滤条件, limit=${options.limit ?? '∞'}`);

  const lines = await readInputLines({
    file,
    stdin: ctx.stdin,
    stdinIsTTY: ctx.stdinIsTTY,
    signal: ctx.signal,
  });
  const doc = parseJsonl(lines);

  let matched = 0;
  for (const rec of doc.records) {
    if (!matchesAll(rec.value, filters)) continue;
    matched += 1;

    const payload =
      options.fields == null
        ? rec.value
        : Object.fromEntries(options.fields.map((f) => [f, getByPath(rec.value, f.split('.'))]));

    // filter 的输出恒定是 JSONL —— 它的产物就该能直接喂给下一个命令。
    reporter.json(payload);

    if (options.limit != null && matched >= options.limit) {
      reporter.info(`达到 limit=${options.limit}，提前结束`);
      break;
    }
  }

  reporter.info(`匹配 ${matched}/${doc.records.length} 条`);
  if (doc.bad.length > 0) reporter.warn(`跳过 ${doc.bad.length} 行非法数据`);
  if (matched === 0 && options.failIfEmpty) {
    // 像 grep 那样：没匹配到用非零退出码告诉脚本，但**不是**默认行为。
    throw new ToolError('没有匹配的记录', 1);
  }
}

export function makeFilterCommand(holder: ContextHolder): Command {
  return new Command('filter')
    .alias('grep')
    .description('按 key=value 过滤记录，输出仍然是 JSONL')
    .argument('<file>', 'JSONL 文件路径，用 - 表示读 stdin')
    .option('-w, --where <expr>', '过滤条件，可重复：level=error / http.status!=200', collect, [])
    .option('-n, --limit <n>', '最多输出多少条')
    .option('-f, --fields <name...>', '只保留这些字段（支持 a.b 点路径）')
    .option('--fail-if-empty', '没有匹配时以退出码 1 结束（像 grep）')
    .addHelpText(
      'after',
      `
示例:
  $ jsonl filter sample.jsonl --where level=error
  $ jsonl filter sample.jsonl -w level=error -w svc=api --fields ts msg
  $ jsonl filter sample.jsonl -w 'http.status!=200' -n 2
  $ cat sample.jsonl | jsonl filter - -w level=warn | jq -r .msg`,
    )
    .action(async (file: string, raw: unknown) => {
      const options = validateOptions(filterOptionsSchema, raw, 'filter');
      await runFilter(file, options, requireContext(holder));
    });
}
