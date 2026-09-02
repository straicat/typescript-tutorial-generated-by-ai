# 08 · 命令行工具实战：用 commander 写一个像样的 CLI

> 本章目标：把一个「能跑的脚本」变成一个**能交给别人用、能被 shell 脚本调用、能被 CI 依赖**的工具。
>
> 语言部分到第 07 章就结束了。从这章开始，重点从「TS 怎么写」变成「Node 上的 CLI 工程规范是什么」——
> 这部分和 Java/Go 差异不在语法，而在**约定**：退出码、stdout/stderr 分工、配置优先级、分发方式。
>
> 配套的完整示例在 [`examples/cli/`](../examples/cli/README.md)，本章的每个代码片段都能在那里找到对应的真实实现。
> 本章的 commander API **全部在 `commander@15.0.0` 上实测过**（v15 是 2025 年的版本，网上很多写法已经过时）。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript (Node) | 危险等级 |
| --- | --- | --- | --- |
| 入口签名 | `main(String[] args)` / `os.Args` | **没有 main**，模块顶层就是入口；参数在 `process.argv` | 🟡 中 |
| argv 内容 | Java：`args[0]` 是**第一个真实参数** | `argv[0]` 是 node 路径，`argv[1]` 是脚本路径，真实参数从 `[2]` 开始 | 🔴 高 |
| 参数解析库 | picocli / JCommander（注解驱动） | **commander**（链式 API 驱动） | 🟡 中 |
| 参数类型 | 注解上写 `int port`，框架帮你转 | commander 给的**全是 string**，转换/校验交给 zod | 🔴 高 |
| 参数校验失败 | 框架抛异常 + 打 usage | 你得自己决定：抛什么、退出码是几 | 🟡 中 |
| 退出 | `System.exit(1)` / `os.Exit(1)` | **`process.exitCode = 1`**（`process.exit()` 会截断输出） | 🔴 高 |
| 分发 | 打成 jar（要装 JVM）/ 静态二进制（拷了就跑） | **npm 包 + `npx tool`**（要装 Node，但不用 install） | 🟡 中 |
| 标准输出 | `System.out` / `fmt.Println` | `console.log` → stdout，`console.error` → stderr | 🔴 高 |
| 读 stdin | `Scanner(System.in)` 阻塞读 | **异步流**，`node:readline` 按行 `for await` | 🟡 中 |
| 调外部命令 | `ProcessBuilder` / `exec.Command` | `node:child_process` 的 `execFile` / `spawn`（**别用 `exec`**） | 🔴 高 |
| 信号处理 | `addShutdownHook` / `signal.Notify` | `process.on('SIGINT')` + `AbortController` | 🟡 中 |
| 打包成单文件 | `shade` 插件 / `go build` 天生 | 需要 `esbuild --bundle` 或 Node 的 SEA | 🟢 低 |
| 彩色输出 | Jansi / fatih/color | 手写 ANSI 或 `picocolors`；Node 22+ 有内置 `styleText` | 🟢 低 |

---

## 1. `process.argv`：先看清最原始的样子

```ts
// 文件：cli.ts，运行：node cli.ts stats a.jsonl --top 3
console.log(process.argv);
// [
//   '/usr/local/bin/node',        ← [0] node 可执行文件的绝对路径
//   '/home/me/proj/cli.ts',       ← [1] 正在跑的脚本的绝对路径
//   'stats', 'a.jsonl', '--top', '3'   ← [2..] 真实参数
// ]

const args = process.argv.slice(2);   // ✅ 这才等价于 Java 的 args / Go 的 os.Args[1:]
```

> ⚠️ Java 的 `args[0]` 是第一个参数，Go 的 `os.Args[0]` 是程序名。
> Node 是**两个都占**：`[0]` 是 node，`[1]` 是脚本。少切一个就会把脚本路径当成子命令名。

`process.argv` 里的元素**全是字符串，而且已经被 shell 处理过了**：引号、`*` 通配、`$VAR`
都是 shell 展开完才交给你的。Node 侧看到的就是最终结果。

### 手写解析器：能，但只适合 3 个参数以内

本章练习 8.7 会让你手写一遍 `--key=value` / `--key value` / `-abc` / `--` 的解析，
目的是让你亲手撞上那个**根本性的问题**：

```ts
parseArgvBasic(['--verbose', 'file.txt']);
// { options: { verbose: 'file.txt' }, positionals: [] }   😱
```

`--verbose` 明明是布尔开关，但解析器**不知道**，只能把后面那个 token 吃掉。
**没有事先声明的选项类型表，argv 就是有歧义的。** 这就是所有参数解析库存在的理由。

### `node:util` 的 `parseArgs`：够用的场景

Node 内置了一个轻量解析器（Node 18.3+，20 起稳定），**零依赖**：

```ts
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),                    // ⚠️ 要自己 slice(2)
  options: {
    port: { type: 'string' },                     // 只有 'string' 和 'boolean' 两种
    verbose: { type: 'boolean', short: 'v' },
    where: { type: 'string', short: 'w', multiple: true },   // 可重复 → string[]
  },
  allowPositionals: true,
});
// $ tool --port 8080 -v -w a=1 -w b=2 file.txt
// values      = { port: '8080', verbose: true, where: ['a=1', 'b=2'] }
// positionals = ['file.txt']

// 未知选项会抛 TypeError，code 是 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
```

| `parseArgs` 够用 | 该上 commander |
| --- | --- |
| 单命令、5 个以内选项 | **有子命令**（`tool stats` / `tool filter`） |
| 内部脚本，帮助文本自己手写 | 要自动生成 `--help` |
| 一个依赖都不想加 | 要 `--version`、选项默认值、可选值、`--no-xxx`、别名 |
| 不在乎报错文案 | 要「你是不是想输 `--first`?」这种拼写建议 |

> `parseArgs` **没有**帮助文本生成、没有子命令、没有默认值、`type` 只有 string/boolean。
> 一旦要写 `--help`，你手写的那段会比 commander 还长。**本章及示例项目一律用 commander。**

---

## 2. 一个最小可运行的 commander CLI

```ts
#!/usr/bin/env node
// ↑ 第一行必须是这个 shebang，`./cli.js` 才能直接执行（≈ 给 jar 配个 .sh 包装）

import { Command } from 'commander';

const program = new Command('greet');

program
  .description('打招呼')
  .version('1.0.0')                       // 自动注册 -V / --version
  .argument('<name>', '要打招呼的人')       // 必填位置参数
  .option('-t, --times <n>', '重复次数', '1')
  .action((name: string, options: { times: string }) => {
    for (let i = 0; i < Number(options.times); i += 1) console.log(`Hello, ${name}!`);
  });

program.parse();                          // 无参数 = 解析 process.argv
```

