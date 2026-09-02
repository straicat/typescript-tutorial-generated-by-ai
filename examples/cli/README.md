# `jsonl` —— 第 08 章的配套完整示例

一个处理 [JSON Lines](https://jsonlines.org/) 日志的命令行工具，用来给
[docs/08-cli-with-commander.md](../../docs/08-cli-with-commander.md) 里讲的每一条规矩
提供一个「真的能跑」的对照物。

它刻意做得**比教程代码片段完整、比真实项目小**：只有 400 多行，但该有的东西一样不少 ——
子命令、全局选项、zod 校验、stdin 管道、配置文件优先级、彩色输出、退出码、信号处理。

---

## 跑起来

不需要构建，`tsx` 直接跑 `.ts`：

```bash
cd tutorials/typescript

pnpm cli --help                                        # 等价于 tsx examples/cli/main.ts --help
pnpm cli stats examples/cli/sample.jsonl
pnpm cli filter examples/cli/sample.jsonl -w level=error
pnpm cli head examples/cli/sample.jsonl -n 3 --pretty
pnpm cli config

# 管道：file 参数写 '-' 表示读 stdin
cat examples/cli/sample.jsonl | pnpm cli head - -n 2

# 铁律的实际收益：数据在 stdout，日志在 stderr，所以这行是安全的
pnpm cli --json stats examples/cli/sample.jsonl 2>/dev/null | jq .fields
```

> 本机 pnpm 的 store 路径特殊时用 `./node_modules/.bin/tsx examples/cli/main.ts ...` 代替 `pnpm cli`。

`sample.jsonl` 里**故意埋了脏数据**：一个空行、一行坏 JSON、一行是数组不是对象。
这样你能看到工具处理脏数据的方式（跳过 + 计数 + 警告走 stderr），而不是一崩了之。

---

## 文件职责

| 文件 | 职责 | 对应文档小节 |
| --- | --- | --- |
| `main.ts` | **只做两件事**：commander 装配 + 进程级关注点（信号、顶层 try/catch、退出码）。业务逻辑一行都没有 | §3.10 §4.2 §4.9 |
| `commands/stats.ts` | `jsonl stats <file>`：统计行数 / 字段频率 / 非法行。示范「装配 → 业务 → 纯计算」三层 | §4.11 |
| `commands/filter.ts` | `jsonl filter <file> -w k=v`：可重复选项（`collect` 收集器）、变长选项 `--fields <name...>`、`--fail-if-empty` 用非零退出码表达"没匹配到" | §3.4 §3.5 |
| `commands/head.ts` | `jsonl head <file> -n 10`：最小的子命令长什么样 | §3.6 |
| `commands/config.ts` | `jsonl config show` / `config path`：**嵌套子命令 + 默认子命令**，顺便展示四级配置优先级的结果 | §3.6 §4.4 |
| `lib/options.ts` | **本例最核心的主张**：commander 只收集字符串，zod 负责校验和转换。所有子命令的 options schema 都在这里 | §3.5 §3.8 |
| `lib/context.ts` | `AppContext`：把 reporter / colors / stdin / signal 打包成一个**注入**对象。业务函数只认它，不认 `process` | §4.11 |
| `lib/output.ts` | 唯一允许碰 stdout / stderr 的一层。`Reporter`（data/json → stdout，info/warn/error → stderr）+ `formatTable` + `humanizeBytes/Duration` | §4.1 §4.11 |
| `lib/input.ts` | `file === '-'` 或缺省时读 stdin；`splitLines` 处理 BOM / CRLF / 末尾换行；把 ENOENT / EISDIR / EACCES 翻译成人话 | §4.3 |
| `lib/config.ts` | 从 cwd 向上找 `.jsonlrc.json`、回落到 `~/.config/jsonl/config.json`、`mergeLayers` 四级合并 | §4.4 §4.5 |
| `lib/colors.ts` | 手写 20 行 ANSI 上色；重点是 `shouldUseColor`（`--no-color` > `NO_COLOR` > `FORCE_COLOR` > `isTTY`） | §4.6 |
| `lib/errors.ts` | `UsageError` / `ToolError` / `CancelledError` + `exitCodeFor` 退出码映射 | §4.2 |
| `lib/jsonl.ts` | **纯逻辑层**：没有 I/O、没有 console、没有 process。解析 / 统计 / 点路径过滤全在这里 | §4.11 |
| `sample.jsonl` | 13 行示例数据，含 3 行脏数据 | — |

---

## 四条真实命令与真实输出

### 1. `stats`：人类可读的表格（数据 stdout，警告 stderr）

```console
$ pnpm cli stats examples/cli/sample.jsonl
概览
总行数(非空)  13
合法记录      11
非法行        2
字段数        10

字段频率 (top 10/10)
field       count  ratio  types
----------  -----  -----  ------
level       11     100%   string
msg         11     100%   string
svc         11     100%   string
ts          11     100%   string
durationMs  7      64%    number
http        7      64%    object
tags        4      36%    array
jobId       3      27%    string
retries     2      18%    number
queueDepth  1      9%     number
```

上面那一段是 stdout。**同时**还有一行去了 stderr（所以它不会污染 `| jq`）：

```console
[warn] 有 2 行无法解析
```

### 2. `--json`：同一个命令的机器可读形态

```console
$ pnpm cli --json stats examples/cli/sample.jsonl 2>/dev/null
{"total":13,"valid":11,"invalid":2,"fields":[{"field":"level","count":11,"types":["string"]},{"field":"msg","count":11,"types":["string"]},{"field":"svc","count":11,"types":["string"]},{"field":"ts","count":11,"types":["string"]},{"field":"durationMs","count":7,"types":["number"]},{"field":"http","count":7,"types":["object"]},{"field":"tags","count":4,"types":["array"]},{"field":"jobId","count":3,"types":["string"]},{"field":"retries","count":2,"types":["number"]},{"field":"queueDepth","count":1,"types":["number"]}]}
```

注意 `--json` 是**全局选项**，写在子命令前面或后面都认（`optsWithGlobals()` 的功劳）。

### 3. `filter`：输出仍然是 JSONL，所以能继续管道

```console
$ pnpm cli filter examples/cli/sample.jsonl -w level=error --fields ts msg 2>/dev/null
{"ts":"2024-05-01T09:00:11Z","msg":"upstream timeout"}
{"ts":"2024-05-01T09:00:15Z","msg":"job failed"}
{"ts":"2024-05-01T09:00:25Z","msg":"validation failed"}

$ pnpm cli grep examples/cli/sample.jsonl -w 'http.status!=200' -n 2 2>/dev/null
{"ts":"2024-05-01T09:00:11Z","level":"error","svc":"api","msg":"upstream timeout","http":{"status":504,"path":"/orders"},"durationMs":3000,"tags":["upstream"]}
{"ts":"2024-05-01T09:00:12Z","level":"info","svc":"worker","msg":"job picked","jobId":"j-1001"}
```

`grep` 是 `filter` 的 `.alias()`；`http.status!=200` 走点路径 + 取反；第 2 条是「字段缺失也算 `!=` 成立」。

### 4. 管道 + `-v`：诊断信息全在 stderr

```console
$ cat examples/cli/sample.jsonl | pnpm cli -v head - -n 1
L1 {"ts":"2024-05-01T09:00:00Z","level":"info","svc":"api","msg":"server started","http":{"status":200,"path":"/healthz"},"durationMs":3}
```

stderr 上同时有：

```console
[info] jsonl v1.0.0 · jsonl head
[info] 预览 1/11 条
[warn] 跳过 2 行非法数据
```

---

## 退出码实测

退出码是 CLI 对外的 API。这几条都是实跑出来的：

| 命令 | 退出码 | 为什么 |
| --- | --- | --- |
| `jsonl stats sample.jsonl` | `0` | 成功 |
| `jsonl --help` / `jsonl -V` | `0` | 帮助和版本**不是错误**（commander 抛的 `CommanderError.exitCode` 就是 0） |
| `jsonl nope` | `1` | commander 的 `unknown command`，用它自己的默认退出码 |
| `jsonl stats nope.jsonl` | `2` | `UsageError`：文件不存在算用户的错 |
| `jsonl filter sample.jsonl`（漏了 `-w`） | `2` | `UsageError`：zod 校验 `where` 至少一项 |
| `jsonl head sample.jsonl -n abc` | `2` | `UsageError`：zod 把 `'abc'` coerce 成 NaN 后拒绝 |
| `jsonl filter sample.jsonl -w level=nope --fail-if-empty` | `1` | `ToolError('没有匹配的记录', 1)`，像 `grep` 那样 |
| Ctrl-C | `130` | `128 + SIGINT(2)`，shell 的约定 |

对应的 stderr（截取）：

```console
$ pnpm cli filter examples/cli/sample.jsonl; echo $?
[error] filter 选项非法:
✖ 至少需要一个 --where 条件，例如 --where level=error
  → at where
2

$ pnpm cli head examples/cli/sample.jsonl -n abc; echo $?
[error] head 选项非法:
✖ Invalid input: expected number, received NaN
  → at lines
2
```

这两段就是 `lib/options.ts` 里 `z.prettifyError()` 的输出 —— 校验规则写一遍，报错格式全工具统一。

---

## 想改成你自己的工具？

1. 把 `lib/jsonl.ts` 换成你的业务纯函数（这一层不许出现 `process` / `console` / `fs`）。
2. 复制 `commands/head.ts` 当模板加子命令：`.argument()` + `.option()` + 一个 schema + 一个 `run*` 函数。
3. 在 `lib/options.ts` 加对应的 schema；在 `main.ts` 的数组里加一行 `makeXxxCommand(holder)`。
4. `main.ts` 里除了那个数组，其它都不用动。

三层分离的收益就在第 4 步：**加功能不用碰进程层**，而且每一层都能单独测
（本章练习 `tests/ch08-cli.test.ts` 就是在不启动任何子进程的前提下测完了这套东西）。
