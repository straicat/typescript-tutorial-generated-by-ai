/**
 * 第 08 章练习 · 命令行工具实战
 * =====================================================================
 * 对应文档：docs/08-cli-with-commander.md
 *
 * 玩法：
 *   1. 把每个函数里的 TODO 换成你的实现（**不要修改函数签名和导出名**）
 *   2. 跑 `pnpm test tests/ch08`  或者 `pnpm vitest tests/ch08`（watch 模式）
 *   3. 卡住超过 10 分钟 → 看 solutions/ch08-cli.ts
 *
 * 难度：⭐ 入门  ⭐⭐ 需要想一下  ⭐⭐⭐ 有坑
 *
 * 本章的核心约束：**所有题目都不许启动子进程、不许读真实 process.argv、
 * 不许写真实 stdout**。所有外部依赖（env、isTTY、文件是否存在、输出流）
 * 一律**作为参数注入**。这就是文档里「可测试性架构」那一节要教的东西 ——
 * 一个 CLI 能不能测，取决于你有没有把 process 挡在业务代码之外。
 *
 * 8.10 需要 zod（已装 zod@4.5.4）：`import { z } from 'zod';`
 * 8.11 需要 commander（已装 commander@15）：`import { Command } from 'commander';`
 * 完整的示例项目在 examples/cli/，写完练习可以对照着看。
 * =====================================================================
 */

import type { Command } from 'commander';

// =====================================================================
// 下面这两个错误类【已经给你实现好了】，8.5 和 8.11 会用到，不要改。
// 注意 `this.name = ...`：Error 构造函数不会根据子类名自动设 name。
// =====================================================================

/** 用法错误：用户传错了参数 / 配置非法。约定退出码 2。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** 业务错误：自带退出码。 */
export class ToolError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ToolError';
    this.exitCode = exitCode;
  }
}

/**
 * 练习 8.1 ⭐⭐ —— 把一整块文本切成行
 *
 * 读文件 / 读 stdin 拿到的是一个大字符串，切行有四个必须处理的细节：
 *   1. **BOM**：Windows 记事本存的 UTF-8 文件开头有 '\uFEFF'，不剥掉第一行 JSON.parse 必炸
 *   2. **\r\n**：Windows 换行，每行末尾会多一个 '\r'
 *   3. **末尾换行**：'a\n' 应该是 1 行而不是 2 行（只丢掉最后那一个空元素）
 *   4. **中间空行**要保留（JSONL 允许空行填充，行号要对得上）
 *
 * splitLines('a\nb')        -> ['a', 'b']
 * splitLines('a\nb\n')      -> ['a', 'b']        // 末尾换行不产生空行
 * splitLines('a\r\nb\r\n')  -> ['a', 'b']        // \r 要剥掉
 * splitLines('a\n\nb\n')    -> ['a', '', 'b']    // 中间空行保留
 * splitLines('\uFEFFa')     -> ['a']             // BOM 剥掉
 * splitLines('')            -> []                // 空输入是 0 行
 * splitLines('\n')          -> ['']              // 一个空行
 * splitLines('a')           -> ['a']             // 没有末尾换行也行
 */
export function splitLines(input: string): string[] {
  throw new Error('TODO 8.1: 实现 splitLines');
}

/**
 * 练习 8.2 ⭐⭐ —— 人类可读的字节数
 *
 * 用 1024 进制，单位表 ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']。
 * 规则：
 *   - B 档直接输出数字本身（调用方保证传整数）：`${n} B`
 *   - 其余档保留 1 位小数：`${n.toFixed(1)} ${unit}`
 *   - 负数在最前面加 '-'（对绝对值做换算）
 *   - 超过 PiB 就一直用 PiB，不再往上升
 *   - **非有限数字（NaN / Infinity）抛 RangeError** —— CLI 里最常见的来源是
 *     `Number(用户输入)`，不检查就会打印出 "NaN B" 这种垃圾
 *
 * humanizeBytes(0)          === '0 B'
 * humanizeBytes(999)        === '999 B'
 * humanizeBytes(1024)       === '1.0 KiB'
 * humanizeBytes(1536)       === '1.5 KiB'
 * humanizeBytes(1048576)    === '1.0 MiB'
 * humanizeBytes(-2048)      === '-2.0 KiB'
 * humanizeBytes(NaN)        -> 抛 RangeError
 */