`package.json` 里声明入口，这样 `npm i -g` / `npx` 才知道要跑哪个文件：

```json
{
  "name": "@me/greet",
  "version": "1.0.0",
  "type": "module",
  "bin": { "greet": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=20.11.0" }
}
```

> 三个容易漏的点：① **`bin` 指向的是编译产物**（`dist/cli.js`），不是 `.ts`；
> ② 那个文件里必须有 shebang（构建工具默认会保留第一行注释，esbuild 用 `--banner:js='#!/usr/bin/env node'`）；
> ③ 类 Unix 系统上文件要有执行权限，`npm publish` 会保留 mode，本地开发记得 `chmod +x`。

---

## 3. commander@15 完整教学

### 3.1 位置参数 `.argument()`

```ts
program
  .argument('<input>', '必填参数')                      // <> = required
  .argument('[output]', '可选参数', 'out.txt')          // [] = optional，第三个参数是默认值
  .argument('<files...>', '变长参数，只能放最后一个')     // ... = variadic，拿到 string[]
  .action((input: string, output: string, files: string[]) => { /* ... */ });
```

实测（`argument('<a>')` + `argument('[b]', '', 'DEFAULT')` + `argument('<rest...>')`，输入 `x y z1 z2`）：

```
a = 'x'   b = 'y'   rest = ['z1', 'z2']
command.processedArgs = ['x', 'y', ['z1', 'z2']]
```

漏了必填参数：`error: missing required argument 'a'`，退出码 1。

### 3.2 选项 `.option()`：五种形态

```ts
program
  .option('-d, --debug', '布尔开关')                     // 不传 = undefined，传了 = true
  .option('-p, --port <number>', '必须带值', '8080')      // <> 必须带值；第三参数是默认值
  .option('-c, --cheese [type]', '值可选')                // [] 可选：不传=undefined，只写 -c=true，-c blue='blue'
  .option('-f, --fields <name...>', '变长，拿到 string[]')
  .option('--no-color', '取反选项')                       // 见下
  .requiredOption('-k, --key <key>', '必须传，否则报错');
```

**`--no-xxx` 取反选项**是 commander 特有的糖，实测：

```ts
new Command('t').option('--no-color', '禁用颜色');
// 不传任何参数    -> opts() = { color: true }     ← 😱 注意：单独定义 --no-xxx 会让它【默认为 true】
// 传 --no-color   -> opts() = { color: false }
// 传 --color      -> error: unknown option '--color'   ← 没定义正向选项就不认
```

> 键名是 `color` 而不是 `noColor`。想同时支持 `--color` 和 `--no-color`，两个都写。

**短选项可以合并**，实测 `-abc -p80` → `{ a: true, b: true, c: true, port: '80' }`；
`--` 之后的东西一律进 `program.args`（`['x', '--not-an-option']`）。

`.requiredOption()` 漏传时：`error: required option '-c, --cheese <t>' not specified`，退出码 1。

用 `new Option()` 能拿到 `.option()` 覆盖不到的能力：

```ts
import { Option } from 'commander';

program
  .addOption(new Option('-d, --drink <size>').choices(['small', 'large']))
  .addOption(new Option('--api-key <k>').env('MY_API_KEY'))     // 回落到环境变量
  .addOption(new Option('-s, --secret').hideHelp())
  .addOption(new Option('--donate [amount]').preset('20'))       // 只写 --donate 时的值
  .addOption(new Option('--disable-server').conflicts('port'))   // 互斥
  .addOption(new Option('--free-drink').implies({ drink: 'small' }));
```

实测细节：`.env()` 生效后 `command.getOptionValueSource('apiKey') === 'env'`
（可选值还有 `'default' | 'config' | 'cli' | 'implied'`）——**这个 API 是判断「用户到底有没有显式传」的正解**。
`.choices()` 报错文案：`error: option '-d, --drink <size>' argument 'xl' is invalid. Allowed choices are s, l.`

### 3.3 自定义解析函数

签名固定是 `(value: string, previous: T) => T`：

```ts
import { InvalidArgumentError } from 'commander';

const myInt = (v: string): number => {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError('不是数字');   // ✅ 专用错误类，会被包成友好提示
  return n;
};
const collect = (v: string, prev: string[]): string[] => [...prev, v];   // 可重复选项

program
  .option('-p, --port <n>', 'port', myInt, 8080)          // 第 4 个参数是【起始值】
  .option('-w, --where <expr>', '可重复', collect, []);
// -p 3000 -w a=1 -w b=2  ->  { port: 3000, where: ['a=1', 'b=2'] }
// -p abc                 ->  error: option '-p, --port <n>' argument 'abc' is invalid. 不是数字   (退出码 1)
```

### 3.4 ⭐ 但更推荐：commander 只收集字符串，zod 负责校验和转换

自定义解析函数的三个问题：① 校验逻辑散落在十几个 `.option()` 调用里，没法复用也没法单测；
② 一次只能报一个错（用户要修 3 个参数就得跑 4 次）；③ `.opts()` 的返回类型是
`Record<string, any>`，**你以为 `opts.port` 是 number，其实编译器根本不管你**。

所以本章的主张（也是 `examples/cli/lib/options.ts` 的做法）：

```ts
// lib/options.ts —— 校验规则集中在一处，可复用、可单测
import { z } from 'zod';
import { UsageError } from './errors.js';

const positiveInt = z.coerce.number().int().positive();   // 字符串 -> 正整数

export const statsOptionsSchema = z.object({
  top: positiveInt.max(1000).default(10),
  showBad: z.boolean().default(false),        // commander 的 --show-bad 变成 showBad
});
export type StatsOptions = z.infer<typeof statsOptionsSchema>;   // ✅ 类型从 schema 推出来

/** 统一入口：失败抛 UsageError（→ 退出码 2），错误文案统一。 */
export function validateOptions<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(raw);      // safeParse 而不是 parse：要自己控制错误类型和退出码
  if (!result.success) {
    throw new UsageError(`${label} 选项非法:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

