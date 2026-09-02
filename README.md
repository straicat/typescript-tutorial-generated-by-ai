# TypeScript 快速入门 —— 写给有 Java / Go 经验的后端工程师

> 目标：**3~5 天内**能用 TypeScript 写生产级命令行工具和 AI Agent。
>
> 假设你已经有 5 年左右后端经验，熟悉 Java 或 Go。因此本教程**不会**解释什么是变量、
> 什么是循环、什么是接口，而是集中回答一个问题：
> **「同一个概念，在 TS 里和你熟悉的语言有什么不一样？」**

---

## 这套教程的特点

| 你可能担心的 | 本教程怎么处理 |
| --- | --- |
| 网上教程都在讲 React / DOM | 全部示例都是 **Node.js 服务端 / CLI / Agent**，零浏览器内容 |
| 语法太多不知道哪些重要 | 每章开头有 **「与 Java/Go 的差异清单」**，先看差异再看细节 |
| 看完就忘 | 每章配 **可运行的挖空练习 + vitest 测试**，像刷题一样验证 |
| 不知道生态用什么库 | 实战章节直接上 `commander` + `zod` + `openai` + `vitest` |

---

## 快速开始

```bash
# 需要 Node.js >= 20.11（推荐 22 或 24 LTS）
node -v

# 安装依赖（pnpm 最快；npm / yarn 也行）
pnpm install

# 跑一下练习题：一开始应该是红的（因为都是 TODO）
pnpm test

# 想看参考答案跑起来是什么样：
pnpm test:solutions

# 只跑某一章
pnpm test tests/ch02
pnpm vitest tests/ch02          # watch 模式，改代码自动重跑

# 类型检查（相当于 javac / go vet）
pnpm typecheck

# 直接运行任意 .ts 文件，不需要先编译
pnpm ex docs/snippets/hello.ts
```

---

## 目录结构

```
tutorials/typescript/
├── docs/                 # 教程正文，按顺序读
├── exercises/            # 👈 你要动手填空的地方（函数体是 TODO）
├── solutions/            # 参考答案（卡住了再看）
├── tests/                # vitest 测试用例，判定你写得对不对
├── examples/             # 两个完整可运行的小项目
│   ├── cli/              #   - 一个真实的命令行工具
│   └── agent/            #   - 一个带工具调用的 AI Agent
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 学习路线

### 第一部分：语言核心（重点看差异）

| 章节 | 内容 | 与 Java/Go 差异最大的点 | 练习 |
| --- | --- | --- | --- |
| [00 · 环境与心智模型](docs/00-setup-and-mental-model.md) | Node / pnpm / tsconfig / ESM，TS 到底是什么 | 类型在运行时**完全消失** | — |
| [01 · 基础语法](docs/01-basics.md) | 变量、原始类型、控制流、函数 | `null` vs `undefined`、`===`、真假值 | 10 题 / 26 测试 |
| [02 · 类型系统](docs/02-type-system.md) | 结构化类型、联合类型、泛型、类型收窄 | **鸭子类型**、联合类型代替继承 | 12 题 / 43 测试 |
| [03 · 数据结构](docs/03-data-structures.md) | Array / Object / Map / Set / 元组 / 解构 | 没有 `List/Slice` 之分，排序默认按字符串 | 12 题 / 46 测试 |
| [04 · 函数与面向对象](docs/04-functions-and-oop.md) | 闭包、`this`、class、组合 | `this` 会丢、class 是"可选特性" | 12 题 / 44 测试 |
| [05 · 模块与工程化](docs/05-modules-and-tooling.md) | ESM、`import type`、包结构、构建发布 | ESM/CJS 双生态、导入要写 `.js` | 9 题 / 33 测试 |
| [06 · 异步编程](docs/06-async.md) | 事件循环、Promise、并发控制、取消 | **单线程**，没有 goroutine/channel | 12 题 / 40 测试 |
| [07 · 错误处理与数据校验](docs/07-errors-and-validation.md) | Error、`cause`、Result、类型守卫、zod | 异常不在签名里、编译期类型 ≠ 运行时安全 | 12 题 / 48 测试 |

### 第二部分：实战

| 章节 | 内容 | 练习 |
| --- | --- | --- |
| [08 · 命令行工具实战](docs/08-cli-with-commander.md) | commander 子命令、参数校验、stdin/管道、退出码、配置优先级、彩色输出、分发 | 12 题 / 54 测试 |
| [09 · AI Agent 实战](docs/09-ai-agent-with-openai.md) | OpenAI SDK、流式输出、Function Calling、结构化输出、tool loop、重试限流 | 12 题 / 58 测试 |
| [10 · 测试与质量保障](docs/10-testing-and-quality.md) | vitest、mock、fake timers、快照、覆盖率、ESLint、CI | 12 题 / 67 测试 |

> 合计 **115 道练习题 / 459 个测试用例**。

### 附录

- [A · Java/Go → TypeScript 速查表](docs/A-cheatsheet.md) —— 打印出来贴显示器旁边
- [B · 后端工程师最容易踩的 28 个坑](docs/B-pitfalls.md)

---

## 两个可以直接跑的完整示例

```bash
# ① CLI 工具：处理 JSON Lines 日志，4 个子命令，支持管道 / --json / 配置优先级
pnpm cli --help
pnpm cli stats examples/cli/sample.jsonl
cat examples/cli/sample.jsonl | pnpm cli filter - --where level=error

# ② AI Agent：带工具调用的完整循环
#    --dry-run 用内置的离线假模型，【不需要 API key、不发网络请求】就能看到全过程
pnpm agent --dry-run "列出当前目录并读取 package.json 的 name"

# 有 key 时走真实模型（也支持 DeepSeek / Kimi / Ollama 等兼容服务，只改 baseURL）
OPENAI_API_KEY=sk-xxx pnpm agent "帮我看看这个项目是干什么的"
```

细节见 [examples/cli/README.md](examples/cli/README.md) 和 [examples/agent/README.md](examples/agent/README.md)。

---

## 建议的学习方式

1. **读一章 → 立刻做对应练习**。不要连着读三章再做题，忘得很快。
2. 练习卡住超过 10 分钟，去看 `solutions/`，但**要看懂再抄**。
3. 测试报错先看错误信息里的类型。TS 的类型报错很长，但**从第一行开始读**通常就够了。
4. 第 08、09 章做完后，把 `examples/` 里的两个项目照着改一遍，改成你自己想要的工具。

祝学得顺利 🚀
