# demo-runtime-mod —— Mod 带外部 npm 依赖（**运行时**加载，零构建）

这个示例演示**一个 Mod 如何携带并使用外部 npm 依赖**，全程在运行期解析，
**没有任何构建步骤、没有编译器静态内联**。

## 三步（都在运行期）

| # | 做什么 | 在哪体现 |
|---|--------|----------|
| 1 | 依赖以**自包含单文件**随包分发 | `vendor/fflate.mjs`（32KB，0 个外部说明符） |
| 2 | 在 manifest 里声明 | `"modules": { "fflate": "vendor/fflate.mjs" }` |
| 3 | 引擎在执行 `code.js` **之前**加载它，并注入同步的 `require(id)` | `code.js` 里 `const { zipSync } = require('fflate')` |

```powershell
cd packages/game-engine
node src/cli/mod.cli.js examples                                   # 浏览器侧 code.js 用依赖做出 zip
node src/cli/mod.cli.js examples --call 'demo-runtime-mod:zipRoundTrip:{"text":"hi"}'   # Node 侧同用
node src/cli/mod.cli.js examples --call demo-runtime-mod:whereIsDep                     # 证明依赖来自包内 vendor
```

## 为什么必须"自包含单文件"

因为引擎执行 Mod 的方式**没有模块系统**，而运行时解析模块需要一个 URL：

| Mod 来源 | 引擎拿到的形态 | 后果 |
|----------|----------------|------|
| HTTP（服务器目录） | 文件有 URL | 一个文件一次 `import()` |
| **IndexedDB（zip 安装）** | **只有 `blob:` URL** | `blob:http://…/uuid` **没有目录基准** → 依赖内部的相对导入（`./inner.js`）会解析成不存在的 `blob:http://…/inner.js` → **必断** |

所以规矩是：**一个依赖 = 一个自包含文件**（内部不能再有相对导入）。
`fflate.mjs` 正是这种产物 —— 从 CDN 拿一次即可：

```powershell
# esm.sh 的 ?bundle 模式返回指向自包含单文件的 re-export
(Invoke-WebRequest 'https://esm.sh/fflate?bundle').Content
#   → export * from "/fflate@0.8.3/es2022/fflate.bundle.mjs"
# 再把那个 .bundle.mjs 存成 vendor/fflate.mjs（实测 32266 字节、0 个外部说明符）
```

## 两侧的写法不一样（这是真实差异，不是遗漏）

| 侧 | 写法 | 为什么 |
|----|------|--------|
| 浏览器 `code.js` | `const { zipSync } = require('fflate')` | 它由 `new Function('gameAPI', 'require', code)` 执行，**没有模块系统**；`import()` 是语法、无法被注入覆盖，所以引擎只能预加载 + 注入同步 `require` |
| Node `server.js` | `import { zipSync } from './vendor/fflate.mjs'` | 它由**原生 `import()`** 加载，本来就是真 ESM 模块 → 相对路径导入天然可用 |

**两侧共用同一个 `vendor/fflate.mjs`**，所以依赖只分发一份。

## 边界

| 情况 | 行为 |
|------|------|
| 声明了 `modules` 但文件不存在 | 加载期报错（带 Mod 名与路径），一路带到日志报告里，**不静默** |
| 用了 `require` 但没在 `manifest.modules` 声明 | 报错并点明正确做法（不会只丢一个 `require is not defined`） |
| 打包时带上 `node_modules/` 目录树 | zip 安装时忽略并提示：依赖应放 `vendor/` 单文件并在 `manifest.modules` 里声明 |
| 依赖内部有相对导入（多文件包） | **浏览器侧会失败**（blob 无目录基准）；Node 侧可以。请用单文件产物 |
| 依赖含原生插件（`.node`）/ `.wasm` | **不支持** —— zip 只收文本（`.json/.js/.mjs/.txt/.md`） |
| 第三方许可证 | **实测：esm.sh 的产物不含上游许可证声明**（文件头只有 `/* esm.sh - fflate@0.8.3 */`）→ `vendor/` 里要**同时放一份该依赖的 LICENSE**，见 `vendor/fflate.LICENSE.txt`（zip 收 `.txt`，所以它能随 Mod 一起分发） |
