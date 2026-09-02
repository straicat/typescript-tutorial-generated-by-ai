# 00 · 环境与心智模型：先搞清楚 TypeScript 到底是个什么东西

> 本章目标：装好环境、能跑起第一个 `.ts` 文件，并且建立**一个正确的心智模型**。
> 这个心智模型比后面十章的语法都重要 —— 90% 的"TS 怎么这么怪"都是因为它没建立。
>
> 本章不配练习（它是环境搭建），但里面的命令请**真的敲一遍**。

---

## 差异清单（先扫一遍这张表）

| 主题 | Java / Go | TypeScript | 危险等级 |
| --- | --- | --- | --- |
| 类型的归宿 | 编到 class 文件 / 二进制里，可反射 | **编译后 100% 消失**，无法反射 | 🔴 高 |
| 编译器 | `javac` / `go build` | `tsc`（但**日常开发根本不用它产物**） | 🔴 高 |
| 运行 | `java -jar` / 静态二进制 | `node`（需要先装运行时，像 JVM） | 🟡 中 |
| 跑单个源文件 | `go run main.go` | `tsx main.ts` | 🟢 低 |
| 构建/依赖描述 | `pom.xml` / `build.gradle` / `go.mod` | `package.json` | 🟡 中 |
| 依赖工具 | Maven / Gradle / `go get` | npm / **pnpm**（本教程） / yarn | 🟡 中 |
| 依赖产物 | `.jar` | npm package（就是一堆源码 + `.d.ts`） | 🟢 低 |
| 依赖存放 | `~/.m2` / `GOPATH/pkg/mod`（全局） | **`./node_modules`（每个项目一份）** | 🔴 高 |
| 依赖锁定 | `gradle.lockfile` / `go.sum` | `pnpm-lock.yaml` / `package-lock.json` | 🟢 低 |
| 编译配置 | 命令行参数 / 插件配置 | `tsconfig.json`（**必须自己调**） | 🔴 高 |
| 类型检查时机 | 编译失败就没有产物 | **类型错了代码照样能跑** | 🔴 高 |
| 测试 | JUnit / `go test` | vitest（本教程） / node:test | 🟢 低 |
| 格式化 | `google-java-format` / `gofmt` | Prettier / Biome（**不是内置的**） | 🟢 低 |

---

## 1. 最重要的心智模型：**类型在运行时完全不存在**

一句话定义：

> **TypeScript = JavaScript + 一套只在编译期存在的类型标注。**

`tsc` 干的事情本质上只有两件：① 检查类型；② **把类型标注全部删掉**，输出 JavaScript。
第二步业内叫 **type erasure（类型擦除）**，但它比 Java 的泛型擦除**彻底得多**。

Java 擦除的只是泛型参数，字段类型、方法签名、注解都还在 class 文件里，所以你能写
`field.getType()`、`Class.forName()`、Jackson 能靠反射把 JSON 映射成对象。

TypeScript 擦除的是**全部类型信息**。看编译前后：

```ts
// 源码 user.ts
interface User {
  id: number;
  name: string;
}

function greet(user: User): string {
  return `hi ${user.name}`;
}

export const admin: User = { id: 1, name: 'root' };
```

```js
// 编译输出 user.js —— interface 整个消失了，参数和返回值的类型也没了
function greet(user) {
  return `hi ${user.name}`;
}
export const admin = { id: 1, name: 'root' };
```

**没有任何 API 能在运行时拿到 `User` 这个类型。** 没有 `typeof User`，没有反射，
没有注解处理器。`interface` 这个词编译后连痕迹都不剩。

### 推论 ①：外部数据必须做**运行时校验**

```ts
interface User {
  id: number;
  name: string;
}

// 😱 这行代码在编译期"完全合法"，运行时毫无检查
const user: User = JSON.parse('{"wat": true}') as User;
console.log(user.name.toUpperCase()); // 💥 TypeError: Cannot read properties of undefined
```

`JSON.parse` 的返回类型是 `any`，你写 `as User` 只是**骗过了编译器**。
Java 里 Jackson 会真的按字段类型解析并报错，TS 里**什么都不会发生**。

所以：**凡是数据从进程外面来（HTTP 响应、配置文件、stdin、LLM 输出、环境变量），
就必须用 `zod` 这类库做一次运行时校验。** 这是 TS 后端开发的铁律，
[第 07 章](./07-errors-and-validation.md)专门讲。

```ts
import { z } from 'zod';

const UserSchema = z.object({ id: z.number(), name: z.string() });
const user = UserSchema.parse(JSON.parse(raw)); // ✅ 不合法直接抛错，且 user 自带类型
```

