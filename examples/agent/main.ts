/**
 * CLI 版工具调用 Agent —— 入口。
 *
 * 快速体验（**不需要 API key，不发任何网络请求**）：
 *   ./node_modules/.bin/tsx examples/agent/main.ts --dry-run "列出当前目录并读取 package.json 的 name"
 *
 * 真实模式：
 *   OPENAI_API_KEY=sk-xxx ./node_modules/.bin/tsx examples/agent/main.ts "帮我看看这个项目叫什么"
 *
 * CLI 铁律（第 01 / 08 章）：结果走 stdout，日志/轨迹走 stderr。
 * 这样 `pnpm agent --dry-run "..." | pbcopy` 才只拿到最终答案。
 */

import { Command } from 'commander';
import { runAgentLoop } from './lib/agent-loop.js';
import type { AgentEvent } from './lib/agent-loop.js';
import { createFakeClient } from './lib/fake-client.js';
import { createOpenAiClient } from './lib/openai-client.js';
import { buildSystemPrompt } from './lib/tool-registry.js';
import type { ChatClient, ChatMessage } from './lib/types.js';
import { createToolRegistry } from './tools/index.js';

/** 模型名变得很快，**永远从环境变量读**，代码里只放一个兜底默认值。 */
const DEFAULT_MODEL = process.env['MODEL'] ?? 'gpt-4o-mini';

interface CliOptions {
  model: string;
  maxSteps: string;
  stream: boolean;
  dryRun: boolean;
  root: string;
  yes: boolean;
  json: boolean;
}

async function main(): Promise<number> {
  const program = new Command()
    .name('agent')
    .description('带工具调用的 AI Agent 示例（支持完全离线运行）')
    .option('-m, --model <name>', '模型名（也可用 MODEL 环境变量）', DEFAULT_MODEL)
    .option('-s, --max-steps <n>', '工具循环最大轮数', '6')
    .option('--stream', '流式打印最终回答', false)
    .option('--dry-run', '强制使用离线假 client，不发任何网络请求', false)
    .option('--root <dir>', '文件类工具的安全根目录', process.cwd())
    .option('-y, --yes', '自动同意危险工具（CI 用；平时请交互确认）', false)
    .option('--json', '把完整消息轨迹以 JSON 打到 stdout', false)
    .argument('[question...]', '你的问题；省略时从 stdin 读')
    .showHelpAfterError();

  program.parse();
  const opts = program.opts<CliOptions>();

  const maxSteps = Number(opts.maxSteps);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    console.error(`--max-steps 必须是正整数，收到 ${opts.maxSteps}`);
    return 2;
  }

  const question = (program.args.join(' ').trim() || (await readStdin()).trim());
  if (question === '') {
    console.error('没有问题可回答。用法：agent [options] "你的问题"，或者用管道传入。');
    return 2;
  }

  const registry = createToolRegistry(opts.root);
  const client = pickClient(opts);
  console.error(`[agent] client = ${client.label}`);
  console.error(`[agent] root   = ${opts.root}`);
  console.error(`[agent] 工具   = ${Object.keys(registry).sort().join(', ')}\n`);

  const system = buildSystemPrompt(registry, {
    role: '你是一个运行在命令行里的助手，通过调用工具来回答关于本地文件的问题。',
    constraints: [
      '只能通过工具获取信息，不要凭记忆编造文件内容。',
      '一次可以并行调用多个工具。',
      '工具返回以「错误:」开头时，读懂原因后修正参数重试，不要重复同样的错误调用。',
      '危险操作（写文件）会需要用户确认，被拒绝就换只读方案。',
    ],
    outputFormat: '用简洁的中文回答，必要时列点。不要输出 JSON。',
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: question },
  ];

  try {
    const result = await runAgentLoop(client, {
      messages,
      registry,
      model: opts.model,
      maxSteps,
      stream: opts.stream,
      onEvent: makeTracePrinter(opts.stream),
      confirm: opts.yes ? async () => true : confirmInteractively,
    });

    console.error(
      `\n[agent] 完成：${result.steps} 轮请求，token 合计 ${result.usage.total_tokens}` +
        `（prompt ${result.usage.prompt_tokens} / completion ${result.usage.completion_tokens}）`,
    );

    // 结果走 stdout
    if (opts.json) {
      console.log(JSON.stringify({ question, finalText: result.finalText, steps: result.steps, usage: result.usage, messages: result.messages }, null, 2));
    } else if (!opts.stream) {
      console.log(result.finalText);
    } else {
      process.stdout.write('\n');
    }
    return 0;
  } catch (err) {
    console.error(`[agent] 失败: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

function pickClient(opts: CliOptions): ChatClient {
  const apiKey = process.env['OPENAI_API_KEY'];
  // 👇 这一行是本示例最贴心的设计：没 key 或显式 --dry-run 就自动降级到离线假 client，
  //    读者 clone 下来就能立刻看到完整的工具调用轨迹。
  if (opts.dryRun || apiKey == null || apiKey === '') return createFakeClient();
  return createOpenAiClient({
    apiKey,
    baseURL: process.env['OPENAI_BASE_URL'], // DeepSeek / Ollama / vLLM 只需要改这里
    model: opts.model,
    timeoutMs: 60_000,
    maxRetries: 2,
  });
}

/** 把循环里的事件打成人类可读的轨迹（全部走 stderr）。 */
function makeTracePrinter(streaming: boolean): (event: AgentEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'request':
        console.error(`[第 ${event.step} 轮] → 请求模型（携带 ${event.messageCount} 条消息）`);
        break;
      case 'tool-call':
        console.error(`[第 ${event.step} 轮] ⚙ 调用 ${event.call.function.name}(${event.call.function.arguments})`);
        break;
      case 'tool-result': {
        const flat = (event.content ?? '').replace(/\n/g, ' ⏎ ');
        const short = flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
        const mark = flat.startsWith('错误:') ? '✗' : '✓';
        console.error(`[第 ${event.step} 轮] ${mark} ${event.name} → ${short}`);
        break;
      }
      case 'tool-denied':
        console.error(`[第 ${event.step} 轮] ⛔ 用户拒绝了 ${event.name}`);
        break;
      case 'assistant-text':
        if (!streaming) console.error(`[第 ${event.step} 轮] 💬 ${event.text.split('\n')[0] ?? ''}`);
        break;
      case 'text-delta':
        process.stdout.write(event.text); // 流式内容属于「结果」，走 stdout
        break;
      case 'usage':
        break;
      default:
        break;
    }
  };
}

/** 危险工具的人类确认。stdin 不是 TTY（比如在管道里）时一律拒绝，宁可少做不要做错。 */
async function confirmInteractively(call: { function: { name: string; arguments: string } }): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(`[agent] 非交互环境，自动拒绝危险工具 ${call.function.name}（需要时请加 --yes）`);
    return false;
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`⚠️  允许执行 ${call.function.name}(${call.function.arguments})? [y/N] `);
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// 用 process.exitCode 而不是 process.exit()：等事件循环跑完，避免截断 stdout。
process.exitCode = await main();
