# 05 · 模块与工程化：ESM、包结构与发布

> 本章目标：彻底搞懂 TS/Node 的模块系统，能读懂别人的 `package.json`，
> 能把自己的 CLI 发成一个 npm 包。
>
> 这一章是**踩坑密度最高**的一章。原因很简单：JS 生态在 2015 年引入 ESM，
> 但在此之前已经有十年的 CommonJS 存量，两套模块系统至今并存。
> 好消息是，只要按本章的规则走（`type: "module"` + `nodenext` + 相对导入写 `.js`），
> 你几乎不会遇到问题。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript (ESM) | 危险等级 |
| --- | --- | --- | --- |
| 模块单位 | package（一个目录） | **一个文件就是一个模块** | 🔴 高 |
| 可见性 | `public` / `private` / 包级（Go 首字母大小写） | **只有"导出 / 不导出"**，没有包级可见性 | 🟡 中 |
| 导入语法 | `import com.x.Y;` / `import "fmt"` | `import { Y } from './y.js'` | 🟢 低 |
| 相对导入 | 不存在（按包路径找） | `./x.js` / `../lib/y.js`，**必须带扩展名** | 🔴 高 |
| 扩展名 | 无 | 写 **`.js`**，即使源文件是 `.ts` 😱 | 🔴 高 |
| 两套模块系统 | 无 | **ESM 与 CommonJS 并存**，互操作有坑 | 🔴 高 |
| 当前文件路径 | `getClass().getResource()` / `runtime.Caller` | `import.meta.dirname`（**没有 `__dirname`**） | 🔴 高 |
| 循环依赖 | 编译期报错（Go）/ 能跑（Java） | 能跑，但可能拿到 `undefined` | 🟡 中 |
| 动态加载 | `Class.forName` / plugin 包 | `await import('./x.js')`，一等公民 | 🟢 低 |
| 顶层 await | 无 | **ESM 支持**（CJS 不支持） | 🟢 低 |
| 依赖多版本共存 | classpath 冲突 / MVS 单版本 | **允许同时存在多个版本** | 🟡 中 |
| 对外 API 声明 | `module-info.java` / 大写导出 | `package.json` 的 `exports` 字段 | 🟡 中 |

---

## 1. 模块就是文件

没有 `package` 声明，没有目录和命名空间的对应关系。**一个 `.ts` 文件就是一个模块**，
文件里 `export` 出来的东西外部能拿到，没 `export` 的**外部绝对拿不到**：

```ts
// src/hash.ts
import { createHash } from 'node:crypto';

const SALT = 'internal-only';          // ✅ 没 export = 文件级私有，外部无法访问

export function sha256(input: string): string {
  return createHash('sha256').update(SALT + input).digest('hex');
}

function normalize(s: string): string { // ✅ 私有辅助函数
  return s.trim().toLowerCase();
}
```

这相当于**每个文件都是一个只有一个成员的 package**。所以：

- Go 的"同 package 内互相可见"在 TS 里**没有对应物**。想让几个文件共享内部实现，
  只能都 `export` 出去，然后靠 `exports` 字段（第 9 节）阻止外部 import。
- Java 的 `private` 类成员在 TS 的 class 里有（第 04 章），但**没有包级 private**。

> 一个文件只要有 `import` 或 `export`，它就是**模块**（有独立作用域）；
> 完全没有的话它是**脚本**，顶层 `const` 会污染全局。所以工具文件哪怕没什么可导出，
> 也习惯性写一句 `export {};`。

---

## 2. ESM 基础语法

```ts
// ---------- 导出 ----------
export const VERSION = '1.0.0';                 // 声明处直接导出
export function run(): void {}
export class Runner {}
export interface Options { verbose: boolean }   // 类型也能导出
export type Level = 'info' | 'warn';

const a = 1, b = 2;
export { a, b };                                // 集中导出
export { a as first };                          // 导出时重命名

export default class Cli {}                     // 默认导出（一个文件最多一个）
```

```ts
// ---------- 导入 ----------
import { run, VERSION } from './runner.js';        // 具名导入
import { run as execute } from './runner.js';      // 导入时重命名（≈ Go 的 import r "runner"）
import * as runner from './runner.js';             // 整个命名空间（runner.run()）
import Cli from './cli.js';                        // 默认导入（名字随你起）
import Cli, { VERSION } from './cli.js';           // 混合
import './register.js';                            // 只执行副作用，什么都不取
```

