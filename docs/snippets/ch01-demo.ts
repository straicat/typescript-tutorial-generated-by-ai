// 第 01 章示例：把基础语法串起来
// 运行：pnpm ex docs/snippets/ch01-demo.ts

interface ParseResult {
  ok: boolean;
  value?: number;
  reason?: string;
}

function parseNumberArg(raw: string | undefined, fallback?: number): ParseResult {
  // == null 一次挡住 null 和 undefined
  if (raw == null || raw.trim() === '') {
    return fallback == null
      ? { ok: false, reason: '缺少参数且无默认值' }
      : { ok: true, value: fallback };
  }

  const n = Number(raw);
  // 除零 / 非法输入不会抛异常，只会得到 NaN / Infinity，必须显式检查
  if (!Number.isFinite(n)) {
    return { ok: false, reason: `不是合法数字: ${raw}` };
  }
  return { ok: true, value: n };
}

for (const input of ['42', '', '  ', 'abc', '1e3', '0']) {
  const r = parseNumberArg(input, 10);
  console.log(JSON.stringify(input).padEnd(8), '=>', r.ok ? r.value : `失败(${r.reason})`);
}

// 对象参数 + 解构默认值：TS 里代替 Java Builder 的主力写法
interface RetryOptions {
  times?: number;
  delayMs?: number;
  label?: string;
}

function describeRetry({ times = 3, delayMs = 100, label = 'task' }: RetryOptions = {}): string {
  return `${label}: ${times} 次重试, 间隔 ${delayMs}ms`;
}

console.log(describeRetry());
console.log(describeRetry({ label: 'fetch', delayMs: 0 })); // 注意 0 没有被默认值覆盖