export function humanizeBytes(bytes: number): string {
  throw new Error('TODO 8.2: 实现 humanizeBytes');
}

/**
 * 练习 8.3 ⭐⭐ —— 人类可读的时长
 *
 * 分档（注意每档的边界和小数位数都不一样）：
 *   ms < 1000        -> `${四舍五入的整数}ms`
 *   ms < 60_000      -> `${(ms / 1000).toFixed(1)}s`
 *   ms < 3_600_000   -> `${分}m${四舍五入的秒}s`
 *   否则              -> `${时}h${向下取整的分}m`
 * 负数或非有限数字抛 RangeError。
 *
 * humanizeDuration(0)         === '0ms'
 * humanizeDuration(999)       === '999ms'
 * humanizeDuration(1000)      === '1.0s'
 * humanizeDuration(1500)      === '1.5s'
 * humanizeDuration(59_000)    === '59.0s'
 * humanizeDuration(60_000)    === '1m0s'
 * humanizeDuration(90_000)    === '1m30s'
 * humanizeDuration(3_600_000) === '1h0m'
 * humanizeDuration(7_260_000) === '2h1m'
 * humanizeDuration(-1)        -> 抛 RangeError
 */
export function humanizeDuration(ms: number): string {
  throw new Error('TODO 8.3: 实现 humanizeDuration');
}

/**
 * 练习 8.4 ⭐⭐ —— 该不该上色（env 和 isTTY 都是注入的）
 *
 * 「上色」真正的难点不是 ANSI 转义码，而是**什么时候不该上色**。
 * 判定优先级（从高到低）：
 *   1. NO_COLOR 是非空字符串       -> 不上色（https://no-color.org 约定，空串视为未设置）
 *   2. FORCE_COLOR 非空且不是 '0'  -> 上色（CI 上常用：非 TTY 也要彩色日志）
 *   3. 否则看 target.isTTY         -> 只有输出到终端才上色
 * 另外：**空字符串永远不上色**（加了看不见，只会污染 diff 和测试断言）。
 *
 * 转义码：red=31 green=32 yellow=33 gray=90 bold=1，reset 一律用 0。
 * 输出格式固定为 `\u001B[<code>m<text>\u001B[0m`。
 *
 * const tty  = { isTTY: true,  env: {} };
 * const pipe = { isTTY: false, env: {} };
 * colorize('hi', 'red', tty)                              === '\u001B[31mhi\u001B[0m'
 * colorize('hi', 'red', pipe)                             === 'hi'
 * colorize('hi', 'red', { isTTY: true,  env: { NO_COLOR: '1' } })    === 'hi'
 * colorize('hi', 'red', { isTTY: true,  env: { NO_COLOR: '' } })     === '\u001B[31mhi\u001B[0m'
 * colorize('hi', 'red', { isTTY: false, env: { FORCE_COLOR: '1' } }) === '\u001B[31mhi\u001B[0m'
 * colorize('hi', 'red', { isTTY: false, env: { FORCE_COLOR: '0' } }) === 'hi'
 * colorize('',   'red', tty)                              === ''
 */
export type ColorName = 'red' | 'green' | 'yellow' | 'gray' | 'bold';

export interface ColorTarget {
  /** 目标流是不是终端（真实代码里传 process.stdout.isTTY === true） */
  isTTY: boolean;
  env: Record<string, string | undefined>;
}

export function colorize(text: string, color: ColorName, target: ColorTarget): string {
  throw new Error('TODO 8.4: 实现 colorize');
}