```ts
// commands/stats.ts —— 装配层只声明「有哪些选项」，一个校验都不写
new Command('stats')
  .argument('<file>', 'JSONL 文件路径，用 - 表示读 stdin')
  .option('-t, --top <n>', '只展示出现最多的 n 个字段', '10')   // 默认值是字符串 '10'
  .option('--show-bad', '把非法行的内容也打出来')
  .action(async (file: string, raw: unknown) => {              // ← 刻意标成 unknown！
    const options = validateOptions(statsOptionsSchema, raw, 'stats');
    // ✅ 从这一行往后 options 是 { top: number; showBad: boolean }，真正的强类型
    await runStats(file, options, requireContext(holder));
  });
```

把 action 的第二个参数标成 `unknown` 而不是 `any`，编译器就会**强迫你先过一遍 zod** 才能用它。
这是本章最值钱的一行代码。实测的报错长这样（退出码 2）：

```console
$ jsonl head sample.jsonl -n abc
[error] head 选项非法:
✖ Invalid input: expected number, received NaN
  → at lines
```

| commander 自带 `argParser` | commander + zod |
| --- | --- |
| 校验散在各处，不能单测 | schema 是普通对象，直接 `schema.parse(...)` 测 |
| 一次报一个错 | 一次报出**全部**问题 |
| `.opts()` 是 `any` | `z.infer` 出来的强类型 |
| 退出码固定 1 | 你自己映射（本章约定用 2） |
| 环境变量/配置文件要另写一套 | **同一个 schema** 复用（§4.4） |

### 3.5 子命令：`.command()` vs `.addCommand()`

```ts
// 写法 A：.command() 直接在父命令上创建并返回【子命令】，适合小命令
program
  .command('clone')
  .description('克隆仓库')
  .argument('<source>')
  .action((source: string) => { /* ... */ });

// 写法 B：.addCommand() 加一个已经装配好的命令，返回【父命令】。
//         大项目一定用这个：每个子命令一个文件，main.ts 只负责组装。
program.addCommand(makeStatsCommand(holder));

program.command('filter').alias('grep');            // 别名，help 里只显示第一个
program.addCommand(showCmd, { isDefault: true });   // 默认子命令：不写子命令名时跑它
program.addCommand(devCmd, { hidden: true });       // 不出现在 help 里
```

**嵌套子命令**（`jsonl config show`）就是把 `.command()` 套两层，见 `examples/cli/commands/config.ts`：

```ts
const config = new Command('config').description('查看配置来源与最终生效值');
config.command('path').action(async () => { /* jsonl config path */ });
const show = new Command('show').action(async () => { /* jsonl config show */ });
config.addCommand(show, { isDefault: true });       // `jsonl config` == `jsonl config show`
```

实测（`jsonl config` 走了默认子命令 `show`，`jsonl config path` 走了 `path`）：

```console
$ pnpm cli config
key      value
-------  -----
json     false
color    true
verbose  false
top      10

$ pnpm cli config path
项目配置: (未找到 .jsonlrc.json)
用户配置: /home/jack/.config/jsonl/config.json
```

> 🔴 **实测确认的坑，本章最容易踩的一个**：`.command()` 创建的子命令会自动
> `copyInheritedSettings(父命令)`，于是继承 `exitOverride` / `configureOutput` / `showHelpAfterError`；
> 但 **`.addCommand(cmd)` 加进来的不会**。后果是子命令报错时绕过你的 `exitOverride`
> 直接 `process.exit()` —— 在测试里表现为**测试进程凭空消失，连报错都看不到**。
> 补救就一行（`examples/cli/main.ts` 里的 `inheritSettings`）：
>
> ```ts
> function inheritSettings(parent: Command, cmd: Command): void {
>   cmd.copyInheritedSettings(parent);
>   for (const child of cmd.commands) inheritSettings(cmd, child);   // 递归，孙命令也要
> }
> ```

### 3.6 `.action()` 与 `.parseAsync()`

action 的参数顺序是：**每个 `.argument()` 一个参数，然后 options，然后 command 本身**。

```ts
.action((file: string, options: unknown, command: Command) => { /* ... */ })
```

**只要有一个 async action，就必须用 `.parseAsync()`。** 实测差别：

```ts
const order: string[] = [];
const mk = () => new Command('t').action(async () => { await sleep(10); order.push('action done'); });

mk().parse([], { from: 'user' });        order.push('parse returned');
await mk().parseAsync([], { from: 'user' }); order.push('parseAsync returned');
// order = ['parse returned', 'action done', 'action done', 'parseAsync returned']
//           ↑ parse 装配完就返回了，异步逻辑还在后台跑
```

用 `parse` 配 async action 的后果：`main()` 以为跑完了，进程在事件循环空掉的瞬间退出，
**输出被截断、文件没写完、退出码是 0（假装成功）**。这是 Node CLI 最隐蔽的 bug 之一。

```ts
await program.parseAsync(process.argv);        // ✅ 有 async action 时唯一正确的写法
program.parse(['--port', '80'], { from: 'user' });   // 测试里用：argv 只含真实参数
```

`parse` 的第二个参数 `{ from }` 有三个值：`'node'`（默认，argv[0]/argv[1] 是 node 和脚本）、
`'electron'`、**`'user'`（只有真实参数）**。写测试时永远用 `'user'`。

### 3.7 全局选项与 `.optsWithGlobals()`

commander 默认是「非位置模式」：全局选项写在子命令**前面或后面都认**。

```ts
program.option('--json').option('-v, --verbose');
// 下面两行等价：
//   jsonl --json stats a.jsonl
//   jsonl stats a.jsonl --json
```

但**子命令的 `.opts()` 只包含它自己的选项**，要读父命令的选项必须用 `.optsWithGlobals()`：

```ts
// 实测：program.option('--json'); sub.option('-t, --top <n>', '', '10')
// 输入 --json sub -t 3
sub.opts();            // { top: '3' }               ← 没有 json！
sub.optsWithGlobals(); // { top: '3', json: true }   ✅
```

需要「全局选项只能写在子命令前面」（好让子命令复用同名选项）时开 `.enablePositionalOptions()`。

### 3.8 `.hook('preAction')`：全局初始化

```ts
program.hook('preAction', (thisCommand, actionCommand) => {
  // 所有子命令的 action 之前跑一次。典型用途：初始化 logger / 读配置 / 连数据库 / 建 span
  const globals = validateOptions(globalOptionsSchema, actionCommand.optsWithGlobals(), 'global');
  const colors = createColors(shouldUseColor({ color: globals.color, isTTY: process.stdout.isTTY === true, env: process.env }));
  holder.current = { globals, colors, reporter: createReporter({ /* ... */ }), /* ... */ };
});
```