```ts
// ---------- 再导出（barrel 文件的核心）----------
export * from './hash.js';                      // 把 hash.ts 的所有具名导出转发出去
export * as hash from './hash.js';              // 收成一个命名空间
export { sha256 } from './hash.js';             // ✅ 只转发指定的（推荐，可控）
export { sha256 as digest } from './hash.js';   // 转发 + 重命名
```

**barrel 文件**（通常叫 `index.ts`）就是一个只做转发的文件，作用是给包一个统一入口：

```ts
// src/index.ts
export { sha256 } from './hash.js';
export { formatAsCsv, formatAsJson } from './format.js';
export type { Options } from './types.js';
```

> ⚠️ barrel 别做得太大：`export *` 会导致引入一个符号就加载整棵依赖树，
> CLI 的启动时间会被拖慢。库的**对外**入口用 barrel，内部代码之间直接 import 具体文件。

---

## 3. `export default` 的争议

大型项目的主流做法是 **只用具名导出（named export）**。理由：

```ts
// 默认导出：导入方可以随便起名，同一个东西在项目里出现三种叫法
import Cli from './cli.js';
import Runner from './cli.js';    // 😱 完全合法，指的是同一个 class
import whatever from './cli.js';  // 😱 也合法
```

| 问题 | 具名导出 | 默认导出 |
| --- | --- | --- |
| 命名一致性 | 强制统一 | 各叫各的 |
| 编辑器自动导入 | 准（知道名字） | 经常猜不出来 |
| 重命名重构（F2） | 全项目跟着改 | 改不动导入方 |
| `export * from` 转发 | 直接转发 | 转发不了，得手写别名 |
| 找引用 / grep | 好找 | 难找 |

**什么时候用 default 是合理的：**

- **CLI 入口 / 单一职责的模块**：整个文件就是一个东西（一个命令、一个中间件）。
- **一些成名的库就是这么设计的**，你只能跟着用：

```ts
import OpenAI from 'openai';      // openai SDK 用的是 default export
const client = new OpenAI();
```

**建议：自己写的代码一律用具名导出，只有 CLI 入口文件例外。**

---

## 4. `import type`：类型和值走两条路

回顾[第 00 章](./00-setup-and-mental-model.md)的心智模型：**类型编译后完全消失**。
那么这行代码编译后会怎样？

```ts
import { Options } from './types.js';   // Options 只是一个 interface
```

`Options` 是类型，删掉后这条 import 里什么都不剩了。老版本 TS 会**自动帮你删掉整条 import**，
但这带来两个问题：① 逐文件转译的工具（esbuild / swc / tsx）不知道 `Options` 是不是类型，
不敢删；② 如果这个文件还有副作用，删了行为就变了。

所以现代方案是让你**显式声明**：

```ts
import type { Options, Level } from './types.js';   // ✅ 纯类型导入，编译后整行消失
import { run } from './runner.js';                  // ✅ 值导入，原样保留

// 内联写法：一条语句里混着值和类型（很常用）
import { type Options, run } from './runner.js';

// 导出侧同理
export type { Options };
export { type Level, run };
```

本项目开了 **`verbatimModuleSyntax`**，它的含义是"`import`/`export` 语句原样保留、
只删 `type` 标记的部分"。因此：

```ts
import { Options } from './types.js';  // ❌ 报错：Options 是类型，必须用 import type
```

好处：

1. 转译器和 `tsc` 行为完全一致，没有惊喜。
2. **能打破循环依赖**：A 要 B 的类型，B 要 A 的类型。用 `import type` 的话两条 import
   编译后都消失了，运行时根本没有环。

```ts
// user.ts
import type { Order } from './order.js';   // ✅ 只要类型，运行时无依赖
export interface User { id: string; orders: Order[] }

// order.ts
import type { User } from './user.js';     // ✅ 同上，不会形成运行时循环
export interface Order { id: string; owner: User }
```

> 记住：**类型的循环依赖是安全的，值的循环依赖会让你在运行时拿到 `undefined`。**

---

## 5. 😱 相对导入必须写 `.js`，即使源文件是 `.ts`

这是新手最崩溃的一点。规则：

```ts
import { sha256 } from './hash';        // ❌ ERR_MODULE_NOT_FOUND（ESM 不做扩展名猜测）
import { sha256 } from './hash.ts';     // ❌ 默认配置下 tsc 直接报错
import { sha256 } from './hash.js';     // ✅ 正确：源文件叫 hash.ts，但这里写 .js
import { readFile } from 'node:fs/promises'; // ✅ 包名/内置模块不用扩展名
```

