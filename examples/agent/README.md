# examples/agent —— 命令行 AI Agent（可完全离线运行）

一个「LLM + 工具 + 循环 + 状态」的最小但完整实现，对应 [第 09 章](../../docs/09-ai-agent-with-openai.md)。

**不需要 API key 就能立刻跑通完整的工具调用循环。**

---

## 目录结构

```
examples/agent/
├── main.ts                     入口：commander 解析参数、装配依赖、打印轨迹
├── lib/
│   ├── types.ts                ChatClient 等最小接口（**不 import openai**）
│   ├── tool-registry.ts        defineTool / zod→JSON Schema / executeToolCall
│   ├── agent-loop.ts           tool loop 主逻辑（依赖注入 ChatClient）
│   ├── openai-client.ts        真实实现（全项目唯一 import openai 的文件）
│   ├── fake-client.ts          离线假 client：按脚本返回 tool_calls
│   └── safe-path.ts            路径穿越防护
└── tools/
    ├── list-dir.ts             列目录
    ├── read-file.ts            读文件（演示 strict 模式的 .nullable() 限制）
    ├── calculate.ts            算术求值（手写解析器，**不用 eval**）
    ├── now.ts                  当前时间（无参工具）
    ├── write-note.ts           写文件 —— 标记 dangerous，需要人类确认
    ├── fs-guard.ts             文件工具共用的安全闸门
    └── index.ts                组装注册表
```

关键设计：**`agent-loop.ts` 只依赖 `ChatClient` 接口**，所以真实 client 和假
client 可以随意互换，单元测试不需要 key、不需要网络。

---

## 离线模式（推荐先跑这个）

```bash
cd tutorials/typescript

./node_modules/.bin/tsx examples/agent/main.ts --dry-run "列出当前目录并读取 package.json 的 name"
# 或者用 package.json 里的脚本：
pnpm agent --dry-run "列出当前目录并读取 package.json 的 name"
```

没有 `OPENAI_API_KEY` 时会**自动**切到离线假 client，加不加 `--dry-run` 都一样。

假 client 按一份固定脚本演戏，刻意包含三种真实世界一定会遇到的失败，
让你亲眼看到 Agent 怎么自愈：

| 轮次 | 假模型干了什么 | 结果 |
| --- | --- | --- |
| 1 | 并行调 `list_dir` + `now` | ✅ 都成功（验证并行执行） |
| 2 | `read_file` 漏传必填的 `maxBytes` | ✗ zod 校验拦下，错误文本回给模型 |
| 3 | `read_file('../../../etc/passwd')` | ✗ 路径穿越被拦下 |
| 4 | `read_file('package.json', 4000)` | ✅ 改对了 |
| 5 | 不再调工具，给出最终回答 | 循环结束 |

**工具是真的执行的**（真的读了你的磁盘），只有"模型"是假的。

### 真实输出

```console
$ ./node_modules/.bin/tsx examples/agent/main.ts --dry-run "列出当前目录并读取 package.json 的 name"
[agent] client = fake(offline, 不发任何网络请求)
[agent] root   = /home/jack/GitHub/tutorials/typescript
[agent] 工具   = calculate, list_dir, now, read_file, write_note

[第 1 轮] → 请求模型（携带 2 条消息）
[第 1 轮] ⚙ 调用 list_dir({"path":"."})
[第 1 轮] ⚙ 调用 now({})
[第 1 轮] ✓ now → 2026-08-31T04:09:48.672Z
[第 1 轮] ✓ list_dir → - .gitignore ⏎ - README.md ⏎ - package.json ⏎ - pnpm-lock.yaml ⏎ - pnpm-workspace.yaml ⏎ - tsconfig.json ⏎ - vitest.config.ts ⏎ d docs ⏎ d examples ⏎ d exercise…
[第 2 轮] → 请求模型（携带 5 条消息）
[第 2 轮] ⚙ 调用 read_file({"path":"package.json"})
[第 2 轮] ✗ read_file → 错误: 参数校验失败: maxBytes: Invalid input: expected number, received undefined。请按 schema 重新调用。
[第 3 轮] → 请求模型（携带 7 条消息）
[第 3 轮] ⚙ 调用 read_file({"path":"../../../etc/passwd","maxBytes":null})
[第 3 轮] ✗ read_file → 错误: 工具执行失败: 路径越界，只允许访问 /home/jack/GitHub/tutorials/typescript 内的文件: ../../../etc/passwd
[第 4 轮] → 请求模型（携带 9 条消息）
[第 4 轮] ⚙ 调用 read_file({"path":"package.json","maxBytes":4000})
[第 4 轮] ✓ read_file → { ⏎   "name": "ts-for-backend-devs", ⏎   "version": "1.0.0", ⏎   "private": true, ⏎   "type": "module", ⏎   "description": "TypeScript 快速入门（面向有 Java/Go 经验的后端工程师…
[第 5 轮] → 请求模型（携带 11 条消息）
[第 5 轮] 💬 当前目录共 13 个条目。

[agent] 完成：5 轮请求，token 合计 1350（prompt 1200 / completion 150）
当前目录共 13 个条目。
package.json 的 name 是 "ts-for-backend-devs"。
当前时间（UTC）：2026-08-31T04:09:48.672Z。
（过程中有 2 次工具调用失败，我已根据错误信息修正：错误: 参数校验失败: maxBytes: Invalid input: exp / 错误: 工具执行失败: 路径越界，只允许访问 /home/jack/GitHub…）
```