/**
 * 练习 8.5 ⭐⭐ —— 错误类型 → 退出码
 *
 * 退出码是 CLI 对外的 API（脚本会用 `if ! tool ...; then` 判断成败）。
 * 本章约定：0 成功 / 1 一般错误 / 2 用法错误 / 130 被 Ctrl-C 中断。
 *
 * 按【顺序】判断：
 *   1. error == null                                   -> 0
 *   2. UsageError                                      -> 2
 *   3. Error 且 name === 'AbortError'                   -> 130（Node 的 abort 就用这个 name）
 *   4. 是对象且有整数 exitCode 且在 0..255 之间          -> 该值
 *      （这一条同时兼容 ToolError 和 commander 的 CommanderError，
 *        所以 `--help` 抛出的 CommanderError(exitCode=0) 会得到 0）
 *   5. 其它                                             -> 1
 *
 * exitCodeFor(null)                        === 0
 * exitCodeFor(new Error('boom'))           === 1
 * exitCodeFor('boom')                      === 1     // 字符串不是对象，走兜底
 * exitCodeFor(new UsageError('bad flag'))  === 2
 * exitCodeFor(new ToolError('no match'))   === 1
 * exitCodeFor(new ToolError('x', 3))       === 3
 * exitCodeFor({ exitCode: 0 })             === 0     // 别写成 `code || 1`，0 会被吃掉！
 * exitCodeFor({ exitCode: 300 })           === 1     // 越界不信任
 * exitCodeFor({ exitCode: 1.5 })           === 1     // 非整数不信任
 */
export function exitCodeFor(error: unknown): number {
  throw new Error('TODO 8.5: 实现 exitCodeFor');
}

/**
 * 练习 8.6 ⭐⭐⭐ —— 等宽对齐的表格
 *
 * 返回多行字符串，**不带**结尾换行。
 *   - 列宽 = 该列所有单元格（含表头）的最大显示宽度
 *   - 列之间用 `gap` 个空格分隔（默认 2）
 *   - 每行**必须 trimEnd**：尾随空格没有意义，还会污染 diff 和测试断言
 *   - 传了 header 时，第二行是等长的 '-' 分隔线
 *   - 行可以长短不齐，缺的单元格按 '' 处理，列数取所有行的最大值
 *   - rows 为空且没有 header -> 返回 ''
 *
 * 显示宽度用**码点数**（`[...cell].length`），所以 emoji 算 1 个。
 * ⚠️ 说明：真实终端里中日韩字符占 **2 列**，本题**不要求**处理
 * （生态里干这事的库叫 `string-width`；examples/cli/lib/output.ts 里有个能处理
 * 全角的版本可以对照）。所以本题的中文表格在终端里看起来会是歪的，这是预期行为。
 *
 * formatTable([['a', 'bbb'], ['cc', 'd']])
 *   -> 'a   bbb\ncc  d'
 * formatTable([['1', '2']], { header: ['id', 'n'] })
 *   -> 'id  n\n--  -\n1   2'
 * formatTable([['a', 'b']], { gap: 1 })
 *   -> 'a b'
 * formatTable([])                    -> ''
 * formatTable([], { header: ['a'] }) -> 'a\n-'
 */
export interface TableOptions {
  header?: readonly string[];
  gap?: number;
}

export function formatTable(rows: ReadonlyArray<readonly string[]>, options?: TableOptions): string {
  throw new Error('TODO 8.6: 实现 formatTable');
}

