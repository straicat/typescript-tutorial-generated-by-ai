import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  estimateTokens,
  redactSecrets,
  defineTool,
  toolToOpenAiTool,
  buildToolsParam,
  executeToolCall,
  parseJsonLoose,
  accumulateStreamDeltas,
  truncateMessages,
  buildSystemPrompt,
  shouldRetry,
  retryAfterMs,
  safeResolveInsideRoot,
  withUsageTracking,
  runToolLoop,
} from '@exercises/ch09-agent';
import type {
  AnyTool,
  ChatClient,
  ChatMessage,
  ChatRequest,
  ChatResult,
  StreamChunk,
  ToolCall,
  ToolRegistry,
} from '@exercises/ch09-agent';
import type { ZodType } from 'zod';

/* ---------------------------------------------------------------------
 * 测试脚手架：一个完全离线的假 client。
 * 这就是本章的核心主张 —— 依赖注入 ChatClient 接口，一行网络请求都不发。
 * ------------------------------------------------------------------- */
function fakeClient(script: readonly ChatResult[]): ChatClient & { seen: ChatRequest[] } {
  let i = 0;
  const seen: ChatRequest[] = [];
  return {
    seen,
    chat(request: ChatRequest): Promise<ChatResult> {
      // 深拷贝请求快照，否则后续 push 会改掉我们记录的数组
      seen.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });
      const next = script[i];
      i += 1;
      if (next == null) throw new Error(`假 client 脚本用完了（第 ${i} 次调用）`);
      return Promise.resolve(next);
    },
  };
}

function toolCall(id: string, name: string, args: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: args } };
}

/**
 * 本地造工具的小helper。故意不用被测的 defineTool —— 否则 9.3 没做完的时候
 * 整个测试文件会在收集阶段就炸掉，看不到其它题的红点。
 */
function makeTool<S extends ZodType>(spec: {
  name: string;
  description: string;
  schema: S;
  execute: (args: z.output<S>) => string | Promise<string>;
}): AnyTool {
  return spec as AnyTool;
}

const echoTool = makeTool({
  name: 'echo',
  description: '回显文本',
  schema: z.object({ text: z.string() }),
  execute: (args) => `echo:${args.text}`,
});

const addTool = makeTool({
  name: 'add',
  description: '两数相加',
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: (args) => String(args.a + args.b),
});

const boomTool = makeTool({
  name: 'boom',
  description: '总是失败',
  schema: z.object({}),
  execute: () => {
    throw new Error('磁盘炸了');
  },
});

const registry: ToolRegistry = { echo: echoTool, add: addTool, boom: boomTool };

// =====================================================================