> 目录条目数、时间戳会随你的工作树变化，其余轨迹是确定的。
>
> **注意上面哪些走了 stderr、哪些走了 stdout**：`[...]` 开头的轨迹全是 stderr，
> 只有最后的答案在 stdout。所以 `pnpm agent --dry-run "..." 2>/dev/null` 只会剩下答案 ——
> 这是第 01 / 08 章反复强调的 CLI 铁律。

### 演示危险工具的人类确认

```bash
# 问题里带"写"字会切到另一份脚本，模型会尝试 write_note
./node_modules/.bin/tsx examples/agent/main.ts --dry-run "写一条笔记到 agent-note.txt"
```

非交互环境（管道 / CI）**默认拒绝**危险工具，你会看到：

```
[第 2 轮] ⚙ 调用 write_note({"path":"agent-note.txt","content":"hello from agent\n"})
[agent] 非交互环境，自动拒绝危险工具 write_note（需要时请加 --yes）
[第 2 轮] ⛔ 用户拒绝了 write_note
```

在真正的终端里跑会弹出 `⚠️ 允许执行 write_note(...)? [y/N]`。
加 `--yes` 会直接放行（**只在 CI 里这么用**）。

---

## 真实模式

```bash
export OPENAI_API_KEY=sk-...            # ❌ 永远不要把 key 写进代码
./node_modules/.bin/tsx examples/agent/main.ts "这个项目的依赖里有哪些和测试相关？"

# Node 20.6+ 自带 --env-file，不需要 dotenv
node --env-file=.env --import tsx examples/agent/main.ts --stream "帮我看看 tsconfig 开了哪些严格项"
```

## 换成兼容 OpenAI 协议的服务（DeepSeek / Kimi / Qwen / vLLM / Ollama）

**一行代码都不用改**，只改三个环境变量：

```bash
# DeepSeek
OPENAI_BASE_URL=https://api.deepseek.com  OPENAI_API_KEY=sk-xxx  MODEL=deepseek-chat \
  ./node_modules/.bin/tsx examples/agent/main.ts "..."

# 月之暗面 Kimi
OPENAI_BASE_URL=https://api.moonshot.cn/v1  OPENAI_API_KEY=sk-xxx  MODEL=moonshot-v1-8k \
  ./node_modules/.bin/tsx examples/agent/main.ts "..."

# 阿里云百炼（Qwen）
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  OPENAI_API_KEY=sk-xxx  MODEL=qwen-plus \
  ./node_modules/.bin/tsx examples/agent/main.ts "..."

# 本地 Ollama（apiKey 随便填，但不能是空串）
OPENAI_BASE_URL=http://localhost:11434/v1  OPENAI_API_KEY=ollama  MODEL=qwen3 \
  ./node_modules/.bin/tsx examples/agent/main.ts "..."

# 本地 vLLM
OPENAI_BASE_URL=http://localhost:8000/v1  OPENAI_API_KEY=dummy  MODEL=Qwen/Qwen3-8B \
  ./node_modules/.bin/tsx examples/agent/main.ts "..."
```

⚠️ 兼容服务的差异集中在两处：`strict: true` 的 Structured Outputs 支持程度，
以及并行 tool calls 的支持程度。遇到 400 先把 `strict` 关掉试试。

---

## 全部参数

```
用法: agent [options] [question...]

选项:
  -m, --model <name>     模型名（也可用 MODEL 环境变量）   默认 gpt-4o-mini
  -s, --max-steps <n>    工具循环最大轮数                   默认 6
      --stream           流式打印最终回答
      --dry-run          强制使用离线假 client，不发任何网络请求
      --root <dir>       文件类工具的安全根目录             默认 process.cwd()
  -y, --yes              自动同意危险工具（CI 用）
      --json             把完整消息轨迹以 JSON 打到 stdout
  -h, --help             显示帮助
```

退出码：`0` 成功 / `1` 运行失败（含超过 maxSteps）/ `2` 参数错误。

问题也可以从 stdin 来：

```bash
echo "读一下 package.json 的 name" | ./node_modules/.bin/tsx examples/agent/main.ts --dry-run
```

想看完整的消息轨迹（调试 prompt 必备）：

```bash
./node_modules/.bin/tsx examples/agent/main.ts --dry-run --json "读 package.json" 2>/dev/null | head -50
```

---

## 改成你自己的 Agent

1. 在 `tools/` 下加一个文件，照 `now.ts` 的样子 `defineTool({ name, description, schema, execute })`
2. 在 `tools/index.ts` 里把它加进 `createRegistry([...])`
3. 会改变世界的工具记得加 `dangerous: true`
4. 想调整人格/约束，改 `main.ts` 里 `buildSystemPrompt` 的 `role` 和 `constraints`

**工具的 `description` 和参数 `.describe()` 就是给模型看的文档**，写得含糊模型就调错。
这是调 Agent 时投入产出比最高的地方。