### 推论 ②：`as` 断言零成本，也零保护

```ts
const n = '42' as unknown as number; // ✅ 编译通过
console.log(n.toFixed(2));           // 💥 运行时炸：字符串没有 toFixed
```

`as` 不是 Java 的 `(User) obj` —— Java 的强制转换会在运行时做 `checkcast` 并抛
`ClassCastException`。**TS 的 `as` 编译后直接消失，是纯粹的"我保证，别管我"。**
它只应该用在你确实比编译器知道得多的地方，而且写一次就欠一次技术债。

### 推论 ③：**类型报错不影响代码能不能跑**

```ts
const port: number = 'oops'; // ❌ tsc 报错
console.log('还是跑起来了:', port); // 但 tsx / node 照样执行，输出 oops
```

这点最反直觉：Java 编译不过就没有 class 文件，Go 编译不过就没有二进制。
TS 世界里**"类型检查"和"能不能运行"是两条独立的流水线**。

所以 CI 里 `tsc --noEmit` 必须是一道独立的、会让流水线变红的关卡 —— 靠"跑起来了"证明不了任何事。

---

## 2. 运行时：先选 Node.js

TS 自己不能跑，它需要一个 JavaScript 运行时，地位相当于 JVM。三个选择：

| 运行时 | 定位 | 什么时候值得考虑 |
| --- | --- | --- |
| **Node.js** | 事实标准，生态 100% 兼容 | **默认选它**。本教程全部基于 Node |
| Deno | 默认原生跑 TS、默认沙箱权限、标准库自带 | 写小工具脚本、看重安全边界时 |
| Bun | 启动和安装极快，自带打包/测试 | 追求启动速度、想少装几个工具时 |

Deno / Bun 都能直接执行 `.ts`（不用 `tsx`），但**它们和 Node 的兼容性差异会在你依赖某个
native 模块时突然咬你一口**。工作中团队协作，先用 Node，等你熟了再评估。

**本教程基准：Node.js >= 20.11，推荐 22 或 24 LTS。**
（20.11 是 `import.meta.dirname` 可用的最低版本，后面第 05 章会用到。）

```bash
node -v    # v24.19.0
```

---

## 3. 安装：版本管理器 + pnpm

### 3.1 用版本管理器装 Node，别用系统包管理器

理由和 Java 一样：不同项目要不同版本。`nvm`（老牌，shell 脚本）或 `fnm`（Rust 写的，快）任选：

```bash
# 方案 A：fnm（推荐，快）
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 24
fnm default 24

# 方案 B：nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 24
nvm alias default 24
```

在项目根放一个 `.nvmrc`（内容就一行 `24`），队友 `fnm use` / `nvm use` 就自动切到同一版本，
作用相当于 Gradle 的 toolchain 声明。

### 3.2 包管理器：用 pnpm

Node 自带 `npm`，但推荐 pnpm。启用方式用 Node 自带的 corepack（不用全局装）：

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

**为什么是 pnpm：**

| | npm / yarn classic | pnpm |
| --- | --- | --- |
| 磁盘占用 | 每个项目复制一份完整依赖 | **全局 store + 硬链接**，10 个项目共用一份 |
| 安装速度 | 慢 | 快（大部分时间只是建链接） |
| 依赖隔离 | 扁平化 `node_modules`，**你能 import 没声明的包** | 严格：只能 import `package.json` 里写了的 |

第三条是关键。npm 的扁平化会让你不小心 `import` 到依赖的依赖，
某天那个传递依赖升级/消失，你的代码就莫名炸掉 —— 相当于 Maven 里到处用 provided 依赖。
pnpm 直接从物理结构上禁止这件事。

---

## 4. 不需要编译就能跑（这点像 `go run`）

Java/Go 的直觉是"先构建，再运行"。TS 的**日常开发完全不走构建**：

```bash
pnpm add -D tsx
./node_modules/.bin/tsx main.ts    # ≈ go run main.go
```

`tsx` 内部用 esbuild 把 TS **转译**成 JS 后直接喂给 Node，几十毫秒的事，
而且**不做类型检查**（下一节详说）。

Node 自己也在原生支持这件事，叫 **type stripping**（只删类型，不做转换）：

| Node 版本 | 现状 |
| --- | --- |
| 22.6+ | `node --experimental-strip-types main.ts`，实验性 |
| 22.7+ | 加 `--experimental-transform-types` 才支持 `enum` / `namespace` 等需要生成代码的语法 |
| 23+ | **默认开启**，直接 `node main.ts` |
| 24 | 已稳定，日常可用 |