**为什么？** 两条独立的事实叠在一起：

1. **ESM 规范不做扩展名猜测。** CommonJS 的 `require('./hash')` 会依次尝试
   `hash.js` / `hash.json` / `hash/index.js`，这是 Node 自己加的便利。
   ESM 是浏览器也要用的标准，`import './hash'` 就是字面意思，找不到就是找不到。
2. **`tsc` 不改写你的 import 路径。** 这是 TS 团队的明确设计决定：
   编译器只删类型，不动模块路径。

于是站到**编译输出的视角**看就顺了：

```
源码：src/main.ts   写着 import './hash.js'
              ↓  tsc
产物：dist/main.js  还是   import './hash.js'      ← 而 dist/hash.js 确实存在 ✅
```

如果你写 `./hash.ts`，产物里就还是 `./hash.ts`，而 dist 目录里只有 `hash.js` —— 运行时炸。

**心法：import 路径写的是"编译后那个文件的名字"，不是当前源文件的名字。**

### `tsx` / `vitest` 下的宽松行为

`tsx` 和 `vitest` 都会帮你兜底：写 `./hash.js` 它们会去找 `./hash.ts`，
写 `./hash`（不带扩展名）通常也能跑通。**这是好意，也是陷阱** ——
你本地一路顺畅，等到 `tsc` 编译出 dist 用 `node` 跑，一堆 `ERR_MODULE_NOT_FOUND`。

> 所以哪怕本教程全程用 `tsx`，**也请坚持写 `.js` 后缀**，养成正确的肌肉记忆。

### `allowImportingTsExtensions` 的取舍

TS 5.0 起可以开这个选项，直接写 `./hash.ts`：

| | 优点 | 代价 |
| --- | --- | --- |
| `allowImportingTsExtensions: true` | 路径和真实文件名一致，直觉 | **必须配合 `noEmit: true`**（因为产物路径会错），也就是**放弃用 `tsc` 出包** |

结论：**纯应用**（用 `tsx` 跑，或用 bundler 打包，从不 `tsc` 出 dist）可以开；
**要发布的库**绝对不要开。本教程不开。

---

## 6. ESM vs CommonJS：完整的坑清单

CommonJS（CJS）是 Node 早年自创的模块系统：

```js
// CommonJS 的世界
const path = require('node:path');        // 同步加载，可以写在任何地方
module.exports = { run };                 // 导出就是给一个对象赋值
exports.run = run;                        // 也可以逐个挂
```

ESM 是语言标准：`import`/`export` 是**静态**语法（必须在顶层、会被静态分析），
这也是 tree-shaking 能做的前提。

### `type: "module"` 是总开关

Node 靠**最近的那个 `package.json` 的 `type` 字段**决定 `.js` 文件按哪套解析：

| 文件 | `"type": "module"` | 没有 `type`（默认 commonjs） |
| --- | --- | --- |
| `.js` | ESM | CommonJS |
| `.mjs` | ESM | ESM |
| `.cjs` | CommonJS | CommonJS |
| `.ts` | ESM | CommonJS |
| `.mts` / `.cts` | ESM / CJS | ESM / CJS |

**新项目一律写 `"type": "module"`。** 这是本教程的前提。

### 互操作方向不对称

```ts
// ✅ ESM 可以 import CJS 包（Node 会分析它的 exports 做具名导出模拟）
import lodash from 'lodash';              // CJS 包的 module.exports 变成 default
import { debounce } from 'lodash';        // 简单情况下具名导入也能用

// ❌ CJS 不能 require ESM 包 —— 会抛 ERR_REQUIRE_ESM
//    （Node 22+ 对部分无顶层 await 的 ESM 放宽了，但别指望它）
const chalk = require('chalk');           // 💥

// ✅ CJS 里要用 ESM 包，只能用动态 import（它返回 Promise）
async function main() {
  const chalk = await import('chalk');
}
```

### ESM 里消失的东西

| CommonJS | ESM 替代 |
| --- | --- |
| `__dirname` | `import.meta.dirname`（Node 20.11+） |
| `__filename` | `import.meta.filename` |
| `require('x')` | `import 'x'` 或 `await import('x')` |
| `require.resolve('x')` | `import.meta.resolve('x')` |
| `require.main === module`（判断"是否被直接执行"） | `import.meta.main`（Node 24+）；老版本见下 |
| `module.exports` | `export` |