describe('9.1 estimateTokens', () => {
  it('非 CJK 按 4 字符 1 token 向上取整', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('CJK 每字 1 token（不能按 chars/4 低估）', () => {
    expect(estimateTokens('你好')).toBe(2);
    expect(estimateTokens('你好abcd')).toBe(3);
    expect(estimateTokens('中文测试一二三')).toBe(7);
  });

  it('按码点计数，emoji 只算一个字符', () => {
    expect('👍'.length).toBe(2); // 先感受坑
    expect(estimateTokens('👍')).toBe(1);
    expect(estimateTokens('👍👍👍👍')).toBe(1); // 4 个码点 -> ceil(4/4)
  });
});

describe('9.2 redactSecrets', () => {
  it('打掉 sk- 开头的 key（含 sk-proj- 这种带连字符的）', () => {
    expect(redactSecrets('用 sk-abcd1234efgh 调用')).toBe('用 sk-*** 调用');
    expect(redactSecrets('sk-proj-AbCd1234_x-Yz')).toBe('sk-***');
  });

  it('打掉 Bearer token 和 *_KEY=xxx 形式的环境变量', () => {
    expect(redactSecrets('Authorization: Bearer abcdefgh1234')).toBe('Authorization: Bearer ***');
    expect(redactSecrets('OPENAI_API_KEY=xyz123')).toBe('OPENAI_API_KEY=***');
    expect(redactSecrets('apiKey=abc123')).toBe('apiKey=***');
    expect(redactSecrets('DB_PASSWORD=hunter2')).toBe('DB_PASSWORD=***');
  });

  it('不误伤：短串、模型名、普通键值', () => {
    expect(redactSecrets('sk-短')).toBe('sk-短');
    expect(redactSecrets('model=gpt-4o-mini')).toBe('model=gpt-4o-mini');
    expect(redactSecrets('没有秘密')).toBe('没有秘密');
  });

  it('幂等：脱敏结果再脱敏一次不变', () => {
    const once = redactSecrets('Bearer abcdefgh1234 与 sk-abcd1234efgh 与 API_KEY=zzzzzzzz');
    expect(redactSecrets(once)).toBe(once);
  });
});

describe('9.3 defineTool / toolToOpenAiTool / buildToolsParam', () => {
  it('defineTool 让 execute 的参数类型从 schema 自动推导（编译期 + 运行期都要对）', async () => {
    const t = defineTool({
      name: 'echo',
      description: '回显文本',
      schema: z.object({ text: z.string() }),
      // 这里不写任何类型标注：args 就是 { text: string }
      execute: (args) => `echo:${args.text.toUpperCase()}`,
    });
    expect(t.name).toBe('echo');
    expect(await t.execute({ text: 'hi' })).toBe('echo:HI');
  });

  it('生成 OpenAI tools 数组要求的精确结构', () => {
    expect(toolToOpenAiTool(echoTool)).toEqual({
      type: 'function',
      function: {
        name: 'echo',
        description: '回显文本',
        strict: true,
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    });
  });

  it('不能把 $schema 带给 OpenAI', () => {
    const params = toolToOpenAiTool(addTool).function.parameters;
    expect(params['$schema']).toBeUndefined();
    expect(params['additionalProperties']).toBe(false);
    expect(params['required']).toEqual(['a', 'b']);
  });

  it('无参工具要补出空的 properties / required（zod 不会生成）', () => {
    expect(toolToOpenAiTool(boomTool).function.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it('buildToolsParam 按工具名字典序输出，保证请求可复现', () => {
    const names = buildToolsParam(registry).map((t) => t.function.name);
    expect(names).toEqual(['add', 'boom', 'echo']);
    expect(buildToolsParam({})).toEqual([]);
  });
});

describe('9.4 executeToolCall', () => {
  it('成功时返回 role=tool 且带 tool_call_id', async () => {
    const msg = await executeToolCall(registry, toolCall('c1', 'echo', '{"text":"hi"}'));
    expect(msg).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'echo:hi' });
  });

  it('未注册的工具返回错误文本，不抛异常', async () => {
    const msg = await executeToolCall(registry, toolCall('c2', 'rmrf', '{}'));
    expect(msg.role).toBe('tool');
    expect(msg.content).toBe('错误: 未注册的工具 "rmrf"');
  });

  it('模型给出非法 JSON 时返回错误文本（实战最高频）', async () => {
    const msg = await executeToolCall(registry, toolCall('c3', 'echo', '{"text": '));
    expect(msg.content).toContain('错误: 参数不是合法 JSON');
    expect(msg.content).toContain('{"text": ');
  });

  it('zod 校验失败时把校验信息回给模型，让它自我修正', async () => {
    const msg = await executeToolCall(registry, toolCall('c4', 'add', '{"a":1,"b":"x"}'));
    expect(msg.content).toContain('错误: 参数校验失败');
    expect(msg.content).toContain('b:');
  });

  it('工具自身抛异常也要转成文本（不能让循环挂掉）', async () => {
    const msg = await executeToolCall(registry, toolCall('c5', 'boom', '{}'));
    expect(msg.content).toBe('错误: 工具执行失败: 磁盘炸了');
  });

  it('空 arguments 当成 {}（无参工具模型常这么给）', async () => {
    const noop = makeTool({
      name: 'noop',
      description: '啥也不做',
      schema: z.object({}),
      execute: () => 'ok',
    });
    const msg = await executeToolCall({ noop }, toolCall('c6', 'noop', ''));
    expect(msg.content).toBe('ok');
  });
});

describe('9.5 parseJsonLoose', () => {
  const S = z.object({ a: z.number() });

  it('剥掉 ```json 围栏', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```', S)).toEqual({ ok: true, data: { a: 1 } });
    expect(parseJsonLoose('```\n{"a":2}\n```', S)).toEqual({ ok: true, data: { a: 2 } });
  });

  it('忽略 JSON 前后的寒暄', () => {
    expect(parseJsonLoose('好的，结果是 {"a":3} 希望有帮助！', S)).toEqual({
      ok: true,
      data: { a: 3 },
    });
    expect(parseJsonLoose('{"a":4}', S)).toEqual({ ok: true, data: { a: 4 } });
  });

  it('JSON 合法但不符合 schema 时也要判失败（parse 成功 ≠ 数据对）', () => {
    const r = parseJsonLoose('{"a":"x"}', S);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('a');
  });

  it('完全没有 JSON / JSON 语法错都返回 ok:false，不抛异常', () => {
    expect(parseJsonLoose('完全没有 json', S).ok).toBe(false);
    expect(parseJsonLoose('{"a": }', S).ok).toBe(false);
    expect(() => parseJsonLoose('', S)).not.toThrow();
  });

  it('也支持数组', () => {
    const arr = z.array(z.number());
    expect(parseJsonLoose('前面废话 [1,2,3] 后面废话', arr)).toEqual({ ok: true, data: [1, 2, 3] });
  });
});

describe('9.6 accumulateStreamDeltas', () => {
  it('拼接纯文本增量', () => {
    const chunks: StreamChunk[] = [
      { delta: { content: 'He' } },
      { delta: { content: 'llo' } },
      { delta: {}, finishReason: 'stop' },
    ];
    expect(accumulateStreamDeltas(chunks)).toEqual({
      message: { role: 'assistant', content: 'Hello' },
      finishReason: 'stop',
    });
  });

  it('一个 content 碎片都没有时 content 必须是 null 而不是空串', () => {
    const r = accumulateStreamDeltas([{ delta: {}, finishReason: 'stop' }]);
    expect(r.message.content).toBeNull();
    expect(r.message.tool_calls).toBeUndefined();
  });

  it('按 index 合并 tool_calls 分片：id/name 只来一次，arguments 要拼', () => {
    const chunks: StreamChunk[] = [
      { delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add', arguments: '' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } },
      { delta: { tool_calls: [{ index: 0, function: { arguments: '1,"b":2}' } }] } },
      { delta: {}, finishReason: 'tool_calls', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ];
    expect(accumulateStreamDeltas(chunks)).toEqual({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } }],
      },
      finishReason: 'tool_calls',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });

  it('多个并行 tool_calls 交错到达，结果按 index 升序', () => {
    const chunks: StreamChunk[] = [
      { delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'echo', arguments: '{"text":' } }] } },
      { delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'add', arguments: '{}' } }] } },
      { delta: { tool_calls: [{ index: 1, function: { arguments: '"x"}' } }] } },
      { delta: {}, finishReason: 'tool_calls' },
    ];
    const calls = accumulateStreamDeltas(chunks).message.tool_calls ?? [];
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']);
    expect(calls[1]?.function.arguments).toBe('{"text":"x"}');
  });

  it('空数组：finishReason 兜底为 stop', () => {
    expect(accumulateStreamDeltas([])).toEqual({
      message: { role: 'assistant', content: null },
      finishReason: 'stop',
    });
  });
});

describe('9.7 truncateMessages', () => {
  const sys: ChatMessage = { role: 'system', content: 'S'.repeat(4) }; // 1 token
  const u1: ChatMessage = { role: 'user', content: 'a'.repeat(4) }; // 1
  const a1: ChatMessage = { role: 'assistant', content: 'b'.repeat(4) }; // 1
  const u2: ChatMessage = { role: 'user', content: 'c'.repeat(4) }; // 1
  const a2: ChatMessage = { role: 'assistant', content: 'd'.repeat(4) }; // 1

  it('预算够时全保留', () => {
    expect(truncateMessages([sys, u1, a1, u2, a2], 100)).toEqual([sys, u1, a1, u2, a2]);
  });

  it('预算不够时保 system + 丢最老的', () => {
    // 预算 3：system 吃掉 1，剩 2 -> 只留最后两条
    expect(truncateMessages([sys, u1, a1, u2, a2], 3)).toEqual([sys, u2, a2]);
  });

  it('system 消息无条件保留（即使预算为 0）', () => {
    expect(truncateMessages([sys, u1, a1], 0)).toEqual([sys]);
    expect(truncateMessages([sys, u1], -100)).toEqual([sys]);
  });

  it('😱 不能让窗口以孤儿 tool 消息开头（OpenAI 会 400）', () => {
    const asstCall: ChatMessage = {
      role: 'assistant',
      content: 'z'.repeat(4), // 1 token；模型经常一边说话一边调工具
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'add', arguments: '{}' } }],
    };
    const toolMsg: ChatMessage = { role: 'tool', tool_call_id: 't1', content: 'x'.repeat(4) };
    const tail: ChatMessage = { role: 'assistant', content: 'y'.repeat(4) };
    // 预算 3：system 吃掉 1，剩 2 -> 从后往前能装 tail(1) + toolMsg(1)，
    // asstCall 装不下，于是窗口开头是 tool -> 必须把它丢掉
    const out = truncateMessages([sys, u1, asstCall, toolMsg, tail], 3);
    expect(out.map((m) => m.role)).toEqual(['system', 'assistant']);
    expect(out[1]).toBe(tail);
  });

  it('不修改入参数组', () => {
    const input: ChatMessage[] = [sys, u1, a1, u2, a2];
    truncateMessages(input, 2);
    expect(input).toHaveLength(5);
  });
});

describe('9.8 buildSystemPrompt', () => {
  it('空注册表 + 无选项：只有默认角色描述', () => {
    expect(buildSystemPrompt({})).toBe('你是一个严谨的命令行助手。');
  });

  it('工具按名字典序列出', () => {
    expect(buildSystemPrompt(registry, { role: '你是助手。' })).toBe(
      ['你是助手。', '', '可用工具：', '- add: 两数相加', '- boom: 总是失败', '- echo: 回显文本'].join('\n'),
    );
  });

  it('约束从 1 编号，段间一个空行，末尾无多余换行', () => {
    const out = buildSystemPrompt(
      {},
      { role: 'R', constraints: ['不要瞎猜', '危险操作先确认'], outputFormat: 'JSON' },
    );
    expect(out).toBe(['R', '', '约束：', '1. 不要瞎猜', '2. 危险操作先确认', '', '输出格式：', 'JSON'].join('\n'));
    expect(out.endsWith('\n')).toBe(false);
  });

  it('空 constraints 数组要整段省略', () => {
    expect(buildSystemPrompt({}, { role: 'R', constraints: [] })).toBe('R');
  });
});

describe('9.9 shouldRetry / retryAfterMs', () => {
  it('可重试：连接错误（无 status）、408/409/429、5xx', () => {
    expect(shouldRetry({})).toBe(true);
    expect(shouldRetry({ status: null })).toBe(true);
    expect(shouldRetry({ status: 408 })).toBe(true);
    expect(shouldRetry({ status: 409 })).toBe(true);
    expect(shouldRetry({ status: 429 })).toBe(true);
    expect(shouldRetry({ status: 500 })).toBe(true);
    expect(shouldRetry({ status: 503 })).toBe(true);
  });

  it('不可重试：其它 4xx', () => {
    expect(shouldRetry({ status: 400 })).toBe(false);
    expect(shouldRetry({ status: 401 })).toBe(false);
    expect(shouldRetry({ status: 403 })).toBe(false);
    expect(shouldRetry({ status: 404 })).toBe(false);
    expect(shouldRetry({ status: 422 })).toBe(false);
  });

  it('余额不足即使是 429 也不重试', () => {
    expect(shouldRetry({ status: 429, code: 'insufficient_quota' })).toBe(false);
  });

  it('优先用服务端给的 retry-after / retry-after-ms', () => {
    expect(retryAfterMs({ headers: new Headers({ 'retry-after': '3' }) }, 0)).toBe(3000);
    expect(retryAfterMs({ headers: new Headers({ 'retry-after-ms': '250' }) }, 5)).toBe(250);
    expect(retryAfterMs({ headers: new Headers({ 'retry-after': '0' }) }, 0)).toBe(0);
  });

  it('没有可用头部时走指数退避并封顶 30s', () => {
    expect(retryAfterMs({}, 0)).toBe(500);
    expect(retryAfterMs({}, 1)).toBe(1000);
    expect(retryAfterMs({}, 3)).toBe(4000);
    expect(retryAfterMs({}, 20)).toBe(30_000);
  });

  it('retry-after 是日期格式（非数字）时回退到退避', () => {
    const headers = new Headers({ 'retry-after': 'Wed, 21 Oct 2015 07:28:00 GMT' });
    expect(retryAfterMs({ headers }, 1)).toBe(1000);
  });
});

describe('9.10 safeResolveInsideRoot', () => {
  it('root 内的相对路径正常解析', () => {
    expect(safeResolveInsideRoot('/srv/app', 'a/b.txt')).toBe('/srv/app/a/b.txt');
    expect(safeResolveInsideRoot('/srv/app', './x')).toBe('/srv/app/x');
    expect(safeResolveInsideRoot('/srv/app', 'a/./b/../c')).toBe('/srv/app/a/c');
  });

  it('root 自身合法', () => {
    expect(safeResolveInsideRoot('/srv/app', '.')).toBe('/srv/app');
    expect(safeResolveInsideRoot('/srv/app', '')).toBe('/srv/app');
  });

  it('root 内的绝对路径合法，root 外的绝对路径拒绝', () => {
    expect(safeResolveInsideRoot('/srv/app', '/srv/app/ok')).toBe('/srv/app/ok');
    expect(safeResolveInsideRoot('/srv/app', '/etc/passwd')).toBeNull();
  });

  it('拒绝 .. 穿越', () => {
    expect(safeResolveInsideRoot('/srv/app', '../etc/passwd')).toBeNull();
    expect(safeResolveInsideRoot('/srv/app', 'a/../../b')).toBeNull();
    expect(safeResolveInsideRoot('/srv/app', '../../..')).toBeNull();
  });

  it('😱 前缀坑：/srv/application 不在 /srv/app 里', () => {
    expect(safeResolveInsideRoot('/srv/app', '/srv/application/x')).toBeNull();
  });
});

describe('9.11 withUsageTracking', () => {
  const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 };
  const result: ChatResult = { message: { role: 'assistant', content: 'hi' }, finishReason: 'stop', usage };

  it('初始为全 0', () => {
    const t = withUsageTracking(fakeClient([]));
    expect(t.total()).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(t.calls()).toBe(0);
  });

  it('累加多次调用的 usage，并原样透传 result', async () => {
    const inner = { chat: vi.fn<ChatClient['chat']>().mockResolvedValue(result) };
    const t = withUsageTracking(inner);
    const got = await t.client.chat({ messages: [] });
    await t.client.chat({ messages: [] });

    expect(got).toBe(result); // 原样返回，不要拷贝
    expect(t.total()).toEqual({ prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 });
    expect(t.calls()).toBe(2);
    expect(inner.chat).toHaveBeenCalledTimes(2);
    expect(inner.chat).toHaveBeenLastCalledWith({ messages: [] }); // 断言透传的参数
  });

  it('usage 缺失时按 0 算，不能变 NaN', async () => {
    const inner: ChatClient = {
      chat: () => Promise.resolve({ message: { role: 'assistant', content: 'x' }, finishReason: 'stop' }),
    };
    const t = withUsageTracking(inner);
    await t.client.chat({ messages: [] });
    expect(t.total()).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it('内层抛异常要透传，但请求数照样计入', async () => {
    const inner: ChatClient = { chat: () => Promise.reject(new Error('429')) };
    const t = withUsageTracking(inner);
    await expect(t.client.chat({ messages: [] })).rejects.toThrow('429');
    expect(t.calls()).toBe(1);
  });
});

describe('9.12 runToolLoop', () => {
  const user: ChatMessage = { role: 'user', content: '1+2 等于几？' };

  it('模型直接回答：只请求一轮', async () => {
    const client = fakeClient([
      { message: { role: 'assistant', content: '等于 3' }, finishReason: 'stop' },
    ]);
    const r = await runToolLoop(client, { messages: [user], registry });
    expect(r.finalText).toBe('等于 3');
    expect(r.steps).toBe(1);
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('一轮工具调用：轨迹是 user -> assistant(tool_calls) -> tool -> assistant', async () => {
    const client = fakeClient([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall('t1', 'add', '{"a":1,"b":2}')],
        },
        finishReason: 'tool_calls',
      },
      { message: { role: 'assistant', content: '等于 3' }, finishReason: 'stop' },
    ]);
    const r = await runToolLoop(client, { messages: [user], registry });
    expect(r.steps).toBe(2);
    expect(r.finalText).toBe('等于 3');
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(r.messages[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: '3' });
    // 第二次请求必须带上完整历史，且 tools 参数还在
    expect(client.seen[1]?.messages).toHaveLength(3);
    expect(client.seen[1]?.tools?.map((t) => t.function.name)).toEqual(['add', 'boom', 'echo']);
  });

  it('并行多工具：tool 消息顺序必须和 tool_calls 顺序一致', async () => {
    const client = fakeClient([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall('t1', 'echo', '{"text":"A"}'), toolCall('t2', 'add', '{"a":2,"b":2}')],
        },
        finishReason: 'tool_calls',
      },
      { message: { role: 'assistant', content: '好了' }, finishReason: 'stop' },
    ]);
    const r = await runToolLoop(client, { messages: [user], registry });
    expect(r.messages.slice(2, 4)).toEqual([
      { role: 'tool', tool_call_id: 't1', content: 'echo:A' },
      { role: 'tool', tool_call_id: 't2', content: '4' },
    ]);
  });

  it('工具报错不中断循环，错误文本进 tool 消息', async () => {
    const client = fakeClient([
      {
        message: { role: 'assistant', content: null, tool_calls: [toolCall('t1', 'boom', '{}')] },
        finishReason: 'tool_calls',
      },
      { message: { role: 'assistant', content: '工具挂了，我换个办法' }, finishReason: 'stop' },
    ]);
    const r = await runToolLoop(client, { messages: [user], registry });
    expect(r.messages[2]?.content).toContain('错误: 工具执行失败');
    expect(r.finalText).toBe('工具挂了，我换个办法');
  });

  it('超过 maxSteps 要抛错（死循环保护）', async () => {
    const looping: ChatResult = {
      message: { role: 'assistant', content: null, tool_calls: [toolCall('t', 'add', '{"a":1,"b":1}')] },
      finishReason: 'tool_calls',
    };
    const client = fakeClient([looping, looping, looping, looping, looping]);
    await expect(runToolLoop(client, { messages: [user], registry, maxSteps: 2 })).rejects.toThrow(
      '工具循环超过最大轮数 2',
    );
  });

  it('不修改传入的 messages，并透传 model', async () => {
    const input: ChatMessage[] = [user];
    const client = fakeClient([{ message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' }]);
    await runToolLoop(client, { messages: input, registry, model: 'deepseek-chat' });
    expect(input).toHaveLength(1);
    expect(client.seen[0]?.model).toBe('deepseek-chat');
  });
});