```bash
node main.ts        # Node 23+ 直接就能跑
```

⚠️ 原生 type stripping 有两个限制：它**只删不转**，所以 `enum`、`namespace`、
参数属性（`constructor(private x: number)`）这些"需要生成运行时代码"的语法不支持；
而且相对导入必须写扩展名。**本教程统一用 `tsx`**，行为最一致。

---

## 5. 现代工作流：这是**四件独立的事**

从 Java/Go 过来最容易懵的地方：那边 `javac` / `go build` 一个命令包办"检查 + 产出"，
TS 世界里被拆成了四件事，各由不同工具负责：

| 事情 | 工具 | 说明 |
| --- | --- | --- |
| **跑** | `tsx` / `node` | 开发时直接跑源码 |
| **类型检查** | `tsc --noEmit` | ≈ `javac` 的检查部分 + `go vet`，**只报错，不产出文件** |
| **测试** | `vitest` | 内部自带转译，不需要先编译 |
| **打包/发布** | `tsc` 或 `tsup` / `tsdown` | 只有要发布成 npm 包 / 单文件时才需要 |

### 为什么 esbuild / swc / tsx 不做类型检查？

因为**类型检查慢，而且需要"看到整个项目"**。TS 的类型系统要跨文件做推断、
要读 `node_modules` 里所有 `.d.ts`，这是全局操作，几秒到几十秒。
而 esbuild / swc 是**逐文件**工作的：它拿到一个 `.ts` 文件，把类型标注当注释一样删掉，
输出 JS，完事 —— 毫秒级，而且天然可并行。

**结论：转译（transpile）和类型检查（type check）是两个正交的动作。**

```bash
tsx main.ts          # 转译 + 运行，类型错误【不会】拦住你
tsc --noEmit         # 只检查类型，一个字节都不输出
```

所以你的 `package.json` 里这两条必须都有，CI 里也必须都跑：

```json
{
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

> 这也解释了为什么 TS 项目里 `isolatedModules` 这个选项很重要 ——
> 它禁止那些"逐文件转译搞不定"的写法，保证 esbuild 和 tsc 的行为一致。见第 8 节。

---

## 6. 从零建一个项目（完整命令序列）

```bash
mkdir my-cli && cd my-cli

# ① 生成 package.json（-y 跳过交互问答）
pnpm init

# ② 装开发期依赖（编译器 / 运行器 / 测试 / Node 类型声明）
pnpm add -D typescript tsx vitest @types/node

# ③ 装运行期依赖
pnpm add commander zod

# ④ 生成 tsconfig.json
./node_modules/.bin/tsc --init

# ⑤ 写代码
mkdir src && echo 'console.log("hello");' > src/main.ts