```ts
// 拿当前文件所在目录（CLI 里读同目录的模板文件、配置文件必用）
const here = import.meta.dirname;                    // ✅ Node 20.11+，最简单

// 老运行时 / 需要兼容时的经典写法：
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here2 = dirname(fileURLToPath(import.meta.url));

// 判断"这个文件是被直接执行，还是被 import 的"（≈ Go 的 func main 惯用法）
if (import.meta.main) {          // Node 24+
  await run();
}
// 兼容写法：
import { argv } from 'node:process';
if (import.meta.filename === argv[1]) {
  await run();
}
```

### 顶层 await 只有 ESM 有

```ts
// main.ts —— ESM 顶层直接 await，不用包一层 async function
const config = JSON.parse(await readFile('./config.json', 'utf8'));
```

这在 CJS 里做不到，是 ESM 最实用的好处之一（[第 06 章](./06-async.md)细讲）。

### 症状 → 原因 → 修法

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `Error [ERR_REQUIRE_ESM]` | 用 `require()` 加载了纯 ESM 包 | 改成 `await import()`，或把你的项目也变成 ESM |
| `Cannot use import statement outside a module` | 文件被当成 CJS 解析了 | `package.json` 加 `"type": "module"`，或文件改名 `.mjs` |
| `ERR_MODULE_NOT_FOUND` + `Did you mean to import "./x.js"?` | 相对导入少写扩展名 | 补上 `.js` |
| `ERR_MODULE_NOT_FOUND: Cannot find package 'x'` | 包真的没装 / 名字拼错 | `pnpm add x` |
| `ERR_UNSUPPORTED_DIR_IMPORT` | `import './lib'` 指向目录 | 写全 `./lib/index.js` |
| `__dirname is not defined in ES module scope` | ESM 里用了 CJS 全局 | 换 `import.meta.dirname` |
| `require is not defined in ES module scope` | 同上 | 换 `import` |
| `Named export 'x' not found`（导入 CJS 包时） | Node 静态分析猜不出该 CJS 包的具名导出 | 先默认导入再取属性：`import pkg from 'x'; const { x } = pkg;` |
| `The requested module does not provide an export named 'default'` | 把具名导出当默认导出导了 | 改成 `import { x } from ...` |

> 练习 5.9 就是把这张表写成一个诊断函数。真实工作里这张表能省你无数小时。

---

## 7. 动态导入 `await import()`

`import()` 是**表达式**，返回 Promise，可以写在任何地方、路径可以是变量：

```ts
// ① 懒加载插件（按名字动态加载，≈ Class.forName + newInstance）
async function loadPlugin(name: string): Promise<{ run(s: string): Promise<string> }> {
  // ⚠️ 路径来自外部输入时必须做白名单校验，否则等于任意代码执行
  const mod = await import(`./plugins/${name}.js`);
  return mod.default;
}

// ② 条件加载：只有真的需要才付出加载成本
async function report(rows: object[], format: string): Promise<string> {
  if (format === 'yaml') {
    const { stringify } = await import('yaml');   // 用不到 yaml 时它根本不会被读盘
    return stringify(rows);
  }
  return JSON.stringify(rows, null, 2);
}

// ③ CLI 启动加速：这是最实用的场景
//    子命令的实现全部懒加载，`mytool --help` 就不用加载 openai SDK 那一大坨
program.command('chat').action(async (opts) => {
  const { runChat } = await import('./commands/chat.js');   // ✅ 只在跑 chat 时加载
  await runChat(opts);
});
```

> 一个 AI Agent CLI 静态 import 整个 `openai` + `zod`，启动可能要 300ms+；
> 全部改成动态导入后 `--help` 能压到 50ms 以内。用户对 CLI 的启动速度非常敏感。

---

## 8. 路径别名：`paths` 只影响类型

厌倦了 `../../../lib/x.js`？TS 提供别名：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  }
}
```

```ts
import { sha256 } from '@/hash.js';    // 类型检查通过 ✅
```

**😱 但是：`paths` 只告诉 `tsc` 去哪找类型，Node 运行时完全不认识 `@/`。**
`tsc` 也不会把它改写成相对路径。所以你必须额外让运行时也认识它：

| 运行方式 | 需要做什么 |
| --- | --- |
| `tsx` | 自动读 `tsconfig.json` 的 `paths`，可用 |
| `vitest` | 在 `vitest.config.ts` 里配 `resolve.alias`（本项目就是这么做的） |
| 打包（tsup / tsdown / esbuild） | bundler 会把别名解析掉，可用 |
| 直接 `node dist/main.js` | ❌ **不行**，需要额外 loader |

**标准方案是 Node 自己的 `imports` 字段**（写在 `package.json` 里，运行时原生支持）：

```json
{
  "imports": {
    "#internal/*": "./dist/internal/*.js"
  }
}
```

```ts
import { sha256 } from '#internal/hash.js';   // ✅ tsc 和 node 都认，不需要任何工具
```

规则：key 必须以 `#` 开头，只有**包内部**能用（外部 import 不到），
所以它天然是"包私有模块"的表达方式 —— 这是 TS 生态里最接近 Java 包级可见性的东西。