三个 hook：`preAction` / `postAction`（本命令及其嵌套子命令的 action 前后）、
`preSubcommand`（解析直接子命令之前）。**hook 可以是 async**，那就必须配 `parseAsync()`。

> 为什么 `examples/cli` 要搞一个 `ContextHolder { current: AppContext | null }`？
> 因为**装配是同步发生的，而「最终的全局选项」只有 hook 跑完才知道**。
> 装配阶段先把空 holder 传给每个子命令，运行阶段 hook 往里填 —— 这样业务函数收到的是
> 一个纯粹的注入对象，测试里塞个假的进去就行。

### 3.9 help 定制

```ts
program
  .showHelpAfterError('(用 --help 查看用法)')   // 出错时追加一句；不给字符串就打完整 help
  .showSuggestionAfterError()                  // 默认就开：'(Did you mean --first?)'
  .addHelpText('after', `
示例:
  $ jsonl stats sample.jsonl --top 3
  $ cat a.jsonl | jsonl filter - -w level=error | jq -r .msg`)
  .configureHelp({ sortSubcommands: true, showGlobalOptions: true });
```

`addHelpText` 的位置有四个：`beforeAll` / `before` / `after` / `afterAll`
（带 `All` 的会作用于**所有子命令**，适合放全局 banner / footer）。实测 `showHelpAfterError` 的效果：

```console
$ tool --fits
error: unknown option '--fits'
(Did you mean --first?)
(用 --help 查看用法)
```

> **给每个子命令都写 `addHelpText('after', 示例)`。** 用户看 help 是为了抄命令，不是为了读选项表。
> `examples/cli` 的四个子命令每个都带 3~4 条可直接复制的示例。

### 3.10 🔴 `.exitOverride()`：测试 CLI 的关键

**默认情况下 commander 出错会直接 `process.exit()`，输出直接怼到 `process.stdout`。**
这两件事让 CLI 完全没法单测。解药是两个 API：

```ts
program
  .exitOverride()                              // 抛 CommanderError 而不是 process.exit()
  .configureOutput({                           // 把输出接到你自己的收集函数上
    writeOut: (s) => outChunks.push(s),
    writeErr: (s) => errChunks.push(s),
    getOutHasColors: () => false,              // 固定颜色和宽度，否则本机和 CI 的 help 文本不一样
    getErrHasColors: () => false,
    getOutHelpWidth: () => 80,
    getErrHelpWidth: () => 80,
  });
```

`CommanderError` 有三个属性：`exitCode: number`、`code: string`、`message: string`。
实测各种情况的取值：

| 输入 | `err.code` | `err.exitCode` | 输出去哪 |
| --- | --- | --- | --- |
| `--help` | `commander.helpDisplayed` | **0** | stdout |
| `--version` | `commander.version` | **0** | stdout |
| `--nope` | `commander.unknownOption` | 1 | stderr |
| `--port`（缺值） | `commander.optionMissingArgument` | 1 | stderr |
| 漏了必填参数 | `commander.missingArgument` | 1 | stderr |

> 🔴 **`--help` 和 `--version` 也是通过抛异常出来的，但它们的 `exitCode` 是 0 —— 不是错误。**
> 顶层 catch 里千万别写 `process.exitCode = 1`，否则 `tool --help` 返回 1，调用方的脚本直接挂。
> 也别写 `err.exitCode || 1`：0 是假值，会被 `||` 吃掉（第 01 章）。

于是「在内存里跑一个 CLI」的测试夹具就写出来了（这是本章练习 8.11，写完之后你测任何 CLI 都用它）：

```ts
export function runCommand(command: Command, argv: readonly string[]): CommandRunResult {
  const out: string[] = [];
  const err: string[] = [];
  applyTestIo(command, { writeOut: (s) => void out.push(s), writeErr: (s) => void err.push(s), /* ... */ });
  //          ↑ 必须【递归】装到所有子命令上，见 §3.5 的坑

  let error: Error | null = null;
  try {
    command.parse(argv, { from: 'user' });      // from: 'user' —— argv 里没有 node/脚本路径
  } catch (thrown) {
    error = thrown instanceof Error ? thrown : new Error(String(thrown));   // JS 能 throw 任何值
  }
  return { stdout: out.join(''), stderr: err.join(''), exitCode: exitCodeFor(error), error };
}
```

```ts
// 用起来就是普通的纯函数测试：不起子进程、不碰真实 stdout、跑完 30ms
expect(runCommand(buildGreetCommand(), ['Alice'])).toEqual({
  stdout: 'Hello, Alice!\n', stderr: '', exitCode: 0, error: null,
});
expect(runCommand(buildGreetCommand(), ['--help']).exitCode).toBe(0);        // help 不是错误
expect(runCommand(buildGreetCommand(), []).stderr).toContain("missing required argument 'name'");
expect(runCommand(buildGreetCommand(), ['Alice', '-t', 'abc']).exitCode).toBe(2);   // 我们的 UsageError
```

`program.error(msg, { exitCode, code })` 可以复用 commander 的错误通道，实测
`this.error('自定义失败', { exitCode: 2, code: 'my.fail' })` 会写 `自定义失败\n` 到 stderr
并抛 `CommanderError(exitCode=2, code='my.fail')`。不过本章更推荐**抛自己的 `UsageError`**，
理由见 §4.2：退出码映射应该只有一处。

---

## 4. CLI 工程规范

语法讲完了。下面这些才是「像样的 CLI」和「能跑的脚本」真正的差别。

### 4.1 🔴 铁律：stdout 放数据，stderr 放日志

```ts
console.log('结果');       // → stdout：程序的【产物】
console.error('[info] 读取 3 个文件');   // → stderr：日志、进度、警告、错误
console.warn('...');       // → stderr
```

为什么是铁律：用户随时可能写 `mytool data.jsonl | jq .` 或 `mytool > out.json`。
任何一行日志跑进 stdout，管道下游就炸了。**进度条、spinner、"正在处理…"、警告，全部走 stderr。**

实践上把它收成一个 `Reporter`，**全工具只有这一层允许碰 stdout/stderr**（`examples/cli/lib/output.ts`）：

```ts
export interface Reporter {
  data(line: string): void;      // → stdout
  json(value: unknown): void;    // → stdout，单行 JSON（方便 jq / 再次管道）
  info(message: string): void;   // → stderr，只在 --verbose 时输出
  warn(message: string): void;   // → stderr
  error(message: string): void;  // → stderr
}

export function createReporter({ stdout, stderr, verbose, colors }: ReporterOptions): Reporter {
  return {
    data: (line) => void stdout.write(`${line}\n`),
    json: (value) => void stdout.write(`${JSON.stringify(value)}\n`),
    info: (m) => { if (verbose) stderr.write(`${colors.gray(`[info] ${m}`)}\n`); },
    warn: (m) => void stderr.write(`${colors.yellow(`[warn] ${m}`)}\n`),
    error: (m) => void stderr.write(`${colors.red(`[error] ${m}`)}\n`),
  };
}
```