/**
 * 练习 8.7 ⭐⭐⭐ —— 手写一个最小的 argv 解析器
 *
 * 这题的目的是让你**亲手体会一遍** commander / node:util 的 parseArgs 在帮你做什么。
 * 注意输入是「真实参数」，**不含** node 路径和脚本路径（那两个由 argv.slice(2) 去掉）。
 *
 * 规则（严格按这个来，测试卡得很死）：
 *   1. `--key=value`  -> options['key'] = 'value'；`--key=` -> ''（空串，不是 true）
 *   2. `--key value`  -> 下一个元素**存在且不以 '-' 开头**时作为值并消耗掉，否则 options['key'] = true
 *   3. `-abc`         -> 合并短选项，a/b/c 全部 = true（**不吃**后面的值）
 *   4. `-n`           -> 长度为 1 的短选项组才按规则 2 去取值
 *   5. `--`           -> 它本身丢弃，**后面所有元素**原样进 positionals（即使以 '-' 开头）
 *   6. 单独的 `-`     -> 位置参数（Unix 约定：表示 stdin）
 *   7. 键名**保持原样**，不做 camelCase 转换（'--log-level' 的键就是 'log-level'）
 *   8. 同名键重复出现时，**后面覆盖前面**
 *
 * parseArgvBasic(['--port', '8080'])
 *   -> { options: { port: '8080' }, positionals: [] }
 * parseArgvBasic(['--port=8080', 'file.txt', '--verbose'])
 *   -> { options: { port: '8080', verbose: true }, positionals: ['file.txt'] }
 * parseArgvBasic(['--port=8080', '--verbose', 'file.txt'])
 *   -> { options: { port: '8080', verbose: 'file.txt' }, positionals: [] }
 *   😱 没错，'file.txt' 被 --verbose 吃掉了，这是**规则 2 的必然结果**：
 *      手写解析器**不知道 --verbose 是个布尔开关**，只有「事先声明过每个选项的类型」
 *      的库（commander / node:util 的 parseArgs）才分得清。
 *      这就是本题真正想让你体会到的东西 —— 别自己撕 argv。
 * parseArgvBasic(['--flag', '--other'])
 *   -> { options: { flag: true, other: true }, positionals: [] }
 * parseArgvBasic(['-abc'])
 *   -> { options: { a: true, b: true, c: true }, positionals: [] }
 * parseArgvBasic(['-n', '3', 'x'])
 *   -> { options: { n: '3' }, positionals: ['x'] }
 * parseArgvBasic(['--', '--port', '8080'])
 *   -> { options: {}, positionals: ['--port', '8080'] }
 * parseArgvBasic(['-'])
 *   -> { options: {}, positionals: ['-'] }
 * parseArgvBasic(['--tag=a', '--tag=b'])
 *   -> { options: { tag: 'b' }, positionals: [] }
 */
export interface ParsedArgv {
  /** 值为 string 表示带值选项，true 表示布尔开关 */
  options: Record<string, string | true>;
  positionals: string[];
}

export function parseArgvBasic(argv: readonly string[]): ParsedArgv {
  throw new Error('TODO 8.7: 实现 parseArgvBasic');
}

/**
 * 练习 8.8 ⭐⭐ —— `--where a.b=1` 过滤器（点路径取值）
 *
 * parseWhereFilter(spec)：按**第一个 '='** 切分。
 *   - '=' 前面紧跟 '!' 表示取反（`level!=error`）
 *   - key 用 '.' 切成 path
 *   - value 原样保留（右边还有 '=' 也算值的一部分）
 *   - 非法输入抛 UsageError：没有 '='、key 为空、路径里出现空段
 *
 * getByPath(obj, path)：逐段下钻；任何一环不是对象（含 null）就返回 undefined。
 *   ⚠️ **必须挡掉 '__proto__' / 'prototype' / 'constructor'** —— 这三个键
 *   在 JS 里能取到原型链上的东西，是原型污染类漏洞的入口，一律当「取不到」。
 *
 * matchesFilter(obj, filter)：
 *   - 取到 undefined（字段缺失）时视为「不相等」
 *   - 对象/数组用 JSON.stringify 比较，其它值用 String() 比较
 *   - negated 时把结果取反（于是「字段缺失」算作 != 成立，符合直觉）
 *
 * parseWhereFilter('a.b=1')       -> { path: ['a', 'b'], value: '1', negated: false }
 * parseWhereFilter('level!=error')-> { path: ['level'], value: 'error', negated: true }
 * parseWhereFilter('k=')          -> { path: ['k'], value: '', negated: false }
 * parseWhereFilter('a=b=c')       -> { path: ['a'], value: 'b=c', negated: false }
 * parseWhereFilter('level')       -> 抛 UsageError
 * parseWhereFilter('=1')          -> 抛 UsageError
 * parseWhereFilter('a..b=1')      -> 抛 UsageError
 *
 * getByPath({ a: { b: 1 } }, ['a', 'b'])   === 1
 * getByPath({ a: 1 }, ['a', 'b'])          === undefined
 * getByPath({}, ['constructor'])           === undefined
 *
 * matchesFilter({ level: 'error' },   parseWhereFilter('level=error'))     === true
 * matchesFilter({ http: { status: 504 } }, parseWhereFilter('http.status=504')) === true
 * matchesFilter({},                   parseWhereFilter('level=error'))     === false
 * matchesFilter({},                   parseWhereFilter('level!=error'))    === true
 * matchesFilter({ tags: ['x'] },      parseWhereFilter('tags=["x"]'))      === true
 */