> 建议：新项目直接用 `imports`，别用 `paths`。少一层工具依赖。

---

## 9. `exports` 字段：定义包的对外形状

`exports` 是现代 Node 包的核心字段，它同时干三件事：**声明入口、条件分发、封锁内部**。

```json
{
  "name": "@acme/tool",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./formatters": {
      "types": "./dist/formatters/index.d.ts",
      "import": "./dist/formatters/index.js"
    },
    "./package.json": "./package.json"
  }
}
```

对应的使用方式：

```ts
import { run } from '@acme/tool';               // → dist/index.js
import { formatAsCsv } from '@acme/tool/formatters'; // → dist/formatters/index.js
import x from '@acme/tool/dist/internal/db.js'; // ❌ 解析失败：没在 exports 里列出
```

**三条必须记住的规则：**

1. **`"types"` 必须写在每个条件对象的最前面。** Node 会忽略它，但 `tsc` 是**按顺序**
   取第一个匹配的条件 —— 写在 `import` 后面就会被跳过，下游变成"没有类型"。
2. **一旦写了 `exports`，`main` 就只是给古董工具的兜底**，且 `exports` 里没列的路径
   **一律 import 不到**（这叫 encapsulation）。
3. **不要鼓励别人 deep import。** 你以为 `dist/internal/db.js` 是内部实现，
   但如果没有 `exports` 封锁，别人一 import，它就变成了你的公共 API，
   你重构一次就是 breaking change。`exports` 帮你从物理上杜绝这件事。

条件（condition）的常用取值：`types`（给 tsc）、`node`、`import`（被 ESM 加载时）、
`require`（被 CJS 加载时）、`default`（兜底）。解析时**按对象里的书写顺序**取第一个匹配的。

> 练习 5.8 会让你手写一遍这个解析过程，写完就再也不会配错了。

---

## 10. 发布一个 CLI 包

```json
{
  "name": "@acme/mytool",
  "version": "1.0.0",
  "type": "module",
  "bin": { "mytool": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=20.11.0" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "prepublishOnly": "pnpm run build && pnpm run typecheck && pnpm test"
  }
}
```

入口文件第一行必须是 **shebang**：

```ts
#!/usr/bin/env node
// src/cli.ts —— 这一行让操作系统知道用 node 来执行本文件
import { program } from 'commander';

program.name('mytool').version('1.0.0');
await program.parseAsync(process.argv);
```

> `tsc` 会原样保留 shebang（它就是一行注释）。用 tsup/tsdown 时要确认它没被 banner 处理掉。
> 另外 npm 安装时会自动给 `bin` 文件加可执行权限，本地手动跑要自己 `chmod +x`。

**发布前自检：**

```bash
npm pack --dry-run                 # ① 看清会打包哪些文件（最常见的坑：忘了 build，dist 是空的）
npm pack && npm i -g ./acme-mytool-1.0.0.tgz && mytool --help   # ② 本地装一遍试
npm publish --access public        # ③ 发布（scope 包首次发布必须加 --access public）
```

| 机制 | 说明 |
| --- | --- |
| `files` | **白名单**，只有列出的才进包。比 `.npmignore`（黑名单）安全得多，优先用它 |
| `.npmignore` | 黑名单；不存在时 npm 退化用 `.gitignore`。容易漏，不推荐 |
| `prepublishOnly` | `npm publish` 前自动执行，把"忘了 build / 测试挂了还发版"堵死 |
| `npx mytool` | npx 会查本地 `node_modules/.bin` → 没有就临时下载到缓存里执行，不污染全局 |

**打成单文件**：`tsup` / `tsdown`（基于 esbuild/rolldown，一条命令产出 ESM+CJS+`.d.ts`）
适合发库；想产出不依赖 Node 的可执行文件可以看 `node --experimental-sea-config`
（Single Executable Application），但目前体积较大、生态还不成熟。