注意 `stdout` / `stderr` 是**注入的 `Writable`**（不是 `process.stdout`）：测试里传两个内存
buffer 就能断言全部输出，这是 §4.12 分层的基础。

**`--json`：给机器看的那一份。** 规矩是：
① 字段名稳定（改名算 breaking change）；② 一整个对象一行（JSONL，便于流式消费）；
③ **`--json` 打开时 stdout 里不许有任何非 JSON 的字符**。实测：

```console
$ jsonl --json stats sample.jsonl 2>/dev/null | jq .invalid
2
```

### 4.2 退出码：CLI 对外的 API

脚本会写 `if ! mytool ...; then` 来判断成败，所以退出码和函数返回值一样重要。本章约定：

| 码 | 含义 | 来源 |
| --- | --- | --- |
| `0` | 成功（**包括 `--help` / `--version`**） | 正常结束 |
| `1` | 一般运行时错误 | 未预期的异常、上游挂了 |
| `2` | **用法错误**：参数不对、文件不存在、配置非法 | `UsageError` |
| `130` | 被 Ctrl-C 中断（`128 + SIGINT(2)`） | 信号处理 |

> 还有一套更细的约定叫 `sysexits.h`（`64` EX_USAGE、`78` EX_CONFIG，第 07 章用的是这套）。
> **随便选一套，写进 `--help`，别混用。** `examples/cli` 的 help 底部就印着这张表。

映射写在**一个函数**里，永远别在业务代码里散落 `process.exit(2)`：

```ts
export function exitCodeFor(error: unknown): number {
  if (error == null) return 0;
  if (error instanceof UsageError) return 2;
  if (error instanceof Error && error.name === 'AbortError') return 130;   // Node abort 的 name
  if (typeof error === 'object') {
    const code = (error as { exitCode?: unknown }).exitCode;
    // 三重校验：CommanderError 和自己的 ToolError 都靠这条命中。
    // ⚠️ 退出码只有低 8 位有效，process.exit(300) 实际是 44，越界就别信。
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255) return code;
  }
  return 1;
}
```

**`process.exitCode` vs `process.exit()`：**

```ts
process.exitCode = 2;    // ✅ 只是【记下】退出码，等事件循环自然跑空才退出 —— 输出保证写完
process.exit(2);         // ⚠️ 立即退出。stdout 是管道时是异步写的，还在缓冲区里的内容会【丢】
```

> 这个坑非常隐蔽：`console.log` 大量数据后立刻 `process.exit(0)`，
> 在终端里（同步写）一切正常，一旦 `| head` 或重定向到文件（异步写）就少一截。
> **规则：只在信号处理器里用 `process.exit()`（那时就是要强行终止），其它地方一律 `process.exitCode = n`。**

于是 `main()` 的统一出口长这样（`examples/cli/main.ts`）：

```ts
async function main(): Promise<void> {
  installSignalHandlers();
  const holder: ContextHolder = { current: null };
  const program = buildProgram(holder);
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      process.exitCode = err.exitCode;   // --help/--version 是 0，不是错误
      return;
    }
    const reporter = holder.current?.reporter;
    const message = describeError(err);
    if (reporter != null) reporter.error(message);
    else process.stderr.write(`[error] ${message}\n`);   // hook 还没跑就出错了，兜底
    if (holder.current?.globals.verbose === true && err instanceof Error) {
      process.stderr.write(`${err.stack ?? ''}\n`);      // 堆栈只在 --verbose 时打
    }
    process.exitCode = exitCodeFor(err);
  }
}
await main();       // ESM 顶层 await；不需要 `if (require.main === module)` 那套 CJS 判断
```

### 4.3 读 stdin：支持管道

Unix 工具的通用约定：**文件参数写 `-` 表示读 stdin**。`examples/cli/lib/input.ts`：

```ts
import { createInterface } from 'node:readline';

/** 按行流式读取一个可读流（readline 自带 \r\n 处理，不会把大文件全读进内存）。 */
export async function readLinesFromStream(stream: Readable): Promise<string[]> {
  const out: string[] = [];
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) out.push(line);
  return out;
}

export async function readInputLines({ file, stdin, stdinIsTTY, signal }: InputSource): Promise<string[]> {
  if (file == null || file === '-') {
    if (stdinIsTTY) {
      // 🔴 关键的用户体验：交互式终端里 `tool stats` 会挂住等输入，用户以为程序卡死了。
      throw new UsageError('没有指定文件，且 stdin 是终端。请给出文件名，或用管道传入数据。');
    }
    return readLinesFromStream(stdin);
  }

  try {
    const text = await readFile(file, { encoding: 'utf8', signal });   // signal 支持 Ctrl-C 取消
    return splitLines(text);
  } catch (err) {
    // errno 翻译成人话。用户不想看 "ENOENT: no such file or directory, open 'x'"
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') throw new UsageError(`文件不存在: ${file}`);
    if (code === 'EISDIR') throw new UsageError(`这是一个目录，不是文件: ${file}`);
    if (code === 'EACCES') throw new UsageError(`没有读权限: ${file}`);
    if (err instanceof Error && err.name === 'AbortError') throw err;   // 取消不是"读取失败"
    throw new ToolError(`读取失败 ${file}: ${(err as Error).message}`);
  }
}
```

- **`process.stdin.isTTY`**：`true` = 用户在终端里敲，没有管道输入。判断的是 **stdin**；
  判断「要不要上色」用的是 **stdout**（`process.stdout.isTTY`）—— 两个别搞混。
- 把 `stdin` / `stdinIsTTY` 作为参数注入，测试里传 `Readable.from(['a', 'b'])` 就行。

自己切行时四个细节一个都不能少（本章练习 8.1）：

```ts
export function splitLines(text: string): string[] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;   // ① BOM：Windows 记事本的礼物
  if (body === '') return [];                                      // ② ''.split('\n') 是 [''] 不是 []
  const lines = body.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));  // ③ CRLF
  if (lines[lines.length - 1] === '') lines.pop();                 // ④ 只丢【末尾换行造成的】那一个空行
  return lines;   // 😱 别 filter 掉所有空行：行号就和原文件对不上了
}
```