# ⑥ 跑起来
./node_modules/.bin/tsx src/main.ts
```

几个和 Maven/Go 对不上的概念：

- **`pnpm add -D`（`--save-dev`）**：装到 `devDependencies`，≈ Maven 的 `<scope>provided/test</scope>`。
  别人 `pnpm add` 你的包时**不会**装上它们。编译器、测试框架、类型声明全都属于这里。
- **`@types/xxx`**：某些库是纯 JS 写的，没有类型。社区把类型声明单独发成 `@types/xxx` 包
  （≈ 给一个没有源码的 jar 补一份接口声明）。`@types/node` 提供 `process`、`node:fs` 等的类型。
  现代库大多自带类型（`zod`、`commander`），就不需要 `@types`。
- **`node_modules` 不进 git**，靠 lockfile 复现。

### 语义化版本与 lockfile

`pnpm add` 写进 `package.json` 的是**范围**，不是精确版本：

| 写法 | 含义 | 允许升到 |
| --- | --- | --- |
| `^4.17.21` | 兼容升级（**默认**） | `<5.0.0`，即 4.x 最新 |
| `~4.17.21` | 只允许 patch | `<4.18.0` |
| `4.17.21` | 锁死 | 只有这一个版本 |
| `*` / `latest` | 任意 | 🔴 别用 |

⚠️ `^0.x.y` 有特例：`^0.2.3` 只允许升到 `<0.3.0`（0.x 阶段 minor 也视为破坏性变更）。

`pnpm-lock.yaml` 记录**整棵依赖树的精确版本 + 完整性哈希**，作用完全等价于 `go.sum`：

```bash
pnpm install          # 有 lockfile 时按 lockfile 装
pnpm install --frozen-lockfile   # CI 必用：lockfile 与 package.json 不一致就直接失败
```

**lockfile 必须提交进 git。** 这点和 `go.sum` 一样，没有例外。

---

## 7. `package.json` 逐字段

```json
{
  "name": "@acme/my-cli",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "bin": { "my-cli": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=20.11.0" },
  "scripts": { "build": "tsc -p tsconfig.build.json" },
  "dependencies": { "zod": "^4.5.4" },
  "devDependencies": { "typescript": "^5.9.3" },
  "peerDependencies": { "typescript": ">=5.0.0" }
}
```

| 字段 | 作用 | Java/Go 对照 |
| --- | --- | --- |
| `name` | 包名，可带 scope（`@acme/x`）。私有项目加 `"private": true` 防误发布 | `groupId:artifactId` / module path |
| `version` | 语义化版本 | `<version>` |
| **`type`** | `"module"` = 这个包里的 `.js` 按 **ESM** 解析；不写就是 CommonJS | 无对应物，🔴 最容易踩 |
| `main` | 入口文件（老字段，给不认识 `exports` 的老工具兜底） | 无 |
| `exports` | **现代入口声明**：条件导出、子路径导出，且**没列出的路径别人 import 不到** | ≈ Java 9 module-info 的 `exports` |
| `bin` | 声明可执行命令名 → 文件映射，装上后能直接敲命令 | jar 的 `Main-Class` |
| `files` | 发布时**只**打包哪些路径（白名单，比 `.npmignore` 可靠） | jar 打包配置 |
| `scripts` | 命令别名，`pnpm run x` 执行 | Makefile / Gradle task |
| `engines` | 声明需要的 Node 版本（pnpm 默认会强制检查） | `maven.compiler.source` / `go 1.22` |
| `dependencies` | **运行期**需要，会被下游一起装 | `compile` scope |
| `devDependencies` | 只有开发/构建/测试需要 | `test`/`provided` scope |
| `peerDependencies` | "我需要宿主提供它，但**别装两份**"（插件对宿主框架） | `provided` scope |

`exports` / `bin` / `type` 这三个字段是第 05 章的重头戏，这里先有个印象。

---

## 8. `tsconfig.json` 逐项讲解

这是本教程用的配置（`tutorials/typescript/tsconfig.json`），逐项拆开：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",

    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,

    "baseUrl": ".",
    "paths": { "@exercises/*": ["exercises/*.ts"] },
    "types": ["node"]
  },
  "include": ["exercises", "solutions", "tests", "examples", "*.ts"]
}
```

| 选项 | 作用 | 怎么选 |
| --- | --- | --- |
| `target` | 输出的 JS 语法级别（≈ `--release 21` / `-target`） | 服务端跑在自己控制的 Node 上，尽量高：`ES2023` |
| `lib` | 提供哪些**内置 API 的类型**（`Array.prototype.at`、`Object.hasOwn`…） | 只写 `["ES2023"]`。**别加 `"DOM"`** —— 那会把一堆浏览器 API 的类型引进来，服务端项目用不到还容易误用 |
| `module` | 生成/期望哪种模块语法 | Node 项目一律 `nodenext` |
| `moduleResolution` | 怎么**找**模块（认不认 `exports` 字段、要不要写扩展名） | 跟着 `module` 写 `nodenext` |
| `noEmit` | 只检查，不产出文件 | 开发/CI 检查用 `true`；发布库时另开一份配置设 `false` |
| `isolatedModules` | 禁止"逐文件转译搞不定"的写法 | **必开**。保证 tsx/esbuild/vitest 和 tsc 行为一致 |
| `verbatimModuleSyntax` | `import`/`export` 语句**原样保留**，因此只用于类型的导入必须写 `import type` | **必开**，见第 05 章 |
| `resolveJsonModule` | 允许 `import config from './x.json'` | 需要读内置 JSON 时开 |
| `skipLibCheck` | 跳过 `node_modules` 里 `.d.ts` 的内部检查 | **必开**。不开的话别人库里的类型错误会变成你的编译错误，还慢 |
| `strict` | 一次打开全部严格检查（见下） | 🔴 **必开**。老项目才谈渐进开启 |
| `noUncheckedIndexedAccess` | `arr[0]` 的类型变成 `T \| undefined` | 建议开。这才是**真实**行为（越界不抛异常，返回 `undefined`） |
| `noImplicitOverride` | 覆盖父类方法必须写 `override` 关键字 | 建议开，≈ Java 的 `@Override` 强制化 |
| `noFallthroughCasesInSwitch` | `case` 忘写 `break` 就报错 | 建议开 |
| `noImplicitReturns` | 函数有的分支 return 有的不 return 就报错 | 建议开 |
| `baseUrl` + `paths` | 路径别名（`@exercises/x` → `exercises/x.ts`） | 谨慎用：**它只影响类型解析，不影响运行时**，见第 05 章 |
| `types` | 自动加载哪些全局类型包 | 写 `["node"]`：只要 Node 的全局，避免被别的包污染 |
| `include` | 检查范围 | 列目录即可 |

`strict: true` 一次性打开的子项（都很重要）：

| 子项 | 含义 |
| --- | --- |
| `strictNullChecks` | `null`/`undefined` 不能随便赋给别的类型 —— **`strict` 里最值钱的一项**，相当于强制 Optional |
| `noImplicitAny` | 推断不出类型时报错，不许静默变 `any` |
| `strictFunctionTypes` | 函数参数类型逆变检查 |
| `strictBindCallApply` | `bind`/`call`/`apply` 的参数也检查 |
| `strictPropertyInitialization` | class 字段必须初始化（≈ Java 的 final 字段检查） |
| `useUnknownInCatchVariables` | `catch (e)` 里 `e` 是 `unknown` 而不是 `any` —— 强迫你先判断再用 |
| `alwaysStrict` | 输出 `"use strict"` |

### 推荐配置 A：Node CLI / Agent 项目（不发布，自己跑）

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

配套：`tsx src/main.ts` 跑，`tsc --noEmit` 检查，`vitest` 测试。不需要 `outDir`。

### 推荐配置 B：要发布到 npm 的库

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,

    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

差异点：`target` 保守一点（下游可能用老 Node）；必须 `declaration: true` 产出 `.d.ts`
（不然别人用你的包就没有类型）；`sourceMap` 让下游能调试到你的 TS 源码；
`include` 只含 `src`，**测试文件不要打进发布产物**。

---

## 9. 本教程项目的结构与常用命令

```
tutorials/typescript/
├── docs/                 # 教程正文
├── exercises/            # 👈 你填空的地方（函数体是 TODO）
├── solutions/            # 参考答案
├── tests/                # vitest 用例，判定你写得对不对
├── examples/cli/         # 完整的 CLI 小项目
├── examples/agent/       # 完整的 Agent 小项目
├── package.json
├── tsconfig.json
└── vitest.config.ts      # 靠 alias 在 exercises / solutions 之间切换
```

| 想干什么 | 命令 |
| --- | --- |
| 装依赖 | `pnpm install` |
| 跑全部练习（一开始应该全红） | `pnpm test` |
| 只跑某一章 | `pnpm test tests/ch01` |
| watch 模式（改一次自动重跑） | `pnpm vitest tests/ch01` |
| 看参考答案是否全绿 | `pnpm test:solutions` |
| 类型检查 | `pnpm typecheck` |
| 直接跑任意 `.ts` | `pnpm ex docs/snippets/hello.ts` |

---

## 10. 编辑器：VS Code 就够了

TS 支持是 **VS Code 内置**的（TS 本身就是微软的），不用装 TS 插件。要装的只有
Prettier / Biome 做格式化。

**必须会的三个操作：**

```ts
// ① hover 看类型：把光标放到变量上，弹出的就是编译器推断出的类型
const result = [1, 2, 3].map((x) => ({ id: x }));   // hover result → { id: number }[]

// ② Ctrl+. （Quick Fix）：TS 的报错大多带自动修复
//    "缺少 import" / "改成 import type" / "加上缺失的属性" 都能一键搞定

// ③ 想看清一个复杂类型：临时写一行 type 断点
type _Debug = ReturnType<typeof someComplexFunction>;   // hover _Debug 看展开结果
```

### `@ts-expect-error` vs `@ts-ignore`

两个都能压制下一行的类型错误，但**永远用前者**：

```ts
// @ts-expect-error 这里故意传错类型来测试运行时防御
greet(123);

// @ts-ignore
greet(123);
```

区别：如果那一行**其实没有错误**，`@ts-expect-error` 会报"你标了但没错误"，
`@ts-ignore` 则静默通过。也就是说 `@ts-expect-error` 会随着代码修好而自动提醒你删掉它，
`@ts-ignore` 会永远烂在代码里。

> 在测试里故意传非法值（模拟外部脏数据）是 `@ts-expect-error` 最正当的用途。

---

## 下一步

环境好了，心智模型也有了。现在只要记住一句话就够本章的本了：

> **类型只在编译期存在。运行时的安全，必须靠运行时的代码来保证。**

继续往下走，从最容易踩坑的基础语法开始 —— `number` 只有一个、`null` 有两个、
`if` 里能放任何东西。

---

**下一章** → [01 · 基础语法：先看和 Java / Go 不一样的地方](./01-basics.md)