export interface WhereFilter {
  path: string[];
  value: string;
  negated: boolean;
}

export function parseWhereFilter(spec: string): WhereFilter {
  throw new Error('TODO 8.8: 实现 parseWhereFilter');
}

export function getByPath(obj: unknown, path: readonly string[]): unknown {
  throw new Error('TODO 8.8: 实现 getByPath');
}

export function matchesFilter(obj: unknown, filter: WhereFilter): boolean {
  throw new Error('TODO 8.8: 实现 matchesFilter');
}

/**
 * 练习 8.9 ⭐⭐ —— 从当前目录向上找配置文件
 *
 * 这是 eslint / prettier / tsconfig 全都在用的查找方式（monorepo 里每个子包
 * 可以有自己的配置）。从 startDir 开始逐级向上，返回**第一个**命中的路径。
 *
 * 要点：
 *   - 用 node:path 的 join / dirname 拼路径，不要自己拼 '/'
 *   - 到根目录时 `dirname('/') === '/'`，**必须靠这个条件终止，否则死循环**
 *   - existsFn 是注入的，所以这题完全不碰真实文件系统
 *
 * const exists = (p: string) => p === '/a/b/.toolrc.json';
 * findConfigUpwards('/a/b/c', '.toolrc.json', exists) === '/a/b/.toolrc.json'
 * findConfigUpwards('/a/b',   '.toolrc.json', exists) === '/a/b/.toolrc.json'
 * findConfigUpwards('/a',     '.toolrc.json', exists) === null
 * findConfigUpwards('/a/b/c', '.toolrc.json', () => false) === null   // 不能死循环
 */
export function findConfigUpwards(
  startDir: string,
  fileName: string,
  existsFn: (path: string) => boolean,
): string | null {
  throw new Error('TODO 8.9: 实现 findConfigUpwards');
}

/**
 * 练习 8.10 ⭐⭐⭐ —— 四级配置优先级合并 + zod 校验
 *
 * 优先级（高 → 低）：**命令行 > 环境变量 > 配置文件 > 默认值**。
 * 内置默认值（第 4 级，写在函数里）：
 *   { port: 8080, logLevel: 'info', color: true, retries: 0 }
 *
 * 环境变量映射（第 2 级）：
 *   TOOL_PORT      -> port
 *   TOOL_LOG_LEVEL -> logLevel
 *   TOOL_RETRIES   -> retries
 *   NO_COLOR 非空  -> color = false
 *   ⚠️ **空字符串视为「没设置」**（`TOOL_PORT=` 不能被当成 0，这是第 07 章那个坑）
 *
 * 合并规则：
 *   😱 **值为 undefined 的字段不允许覆盖下一级**。commander 对没传的选项给的就是
 *   undefined，一个朴素的 `{ ...file, ...cli }` 会让 `{ color: undefined }`
 *   把配置文件里的 false 冲掉 —— 这是最常见的配置 bug。
 *
 * 校验（用 zod）：
 *   port     整数 1..65535（字符串要能自动转成数字，用 z.coerce）
 *   logLevel 枚举 'debug' | 'info' | 'warn' | 'error'
 *   color    boolean
 *   retries  整数 0..10（同样支持字符串）
 *   配置文件里**多余的键直接丢掉**（zod object 默认就是 strip）
 * 校验失败抛 **UsageError**，message 以 '配置非法:' 开头。
 *
 * resolveConfig({})
 *   -> { port: 8080, logLevel: 'info', color: true, retries: 0 }
 * resolveConfig({ file: { port: 3000 } })
 *   -> port 3000
 * resolveConfig({ file: { port: 3000 }, env: { TOOL_PORT: '4000' } })
 *   -> port 4000
 * resolveConfig({ file: { port: 3000 }, env: { TOOL_PORT: '4000' }, cli: { port: 5000 } })
 *   -> port 5000
 * resolveConfig({ env: { TOOL_PORT: '' } })              -> port 8080（空串=没设置）
 * resolveConfig({ env: { NO_COLOR: '1' } })              -> color false
 * resolveConfig({ file: { color: false }, cli: { color: undefined } }) -> color false
 * resolveConfig({ file: { port: 0 } })                   -> 抛 UsageError
 * resolveConfig({ file: { logLevel: 'trace' } })         -> 抛 UsageError
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ResolvedConfig {
  port: number;
  logLevel: LogLevel;
  color: boolean;
  retries: number;
}

export interface ConfigSources {
  /** 从 .toolrc.json 读出来的原始对象（JSON.parse 的结果，类型完全不可信） */
  file?: Record<string, unknown>;
  /** process.env 的形状 */
  env?: Record<string, string | undefined>;
  /** commander 的 opts()，没传的键是 undefined */
  cli?: Record<string, unknown>;
}