---

## 11. 依赖治理

```bash
pnpm why lodash          # 谁把它带进来的（≈ mvn dependency:tree / go mod why）
pnpm outdated            # 哪些依赖有新版本
pnpm update --latest     # 升级（会改 package.json 的范围）
pnpm audit               # 已知漏洞扫描（npm audit 同理）
```

**强制统一某个传递依赖的版本**（相当于 Maven 的 `dependencyManagement`）：

```json
{
  "pnpm": {
    "overrides": { "semver": "^7.6.0" }
  }
}
```

**`peerDependencies` 是干什么的**：表达"我需要宿主提供这个依赖，且**全项目只能有一份**"。
典型场景是插件：一个 `vitest` 插件必须和用户装的 `vitest` 是同一个实例，
否则两份实例的内部状态互不认识。

```json
{
  "peerDependencies": { "vitest": ">=3.0.0" },
  "devDependencies": { "vitest": "^4.1.11" }
}
```

（自己开发时需要它，所以 dev 里也装一份；下游安装时用下游自己的那份。）

**锁版本策略**：

| 场景 | 策略 |
| --- | --- |
| 应用 / CLI（最终产物） | `^` 范围 + **提交 lockfile**，CI 用 `--frozen-lockfile` |
| 库（被别人依赖） | 范围尽量宽（`^`），**不要**锁死 patch，否则下游装出重复副本 |
| 安全敏感 | 定期 `pnpm audit` + `overrides` 定点升级 |

---

## 12. `node_modules` 的本质差异：**允许多版本共存**

这是和 Java/Go 最深层的区别，值得单独一节。

| | Java (Maven) | Go (MVS) | Node |
| --- | --- | --- | --- |
| 同一个库的多个版本 | classpath 上**只能有一个**，冲突要靠 shade/relocate | 整个 build 里**只选一个**（最小版本选择） | **可以同时存在多份** |
| 冲突的表现 | `NoSuchMethodError`（运行时炸） | 编译期决策 | 不炸，但**体积膨胀 + 实例不唯一** |

Node 的依赖是**树形**的：

```
node_modules/
├── a/                        (依赖 semver@6)
│   └── node_modules/semver/  ← 6.x
├── b/                        (依赖 semver@7)
│   └── node_modules/semver/  ← 7.x
└── semver/                   ← 你自己直接依赖的 7.x
```

好消息：**没有 classpath 地狱**，A 和 B 各自用自己的版本，谁都不会崩。
坏消息是两个新的问题：

**① 体积**。一个中等 CLI 的 `node_modules` 上千个包、几百 MB 很常见。
pnpm 用硬链接缓解磁盘占用，但打包发布时要靠 bundler 才能瘦身。

**② 实例不唯一 —— 这个会真的咬人：**

```ts
// 你的代码依赖 zod@4，某个库内部依赖 zod@3，于是装了两份
import { z, ZodError } from 'zod';           // 你的那份（4.x）

try {
  await someLibraryThatUsesZod3.parse(input);
} catch (e) {
  console.log(e instanceof ZodError);        // 😱 false！它抛的是【另一份 zod】的 ZodError
}
```

同样的坑还有：两份 `Error` 子类、两份单例（`instanceof` 失败、全局注册表分裂）。

**怎么办：**

- 判断错误类型**别只依赖 `instanceof`**，用鸭子类型：检查 `e.name === 'ZodError'`
  或某个标记字段。（[第 07 章](./07-errors-and-validation.md)会给具体写法。）
- 用 `pnpm why <pkg>` 确认是不是装了多份；确实需要唯一实例时用 `overrides` 收敛到一个版本。
- 写库时把"必须唯一"的依赖声明成 `peerDependencies` —— 这就是 peer 机制存在的根本原因。

---

## 本章练习

```bash
# 1. 打开 exercises/ch05-modules.ts，把所有 TODO 填掉
pnpm test tests/ch05

# 2. watch 模式（改一个存一次自动重跑，推荐）
pnpm vitest tests/ch05

# 3. 卡住了看 solutions/ch05-modules.ts
```

练习覆盖：动态 `await import()`、`import.meta.dirname`（ESM 没有 `__dirname`）、
相对当前文件解析路径、具名导出组织成注册表、`as const` + `Object.freeze`、
npm 包名规格解析、`^` 语义化版本区间、`exports` 字段解析、ESM/CJS 报错诊断。

---

**下一章** → [06 · 异步编程：单线程怎么做并发](./06-async.md)