### 4.4 配置优先级：命令行 > 环境变量 > 配置文件 > 默认值

```ts
const merged = mergeLayers(defaults, fileLayer, envLayer, cliLayer);   // 低 → 高
const config = configSchema.parse(merged);                             // 合并完【一次】校验
```

**🔴 合并的关键：值为 `undefined` 的字段不允许覆盖下一级。**

```ts
export function mergeLayers<T extends object>(...layers: ReadonlyArray<Partial<T>>): Partial<T> {
  const out: Partial<T> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;   // ✅ 就是这一行
    }
  }
  return out;
}
// ❌ { ...file, ...cli } 是错的：commander 对没传的选项给 undefined，
//    { color: undefined } 会把配置文件里的 false 冲掉。这是最常见的配置 bug。
```

环境变量层还有第 07 章那个坑：

```ts
// 🔴 空串必须当成「没设置」，否则 `TOOL_PORT=` 会被 z.coerce.number() 变成 0
const pick = (name: string) => {
  const raw = env[name];
  return raw != null && raw.trim() !== '' ? raw : undefined;
};
if (env.NO_COLOR != null && env.NO_COLOR !== '') out.color = false;   // 约定型变量：设了就生效
```

**同一个 zod schema 同时校验三个来源**，这是 zod 相对 Bean Validation 注解的实质优势 ——
注解绑在 POJO 上，只能校验反序列化出来的对象；schema 是个值，想校验什么都行。

### 4.5 配置文件查找

```ts
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 从 startDir 逐级向上找（eslint/prettier/tsconfig 都是这个套路，monorepo 友好）。 */
export function findConfigUpwards(startDir: string, fileName: string, existsFn: (p: string) => boolean): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsFn(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;   // 😱 dirname('/') === '/'，不靠这条判断会死循环
    dir = parent;
  }
}

/** 项目里找不到就回落到用户级配置。别自己拼 '/'，用 node:path。 */
export const userConfigPath = (home = homedir()): string => join(home, '.config', 'jsonl', 'config.json');
```

`existsFn` 和 `home` 都是**带默认值的注入参数** —— 于是这两个函数不碰真实文件系统也能测（练习 8.9）。
`jsonl config path` 会把这两个候选位置直接打出来（见 §3.5 的实测输出）。

### 4.6 彩色输出

难点不是 ANSI 转义码（就 `\u001B[31m…\u001B[0m` 这么一行），而是**什么时候不该上色**：

```ts
/** 优先级：--no-color > NO_COLOR > FORCE_COLOR > isTTY */
export function shouldUseColor({ color, isTTY, env }: ColorDecision): boolean {
  if (!color) return false;                                        // 用户传了 --no-color
  if (env.NO_COLOR != null && env.NO_COLOR !== '') return false;   // https://no-color.org，空串=未设置
  if (env.FORCE_COLOR != null && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;  // CI 常用
  return isTTY;                                                    // 重定向到文件/管道时不上色
}
```

不判断 `isTTY` 的后果：`mytool > report.txt` 得到一个满是 `^[[31m` 的文件，`grep 'error'` 还匹配不上。

生态选择：**`picocolors`**（最小最快，现在的默认选择）、`chalk`（功能最全，体积大）、`kleur`。
Node 22+（以及 20.12+）内置了 **`node:util` 的 `styleText`**，实测可用：

```ts
import { styleText } from 'node:util';
styleText('red', 'hi');                              // '\u001B[31mhi\u001B[39m'
styleText(['bold', 'red'], 'hi');                    // 可以叠加
styleText('red', 'hi', { validateStream: false });   // 默认会自己检测 stdout 是否支持颜色
```

> `styleText` 默认就帮你做 TTY / `NO_COLOR` 检测（这也是它比手写划算的地方）。
> 只要 `engines.node >= 20.12`，**新项目直接用它，一个依赖都不用加**。
> `examples/cli/lib/colors.ts` 手写了一份，纯粹为了把那 20 行逻辑摊开给你看。

### 4.7 进度与 spinner

```ts
function reportProgress(done: number, total: number): void {
  if (!process.stderr.isTTY) return;                     // 🔴 非 TTY 必须禁用，否则日志文件里几万行 \r
  process.stderr.write(`\r处理中 ${done}/${total}`);      // \r 回到行首覆盖上一次
}
// 结束时补一个换行，否则下一行输出会怼在进度条后面
if (process.stderr.isTTY) process.stderr.write('\n');
```

注意进度写 **stderr**（它是"日志"不是"数据"）。生态里成熟的：`ora`（spinner）、`cli-progress`（进度条）。

### 4.8 交互提问

```ts
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stderr });   // 提示语走 stderr
try {
  const answer = await rl.question('确定要删除吗? [y/N] ');
  if (answer.trim().toLowerCase() !== 'y') return;
} finally {
  rl.close();      // 不 close 进程不会退出（stdin 一直是打开的句柄）
}
```

> 三条规矩：① **非 TTY 时不要提问**（CI 里会永久挂住），改成要求 `--yes`；
> ② 提示语和答案回显走 stderr，别污染 stdout；③ 危险操作永远提供 `--yes` / `--force` 旁路。
>
> 生态：`@clack/prompts`（现在最好看的）、`inquirer`（最老最全）、`prompts`（最轻）。

### 4.9 优雅退出：`SIGINT` / `SIGTERM` + `AbortController`

```ts
const controller = new AbortController();   // 一个 controller 串起所有可取消的工作

function installSignalHandlers(): void {
  let interrupted = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (interrupted) process.exit(130);          // 连按两次 Ctrl-C：立刻硬退（用户在催）
      interrupted = true;
      process.stderr.write(`\n收到 ${signal}，正在收尾…（再按一次强制退出）\n`);
      controller.abort();                          // 通知所有在跑的 IO 停下
      process.exitCode = 130;                      // 128 + SIGINT(2)，shell 的约定
    });
  }
}
```

`signal` 往下传给所有支持它的 Node API，取消就自动生效了：

```ts
await readFile(file, { encoding: 'utf8', signal });        // node:fs/promises
await fetch(url, { signal });
await setTimeout(1000, undefined, { signal });             // node:timers/promises
// 被取消时抛出的错误 name === 'AbortError'  → exitCodeFor 映射到 130
```

临时文件清理：Node **没有 `defer`**，也没有 shutdown hook 的等价物（`process.on('exit')` 里
**不能做异步操作**）。所以清理必须放在 `try/finally` 里（第 07 章 §6）：