export function resolveConfig(sources: ConfigSources): ResolvedConfig {
  throw new Error('TODO 8.10: 实现 resolveConfig');
}

/**
 * 练习 8.11 ⭐⭐⭐（本章最重要的一题）—— 用 commander 装一个命令，并且能测它
 *
 * 默认情况下 commander 出错会直接 `process.exit()`，输出直接怼到 process.stdout ——
 * 这两件事让 CLI **完全没法单测**。解法是两个 API：
 *   `.exitOverride()`     让它抛 CommanderError 而不是 exit
 *   `.configureOutput()`  把 writeOut / writeErr 换成你自己的收集函数
 * 这一题就是把这套「CLI 测试夹具」写出来。写完之后你测任何 CLI 都用它。
 *
 * ---- (A) buildGreetCommand(): Command ----
 * 装配一个名叫 'greet' 的命令（**不要**调 .parse()，只返回装好的 Command）：
 *   .name('greet')
 *   .description('打招呼')
 *   .version('1.0.0')                                     // 于是有了 -V / --version
 *   .argument('<name>', '要打招呼的人')                     // 必填位置参数
 *   .option('-t, --times <n>', '重复次数', '1')             // 注意默认值是【字符串】'1'
 *   .option('-u, --upper', '转成大写')
 *   .option('--no-exclaim', '不要末尾的感叹号')             // 取反选项：默认 exclaim === true
 *   .option('-v, --verbose', '把诊断信息打到 stderr')
 *   .showHelpAfterError('(用 --help 查看用法)')
 *
 * action 里做的事（**必须通过 commander 的输出通道写**，这样才能被捕获）：
 *   const write    = this.configureOutput().writeOut!;   // → stdout
 *   const writeErr = this.configureOutput().writeErr!;   // → stderr
 *   1. 用 zod 把 times 从字符串校验成 1..10 的整数（z.coerce.number().int().min(1).max(10)）
 *      失败就 `throw new UsageError(...)`，message 以 'greet 选项非法:' 开头
 *   2. verbose 时先往 stderr 写一行 `[info] name=<name> times=<n>\n`
 *   3. 往 stdout 写 n 行问候，每行结尾一个 '\n'：
 *        基础串 = `Hello, ${name}` + (exclaim ? '!' : '')
 *        upper  时整行 .toUpperCase()
 *
 * ---- (B) runCommand(command, argv): CommandRunResult ----
 * 通用的「在内存里跑一个 Command」夹具：
 *   1. 递归地给 command 和**它所有子命令**装上 .exitOverride() 和 .configureOutput()
 *      （子命令列表是只读属性 `command.commands`）
 *      😱 这一步的递归不能省：`.command()` 创建的子命令会继承父命令的设置，
 *         但 `.addCommand()` 加进去的**不会**，漏了它子命令报错时会绕过你的
 *         exitOverride 直接把测试进程 exit 掉。
 *      configureOutput 里除了 writeOut / writeErr，顺手把这四个也固定住：
 *         getOutHasColors: () => false, getErrHasColors: () => false,
 *         getOutHelpWidth: () => 80,    getErrHelpWidth: () => 80,
 *      否则同一份帮助文本在本机终端和 CI 上会带不同的颜色和换行，断言会飘。
 *   2. `command.parse(argv, { from: 'user' })`
 *      ⚠️ `from: 'user'` 表示 argv 里**只有真实参数**，没有 node 路径和脚本路径。
 *         不写它 commander 会把 argv[0]、argv[1] 当成那两个东西吃掉。
 *   3. 没抛异常 -> { stdout, stderr, exitCode: 0, error: null }
 *      抛了     -> error = 该 Error（不是 Error 的用 `new Error(String(v))` 包一下），
 *                  exitCode = exitCodeFor(error)（复用 8.5！CommanderError 自带 exitCode，
 *                  所以 --help / --version 会得到 0）
 *
 * const r1 = runCommand(buildGreetCommand(), ['Alice']);
 * // { stdout: 'Hello, Alice!\n', stderr: '', exitCode: 0, error: null }
 * const r2 = runCommand(buildGreetCommand(), ['Alice', '-t', '2', '-u', '--no-exclaim']);
 * // r2.stdout === 'HELLO, ALICE\nHELLO, ALICE\n'
 * const r3 = runCommand(buildGreetCommand(), []);
 * // r3.exitCode === 1, r3.stderr 含 "missing required argument 'name'" 和 '(用 --help 查看用法)'
 * const r4 = runCommand(buildGreetCommand(), ['--help']);
 * // r4.exitCode === 0（help 也是抛异常出来的，但它不是错误！），r4.stdout 含 'Usage: greet'
 * const r5 = runCommand(buildGreetCommand(), ['Alice', '-t', 'abc']);
 * // r5.exitCode === 2（UsageError），r5.error.name === 'UsageError'
 */
