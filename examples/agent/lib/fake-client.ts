/**
 * 离线假 client —— 本示例最重要的文件之一。
 *
 * 它按一份**固定脚本**返回 tool_calls 和最终回答，所以：
 *   - 没有 API key 也能完整跑通整个 tool loop（`--dry-run`）
 *   - CI 里可以断言「调了几轮、调了哪些工具、最终答案是什么」
 *   - 不花一分钱
 *
 * 脚本刻意包含三种**真实世界一定会遇到的失败**，让你看到 Agent 怎么自愈：
 *   第 2 轮：漏传必填参数     -> zod 校验失败，错误文本回给模型
 *   第 3 轮：路径穿越 ../..   -> 安全闸门拦下，错误文本回给模型
 *   第 4 轮：改对了           -> 成功读到文件
 *
 * 注意：工具是**真的执行**的（真的读了磁盘），只有「模型」是假的。
 */

import type { ChatClient, ChatRequest, ChatResult, ToolCall } from './types.js';

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** 每一步返回什么 tool_calls；null 表示该步给出最终回答。 */
const SCRIPT: ReadonlyArray<readonly ToolCall[] | null> = [
  // 第 1 轮：并行调两个工具（模型很爱这么干，所以循环必须支持并行）
  [call('call_1', 'list_dir', { path: '.' }), call('call_2', 'now', {})],
  // 第 2 轮：故意漏掉必填的 maxBytes -> 会被 zod 挡下
  [call('call_3', 'read_file', { path: 'package.json' })],
  // 第 3 轮：故意路径穿越 -> 会被 safeResolveInsideRoot 挡下
  [call('call_4', 'read_file', { path: '../../../etc/passwd', maxBytes: null })],
  // 第 4 轮：终于调对了
  [call('call_5', 'read_file', { path: 'package.json', maxBytes: 4000 })],
  // 第 5 轮：给最终回答
  null,
];

/** 问题里出现「写 / write / note」时走这份脚本，用来演示危险工具的人类确认。 */
const DANGER_SCRIPT: ReadonlyArray<readonly ToolCall[] | null> = [
  [call('call_1', 'now', {})],
  [call('call_2', 'write_note', { path: 'agent-note.txt', content: 'hello from agent\n' })],
  null,
];

export function createFakeClient(): ChatClient {
  let step = 0;
  let script = SCRIPT;

  return {
    label: 'fake(offline, 不发任何网络请求)',

    async chat(request: ChatRequest): Promise<ChatResult> {
      if (step === 0) {
        const question = request.messages.find((m) => m.role === 'user')?.content ?? '';
        if (/写|write|note/i.test(question)) script = DANGER_SCRIPT;
      }
      const plan = script[step] ?? null;
      step += 1;

      // 假的 usage，让成本统计的代码路径也能被跑到
      const usage = { prompt_tokens: 120 + step * 40, completion_tokens: 30, total_tokens: 150 + step * 40 };

      if (plan != null) {
        return {
          message: { role: 'assistant', content: null, tool_calls: [...plan] },
          finishReason: 'tool_calls',
          usage,
        };
      }

      // 最终回答**从真实的工具结果里**拼出来，所以你看到的输出确实来自磁盘。
      const text = summarize(request);
      if (request.onTextDelta != null) {
        // 模拟流式：按 8 个字符一片吐出去
        for (const piece of chunk(text, 8)) {
          request.onTextDelta(piece);
          await sleep(12);
        }
      }
      return { message: { role: 'assistant', content: text }, finishReason: 'stop', usage };
    },
  };
}

function summarize(request: ChatRequest): string {
  const toolTexts = request.messages.filter((m) => m.role === 'tool').map((m) => m.content ?? '');
  const failures = toolTexts.filter((t) => t.startsWith('错误:'));
  const lines: string[] = [];

  // 目录清单：以 '- ' / 'd ' 开头的多行文本
  const listing = toolTexts.find((t) => /^[d-] /m.test(t));
  if (listing != null) {
    lines.push(`当前目录共 ${listing.split('\n').filter((l) => l.trim() !== '').length} 个条目。`);
  }

  // package.json：唯一以 '{' 开头的成功结果
  const pkgText = toolTexts.find((t) => t.trimStart().startsWith('{'));
  if (pkgText != null) {
    let name = '(解析失败)';
    try {
      const parsed: unknown = JSON.parse(pkgText);
      if (typeof parsed === 'object' && parsed !== null && 'name' in parsed) {
        name = String((parsed as { name: unknown }).name);
      }
    } catch {
      /* 保持 '(解析失败)' */
    }
    lines.push(`package.json 的 name 是 "${name}"。`);
  }

  const written = toolTexts.find((t) => t.startsWith('已写入'));
  if (written != null) lines.push(written + '。');

  const ts = toolTexts.find((t) => /^\d{4}-\d{2}-\d{2}T/.test(t));
  if (ts != null) lines.push(`当前时间（UTC）：${ts}。`);

  if (lines.length === 0) lines.push('工具没有返回可用信息。');
  lines.push(
    failures.length === 0
      ? '（所有工具调用都成功）'
      : `（过程中有 ${failures.length} 次工具调用失败，我已根据错误信息修正：${failures
          .map((f) => f.slice(0, 40).replace(/\n/g, ' '))
          .join(' / ')}…）`,
  );
  return lines.join('\n');
}

function chunk(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