```ts
const tmp = join(tmpdir(), `jsonl-${process.pid}-${Date.now()}`);
try {
  await work(tmp);
} finally {
  await rm(tmp, { force: true, recursive: true }).catch(() => {});   // 清理失败不能掩盖业务错误
}
```

### 4.10 调外部命令：别用 `exec`

```ts
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ✅ execFile：参数是【数组】，不经过 shell，天然免疫注入
const { stdout } = await execFileAsync('git', ['log', '--oneline', '-n', String(n)], {
  cwd: repoDir, timeout: 10_000, maxBuffer: 10 * 1024 * 1024, signal,
});

// ❌ exec：拼字符串，交给 shell 解释 —— 这是命令注入
import { exec } from 'node:child_process';
exec(`git log --grep="${userInput}"`);   // 😱 userInput = '"; rm -rf ~; #' 就完了
```

| | `execFile` | `spawn` |
| --- | --- | --- |
| 输出处理 | **缓冲**成字符串，一次拿到 | **流式**，`child.stdout.on('data')` |
| 适用 | 输出小、要结果（`git rev-parse`） | 输出大 / 要实时转发（`docker build`） |
| 坑 | 超过 `maxBuffer`（默认 1MB）会被杀掉 | 要自己处理背压和 `close` 事件 |

三个必须显式给的选项：**`timeout`**（不给就可能永久挂住）、**`maxBuffer`**（默认 1MB，很容易撞）、
**`signal`**（Ctrl-C 时能把子进程一起带走）。

> 生态里 `execa` 把这些默认值和错误信息都做好了，还内置了 `$` 模板语法。真项目值得装。