export interface CommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error: Error | null;
}

export function buildGreetCommand(): Command {
  throw new Error('TODO 8.11: 实现 buildGreetCommand');
}

export function runCommand(command: Command, argv: readonly string[]): CommandRunResult {
  throw new Error('TODO 8.11: 实现 runCommand');
}

/**
 * 练习 8.12 ⭐⭐⭐（综合）—— JSONL 统计
 *
 * 输入是按行切好的 JSONL（用 8.1 的 splitLines 得到的东西），输出统计报告。
 * 这是 examples/cli 里 `jsonl stats` 子命令的业务核心 —— 注意它是**纯函数**：
 * 没有 I/O、没有 console、没有 process，所以测它不需要临时文件也不需要子进程。
 *
 * 规则：
 *   - **空白行**（trim 后为空）完全跳过，不计入任何数字
 *   - total   = 非空白行数
 *   - valid   = 能 JSON.parse 且结果是「普通对象」的行数
 *   - invalid = 解析失败 **或** 解析出来不是普通对象（数组 / null / 数字 / 字符串都算非法）
 *   - badLines = 非法行的行号，**1-based，相对于输入数组的下标**，升序
 *   - fields  = 每个 key 的出现次数 + 该 key 出现过的运行时类型集合
 *       运行时类型：null -> 'null'，数组 -> 'array'，其余用 typeof
 *       types 去重后按**字母序**排列
 *   - fields 排序：count **降序**；count 相同按 field 名升序
 *     （排序必须是确定性的，否则输出没法做断言 —— 这条在 CLI 里很重要）
 *
 * buildJsonlStats([
 *   '{"a":1,"b":"x"}',      // L1 ok
 *   '',                     // L2 空白，跳过
 *   '{"a":2}',              // L3 ok
 *   'not json',             // L4 非法：解析失败
 *   '[1,2]',                // L5 非法：不是对象
 *   '{"a":null,"c":true}',  // L6 ok
 * ])
 * -> {
 *      total: 5, valid: 3, invalid: 2, badLines: [4, 5],
 *      fields: [
 *        { field: 'a', count: 3, types: ['null', 'number'] },
 *        { field: 'b', count: 1, types: ['string'] },
 *        { field: 'c', count: 1, types: ['boolean'] },
 *      ],
 *    }
 * buildJsonlStats([]) -> { total: 0, valid: 0, invalid: 0, badLines: [], fields: [] }
 */
export interface FieldStat {
  field: string;
  count: number;
  types: string[];
}

export interface JsonlStats {
  total: number;
  valid: number;
  invalid: number;
  badLines: number[];
  fields: FieldStat[];
}

export function buildJsonlStats(lines: readonly string[]): JsonlStats {
  throw new Error('TODO 8.12: 实现 buildJsonlStats');
}
