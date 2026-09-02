#!/usr/bin/env node
/**
 * jsonl —— 一个处理 JSON Lines 日志的命令行工具。
 * =====================================================================
 * 这是 docs/08-cli-with-commander.md 的配套完整示例。跑法：
 *
 *   pnpm cli --help
 *   pnpm cli stats examples/cli/sample.jsonl
 *   cat examples/cli/sample.jsonl | pnpm cli filter - -w level=error
 *
 * 分层（这是本例子最想教的东西）：
 *
 *   main.ts            ← 只做 commander 装配 + 进程级关注点（信号、退出码）
 *   commands/*.ts      ← 每个子命令：装配自己的参数 + 调业务函数
 *   lib/*.ts           ← 纯逻辑 / 注入式依赖，不碰 process，可以直接单测
 *
 * 顶层第一行的 shebang `#!/usr/bin/env node` 是让 `./main.js` 能直接执行的关键，
 * 配合 package.json 的 `"bin": { "jsonl": "./dist/main.js" }` 就能 `npx jsonl`。
 * =====================================================================
 */

import { Command, CommanderError } from 'commander';
import { makeConfigCommand } from './commands/config.js';
import { makeFilterCommand } from './commands/filter.js';
import { makeHeadCommand } from './commands/head.js';
import { makeStatsCommand } from './commands/stats.js';
import { createColors, shouldUseColor } from './lib/colors.js';
import type { ContextHolder } from './lib/context.js';
import { describeError, exitCodeFor } from './lib/errors.js';
import { globalOptionsSchema, validateOptions } from './lib/options.js';
import { createReporter } from './lib/output.js';

const VERSION = '1.0.0';

/** 一个 AbortController 串起所有可取消的工作（读文件、HTTP、子进程……）。 */
const controller = new AbortController();

/**
 * 😱 commander 的坑：`.command('sub')` 创建的子命令会自动继承父命令的
 * exitOverride / configureOutput / showHelpAfterError，但 `.addCommand(cmd)`
 * **不会**。不手动补的话，子命令报错时会绕过你的 exitOverride 直接 process.exit()，
 * 测试里就抓不到了。
 */
function inheritSettings(parent: Command, cmd: Command): void {
  cmd.copyInheritedSettings(parent);
  for (const child of cmd.commands) inheritSettings(cmd, child);
}

export function buildProgram(holder: ContextHolder): Command {
  const program = new Command('jsonl');

  program
    .description('处理 JSON Lines 日志的小工具（第 08 章示例）')
    .version(VERSION, '-V, --version', '打印版本号')
    // 全局选项。commander 默认是「非位置」模式，所以 `jsonl stats f.jsonl --json`
    // 和 `jsonl --json stats f.jsonl` 都能识别（子命令里用 optsWithGlobals() 读）。
    .option('--json', '输出机器可读的 JSON（一行一个对象）')
    .option('--no-color', '禁用彩色输出')
    .option('-v, --verbose', '把诊断信息打到 stderr')
    // 出错时顺手提示怎么看帮助，比干巴巴一行 error 友好得多。
    .showHelpAfterError('(用 --help 查看用法)')
    // 让 commander 抛异常而不是 process.exit()：退出码统一在 main() 里决定，
    // 也是让整个 CLI 可以在测试里跑的前提。
    .exitOverride()
    .addHelpText(
      'after',
      `
铁律:
  stdout 只放数据, stderr 只放日志。所以下面这行是安全的：
    $ jsonl --json stats sample.jsonl 2>/dev/null | jq .

退出码:
  0 成功   1 一般错误   2 用法错误   130 被 Ctrl-C 中断`,
    );

  // preAction hook：所有子命令的 action 之前跑一次，用来做全局初始化
  // （这里是「决定要不要上色 + 建 reporter」；真实项目里常见的是初始化 logger / 读配置 / 连数据库）。
  program.hook('preAction', (thisCommand, actionCommand) => {
    const globals = validateOptions(globalOptionsSchema, actionCommand.optsWithGlobals(), 'global');
    const useColor = shouldUseColor({
      color: globals.color,
      // 注意：判断的是 **stdout** 是不是终端，而不是 stdin。
      isTTY: process.stdout.isTTY === true,
      env: process.env,
    });
    const colors = createColors(useColor);
    const reporter = createReporter({
      stdout: process.stdout,
      stderr: process.stderr,
      verbose: globals.verbose,
      colors,
    });
    holder.current = {
      globals,
      colors,
      reporter,
      stdin: process.stdin,
      stdinIsTTY: process.stdin.isTTY === true,
      stdout: process.stdout,
      signal: controller.signal,
    };
    reporter.info(`jsonl v${VERSION} · ${thisCommand.name()} ${actionCommand.name()}`);
  });

  for (const sub of [
    makeStatsCommand(holder),
    makeFilterCommand(holder),
    makeHeadCommand(holder),
    makeConfigCommand(holder),
  ]) {
    program.addCommand(sub);
    inheritSettings(program, sub);
  }

  return program;
}

// ---------------------------------------------------------------- 进程层

function installSignalHandlers(): void {
  let interrupted = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interrupted) process.exit(130); // 连按两次 Ctrl-C：立刻硬退
      interrupted = true;
      process.stderr.write(`\n收到 ${signal}，正在收尾…（再按一次强制退出）\n`);
      controller.abort();
      // 130 = 128 + SIGINT(2)，是 shell 的约定。
      process.exitCode = 130;
    });
  }
}

async function main(): Promise<void> {
  installSignalHandlers();
  const holder: ContextHolder = { current: null };
  const program = buildProgram(holder);

  try {
    // 有 async action 就必须用 parseAsync；用 parse 的话「装配完就返回」，
    // 异步逻辑还没跑完进程就退出了。
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version 也是通过异常出来的，它们的 exitCode 是 0，不是错误。
      process.exitCode = err.exitCode;
      return;
    }
    const reporter = holder.current?.reporter;
    const message = describeError(err);
    if (reporter != null) reporter.error(message);
    else process.stderr.write(`[error] ${message}\n`);
    if (holder.current?.globals.verbose === true && err instanceof Error) {
      process.stderr.write(`${err.stack ?? ''}\n`);
    }
    // 用 process.exitCode 而不是 process.exit()：让还没 flush 的 stdout 写完再退。
    process.exitCode = exitCodeFor(err);
  }
}

await main();