### 4.11 文件操作

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// ✅ 一律用 node:fs/promises 的 await 版本，不要用 fs.readFileSync（阻塞事件循环）
// ✅ 路径一律用 node:path 拼，不要手写 '/'（Windows 上是 '\'）
const abs = resolve(process.cwd(), userPath);
```

**原子写**：直接 `writeFile` 到目标路径，进程在写一半时被 Ctrl-C，用户的配置文件就毁了。
标准做法是**写临时文件再 `rename`**（同一文件系统内 `rename` 是原子操作）：

```ts
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;          // 临时文件必须和目标【同目录】，否则跨设备 rename 会失败
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);                           // ✅ 原子替换：读者要么看到旧的，要么看到新的
}
```

**glob**：Node 22+ 内置 `fs.glob`（`node:fs/promises` 的 `glob` 是异步迭代器）：

```ts
import { glob } from 'node:fs/promises';
for await (const entry of glob('src/**/*.ts')) console.log(entry);
```

早于 Node 22 就用 `fast-glob` / `tinyglobby`。**别自己递归 `readdir` + 正则**，
`.gitignore`、符号链接、大小写不敏感文件系统这些坑够你踩一周。

### 4.12 ⭐ 可测试性架构：三层分离

**这一节是本章的落脚点。** 一个 CLI 能不能测，只取决于一件事：
**`process` 有没有被挡在业务代码之外。**

```
┌─────────────────────────────────────────────────────────────┐
│ 第 1 层  解析参数     main.ts / commands/*.ts                │
│   commander 装配、zod 校验、进程级关注点（信号、退出码）        │
│   ⇒ 唯一允许出现 process.argv / process.exitCode 的地方       │
├─────────────────────────────────────────────────────────────┤
│ 第 2 层  执行业务     runStats(file, options, ctx)            │
│   接受【注入】的 AppContext：reporter / stdin / signal / env  │
│   ⇒ 一行 process 都没有；测试里传假的 ctx                     │
├─────────────────────────────────────────────────────────────┤
│ 第 3 层  纯逻辑       lib/jsonl.ts                            │
│   parseJsonl / buildStats / matchesFilter                    │
│   ⇒ 纯函数：没有 I/O、没有 console、没有 process              │
└─────────────────────────────────────────────────────────────┘
```

```ts
// 第 2 层要的「环境」全打包进一个可注入对象（examples/cli/lib/context.ts）
export interface AppContext {
  reporter: Reporter;      // 输出（内部持有注入的 stdout/stderr）
  colors: Colors;
  globals: GlobalOptions;
  stdin: Readable;         // 不是 process.stdin
  stdinIsTTY: boolean;     // 不是 process.stdin.isTTY
  stdout: Writable;
  signal: AbortSignal;
}
```

于是三层各有各的测法，**一个子进程都不用起**：

| 层 | 怎么测 | 例子 |
| --- | --- | --- |
| 第 3 层 纯逻辑 | 直接调，`toEqual` 断言 | 练习 8.12 `buildJsonlStats(lines)` |
| 第 2 层 业务 | 传假 `AppContext`（内存 stream + 假 env + 假 signal） | `runStats('a.jsonl', opts, fakeCtx)` |
| 第 1 层 装配 | `.exitOverride()` + `.configureOutput()` 收集输出 | 练习 8.11 `runCommand(cmd, argv)` |

> **反面教材**：业务函数里直接 `console.log` + `process.exit(2)` + `readFileSync(process.argv[2])`。
> 这种代码只能起子进程测（慢 100 倍、Windows 上路径还不一样），或者干脆没人测。
>
> 判断标准很简单：**`grep -rn 'process\.' lib/` 应该是空的。**

**要不要写端到端测试（起真子进程）？** 写 1~2 个就够 —— 只验证「shebang 对、`bin` 配对、
`--help` 能出来、退出码是 0」。所有业务分支都该在上面三层里覆盖完。

### 4.13 分发

```bash
# ① 本地开发：把本包链接到全局，改代码立刻生效，不用反复 install
pnpm link --global            # npm 是 npm link
jsonl --help                  # 直接用全局命令名调，验证 bin 字段和 shebang 都对

# ② 发布前自检：看清楚哪些文件会被塞进 tarball（最容易翻车的一步）
npm pack --dry-run            # 检查：dist 在里面吗？.env / node_modules 混进去了吗？

# ③ 发布
npm publish --access public   # scoped 包（@me/xxx）第一次发布必须加这个

# ④ 用户侧：不安装直接跑
npx @me/greet Alice           # npx 会临时下载并执行 bin
pnpm dlx @me/greet Alice
```

`package.json` 的 `files` 字段是白名单（比 `.npmignore` 可靠，忘了加就是发个空包）。

**打包成单文件**：`esbuild src/cli.ts --bundle --platform=node --format=esm --outfile=dist/cli.js
--banner:js='#!/usr/bin/env node'` —— 一个文件，启动快，不用 `npm i` 依赖。
想连 Node 都不要（真正的"静态二进制"，对标 `go build`）看 Node 的 **SEA**（Single Executable Application）
或 `bun build --compile`，但产物有 50MB+，且交叉编译很麻烦。**大多数场景 npm + npx 就够了。**

---

## 5. 示例项目导读

完整代码在 [`examples/cli/`](../examples/cli/README.md)，一个处理 JSON Lines 日志的工具 `jsonl`。

| 文件 | 职责 | 本章小节 |
| --- | --- | --- |
| `main.ts` | 只做 commander 装配 + 进程层（信号、顶层 catch、退出码），业务逻辑零行 | §3.10 §4.2 §4.9 |
| `commands/stats.ts` | `stats <file>`：三层分离的样板（装配 / `runStats` / 纯计算） | §4.12 |
| `commands/filter.ts` | `filter <file> -w k=v`：可重复选项 `collect`、变长 `--fields <name...>`、别名 `grep` | §3.3 §3.5 |
| `commands/head.ts` | `head <file> -n 10`：最小子命令 | §3.6 |
| `commands/config.ts` | `config show` / `config path`：嵌套 + 默认子命令 | §3.5 §4.4 |
| `lib/options.ts` | **commander 收字符串，zod 校验转换**：所有 schema + `validateOptions` | §3.4 |
| `lib/context.ts` | `AppContext` / `ContextHolder`：注入式依赖 | §3.8 §4.12 |
| `lib/output.ts` | `Reporter`（唯一碰 stdout/stderr 的一层）+ `formatTable` + `humanize*` | §4.1 |
| `lib/input.ts` | `-` 读 stdin、`isTTY` 判断、`splitLines`、errno → 人话 | §4.3 |
| `lib/config.ts` | 向上查找 `.jsonlrc.json`、`~/.config/jsonl/`、`mergeLayers` | §4.4 §4.5 |
| `lib/colors.ts` | `shouldUseColor` + 20 行 ANSI | §4.6 |
| `lib/errors.ts` | `UsageError` / `ToolError` / `CancelledError` + `exitCodeFor` | §4.2 |
| `lib/jsonl.ts` | **纯逻辑层**：解析 / 统计 / 点路径过滤（`grep -rn 'process\.'` 结果为空） | §4.12 |

### 真实命令与真实输出

**① `--help`：注意底部的自定义帮助文本（`addHelpText('after')`）**

```console
$ pnpm cli --help
Usage: jsonl [options] [command]

处理 JSON Lines 日志的小工具（第 08 章示例）

Options:
  -V, --version                 打印版本号
  --json                        输出机器可读的 JSON（一行一个对象）
  --no-color                    禁用彩色输出
  -v, --verbose                 把诊断信息打到 stderr
  -h, --help                    display help for command

Commands:
  stats [options] <file>        统计 JSONL 的行数、字段频率与非法行
  filter|grep [options] <file>  按 key=value 过滤记录，输出仍然是 JSONL
  head|h [options] <file>       预览前 n 条记录
  config                        查看配置来源与最终生效值
  help [command]                display help for command

铁律:
  stdout 只放数据, stderr 只放日志。所以下面这行是安全的：
    $ jsonl --json stats sample.jsonl 2>/dev/null | jq .

退出码:
  0 成功   1 一般错误   2 用法错误   130 被 Ctrl-C 中断
```

`filter|grep` 里的 `grep` 是 `.alias()`，`head|h` 同理。

**② `stats`：人类可读的表格（stdout）+ 警告（stderr）**

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
durationMs  7      64%    number
http        7      64%    object
tags        4      36%    array
...
```

同一时刻 stderr 上还有一行 `[warn] 有 2 行无法解析` —— 所以上面那段能直接 `> stats.txt`
而不会掺进日志。（`sample.jsonl` 里故意埋了一个空行、一行坏 JSON、一行数组；
加 `--show-bad` 能看到它们的行号和内容。完整输出见
[examples/cli/README.md](../examples/cli/README.md)。）

**③ 管道 + `--json` + `jq`：铁律的实际收益**

```console
$ cat examples/cli/sample.jsonl | pnpm cli filter - -w level=error --fields ts msg 2>/dev/null
{"ts":"2024-05-01T09:00:11Z","msg":"upstream timeout"}
{"ts":"2024-05-01T09:00:15Z","msg":"job failed"}
{"ts":"2024-05-01T09:00:25Z","msg":"validation failed"}
```

`filter` 的输出仍是 JSONL，所以能继续往下接。`-` 表示从 stdin 读（§4.3）。

**④ 错误路径：zod 报错 + 退出码 2**

```console
$ pnpm cli filter examples/cli/sample.jsonl ; echo "exit=$?"
[error] filter 选项非法:
✖ 至少需要一个 --where 条件，例如 --where level=error
  → at where
exit=2

$ pnpm cli stats nope.jsonl ; echo "exit=$?"
[error] 文件不存在: nope.jsonl
exit=2

$ pnpm cli --help > /dev/null ; echo "exit=$?"
exit=0
```

三行都是实跑结果：zod 的 `prettifyError` 输出、errno 翻译成人话、
以及**`--help` 的退出码是 0**（§3.10 那个坑）。

---

## 本章练习

```bash
# 1. 打开 exercises/ch08-cli.ts，把所有 TODO 填掉
# 2. 跑测试
pnpm test tests/ch08

# 3. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch08

# 4. 卡住了看 solutions/ch08-cli.ts
```

练习覆盖：`splitLines` 处理 BOM/CRLF/末尾换行、`humanizeBytes` / `humanizeDuration`、
`colorize` 的 `NO_COLOR`/`FORCE_COLOR`/`isTTY` 优先级、`exitCodeFor` 错误类型→退出码、
`formatTable` 等宽对齐、手写 `parseArgvBasic`（并撞上「没有 schema 就分不清布尔开关」这个墙）、
`parseWhereFilter` + 点路径取值 + 原型污染防护、`findConfigUpwards` 向上查找、
`resolveConfig` 四级优先级 + zod 校验、**`buildGreetCommand` + `runCommand` 测 CLI 的标准夹具**、
`buildJsonlStats` 综合统计。

全部题目**不启动子进程、不读真实 `process.argv`、不写真实 stdout** —— 这本身就是 §4.12 的演示。

---

**下一章** → [09 · AI Agent 实战：LLM + 工具 + 循环 + 状态](./09-ai-agent-with-openai.md)
