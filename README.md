# 人生重开模拟器 · Mod 内核重写版（AI 驱动）

把原版《人生重开模拟器》（`lifeRestart`）重写为**「以 Mod 为内核」**的架构：游戏规则、数据、AI 生成内容全部以 Mod 形式接入，
引擎只提供条件求值、参数系统、事件/天赋调度与钩子协议。纯 JavaScript 引擎 + Vue 3 前端 + AI 集成（OpenAI 兼容协议），
并提供 CLI 原型、桌面 / Web / 移动端打包。

## 特性

- **Mod 即内核**：manifest 校验、依赖拓扑排序、加载器、`gameAPI` 钩子（可注册参数 / 天赋 / 事件 / 成就 / AI 注入），内置 Data Mod
- **condition 引擎（新语法）**：条件即原生 JS 表达式，构建期用 `convertLegacy()` 把原版旧语法一次性转换为新语法，运行时不再解析旧语法
- **参数即配置**：`param` 注册表（local / derived / storage / function / special 类型分发 + 函数体编译 + 循环依赖检测）
- **AI 集成**：AI 客户端（OpenAI 协议）+ 输出校验器 + `createAIMod` 工厂 + 零依赖代理服务（多模型路由 / SSE 流式 / CORS / mock）
- **可观测**：五级日志系统（trace 记录每个函数全部参数）+ 函数追踪 + 注入式 sink + 游戏流水（journal，供 AI 上下文）
- **同 seed 可复现**：`export` 导出轨迹、跨平台一致性校验（进程内 / node 子进程 / Electron 运行时 diff 为零）
- **可玩原型优先**：全部功能都有 CLI 可玩/可验证入口，无需前端

## 目录结构

```
lifeRestart/
├── packages/
│   ├── game-engine/            # 引擎内核（无框架依赖，纯 JS + Vitest）
│   │   ├── src/condition/      # condition 引擎：新语法求值 + 旧语法转换（compat.js）
│   │   ├── src/params/         # 参数注册表 + 内置参数 JSON 定义
│   │   ├── src/modules/        # property / talent / event / achievement / character / life 编排器
│   │   ├── src/mod/            # Mod 系统：manifest / 依赖拓扑 / loader / gameAPI / manager / datamod
│   │   ├── src/ai/             # AI 客户端 / 输出校验器 / createAIMod / 代理服务（ai-proxy）
│   │   ├── src/functions/      # logger（五级日志 + traceFn）、random、journal 等
│   │   ├── src/cli/            # 全部 CLI 原型（见下）
│   │   ├── src/fixtures/       # 测试用最小数据集
│   │   └── server.js           # AI 代理服务（零依赖 Node http）
│   └── frontend/               # Vue 3 + Pinia + Hash 路由（页面流转 + Mod 管理页 + 设置页）
│       └── public/data/        # 运行期数据（原版 JSON，Data Mod 转换产物）
├── mods/                       # 内置 Mod：base-mod / fun-mod / ai-mod（lifeRestart-data 由 CLI 生成）
├── platforms/
│   ├── electron/               # 桌面版：主进程起代理 + 窗口 + electron-builder 打包
│   ├── web/                    # 单进程静态站 + 内嵌代理（产出解压即运行的 zip）
│   └── mobile/                 # Capacitor 壳（脚手架，需 Android SDK）
├── pnpm-workspace.yaml
└── package.json
```

## 环境要求

- **Node.js ≥ 20**（开发验证于 v24）
- **pnpm**（monorepo workspace；可用 `corepack pnpm`）
- 仅引擎与测试无需浏览器；前端需 `vite`，桌面/移动打包需额外工具链

## 快速开始

```bash
cd lifeRestart
pnpm install

# 全量测试（递归跑 packages/* 与 platforms/*）
pnpm test

# 或单独跑
cd packages/game-engine && pnpm test     # 引擎 529 用例
cd packages/frontend    && pnpm test     # 前端 13 用例（异常回归）
```

## CLI 原型

所有 CLI 均支持 `--log-level <trace|debug|info|warn|error>`（`trace` 会输出引擎内部函数参数追踪）。
以下命令的工作目录均为 `packages/game-engine/`。

```bash
# 基础能力演示
node src/condition/cli.js                                   # condition 工具（check / convert / props）
node src/cli/property.cli.js                                # 属性系统
node src/cli/talent.cli.js   [--seed <n>]                   # 天赋系统（抽卡 / 池管理）
node src/cli/event.cli.js                                   # 事件系统
node src/cli/game.cli.js     [--seed <n>] [--locale zh-cn|en-us]   # 整合可玩版

# 轨迹与数据
node src/cli/export.cli.js   --seed <n>                     # 轨迹导出（同 seed 可复现）
node src/cli/data-mod.cli.js --data <dir> --out <modsDir>   # 原版 JSON → Data Mod 落盘
node src/cli/mod.cli.js <modsDir>                           # Mod 加载器（依赖图 / 钩子演示）

# AI 链路
node src/cli/ai-game.cli.js  --mods <dir> [--mock-ai] [--seed <n>] [--journal <file>]  # AI 可玩版
node src/cli/smoke.cli.js    --mods <dir> [--mock-ai] [--seed <n>]                     # 同 seed 关/开 AI 双跑 diff
node src/cli/export-ai.cli.js --journal <file> --out <dir>                             # AI 生成结果导出为 Mod（闭环）

# 跨平台一致性
node src/cli/consistency.cli.js --seed <n> [--mods <dir> --mock-ai] [--electron <bin>]
```

示例：

```bash
cd packages/game-engine

# 1) 原版数据（remake 的 xlsx→json 产物，含 {zh-cn,en-us}/）打包为 Data Mod
node src/cli/data-mod.cli.js --data ../../../remake/public/data --out ../../mods
#    → 规模约 age 501 / talents 184 / events 1720 / achievements 165 / characters 100
#    （前端 packages/frontend/public/data/ 即同一转换产物，已入库，clone 后无需重新生成）
node src/cli/mod.cli.js ../../mods            # 加载验证（依赖图 / 钩子）

# 2) 无需 API Key，用 mock AI 跑一局 AI 版
node src/cli/ai-game.cli.js --mods ../../mods --mock-ai --seed 42
```

## 浏览器 UI

```bash
# 终端 A：启动 AI 代理（可选，测 AI 连接时需要）
cd packages/game-engine && node server.js [--mock] [--port <n>]

# 终端 B：启动前端（端口 3000）
cd lifeRestart && pnpm --filter frontend dev
```

页面流转：`/` → `/talent` → `/property` → `/game` → `/summary`，另有 `/mods`（Mod 管理）与 `/settings`（日志等级 + 实时日志面板）。
AI 连接测试经 vite 代理 `/ai-proxy` 转发到本地代理服务。

## 平台打包

```bash
# 桌面版（Electron：主进程起代理 + 窗口；electron-builder 打包 exe）
cd platforms/electron && npx electron . --smoke    # 冒烟
                       pnpm dist                   # 打包

# Web 版（单进程：静态资源 + 内嵌代理，产出解压即运行的 zip）
cd platforms/web && node scripts/build.js          # → release/liferestart-web.zip

# 移动版（Capacitor 脚手架，需 Android SDK）
cd platforms/mobile && pnpm build && pnpm android:add && pnpm android:open
```

## 架构要点

| 模块 | 说明 |
|---|---|
| `src/condition/` | 新语法即原生 JS 表达式，唯一注入 `params.`（如 `params.CHR > 5 && params.TLT.includes("talent_001")`）；`compat.js` 负责旧语法构建期转换 |
| `src/params/` | 注册表按类型分发 + `function` 类型函数体编译 + 循环依赖检测；`property.js` 的 get/set/change 全部委托注册表，Mod 可定义新参数且条件引擎自动可见 |
| `src/mod/` | manifest 校验 → 依赖拓扑 → 执行 `code.js` 并注入 `gameAPI`；支持 zip 安装、权限声明、开关与 Data Mod |
| `src/ai/` | OpenAI 协议客户端 + 输出校验器 + `createAIMod` 工厂 + 代理服务（provider 路由 / SSE 流式 / CORS / mock） |
| `src/functions/logger.js` | 五级日志 + `traceFn()` 函数追踪 + 注入式 sink；引擎各子模块通过 `child()` 派生带前缀日志器 |
| `src/functions/journal.js` | 每岁 content 持久化的游戏流水，作为 AI 上下文来源 |

## 测试

| 位置 | 用例数 | 覆盖 |
|---|---|---|
| `packages/game-engine` | 529 | condition / compat / params / 各模块 / mod / ai / cli / data-loader |
| `packages/frontend` | 13 | 前端异常回归：markRaw 私有字段、引擎页守卫、Mod 状态持久化、日志链路 |
| `platforms/electron` | 5 | 桌面版主进程/打包逻辑 |
| `platforms/web` | 7 | Web 版构建与内嵌代理 |

源码为**逐行中文注释**。

## 进度

- **阶段一 ~ 四（Step 1–22）**：全部完成 —— 引擎内核、Vue 前端 UI、Mod 系统、AI 集成（含代理服务）
- **阶段五（平台打包 Step 23–26）**：Step 23（Electron）/ 24（Web）/ 26（跨平台一致性）完成；Step 25（Capacitor 移动端）为脚手架，待 Android SDK 环境验证

## 数据来源与许可

- 本项目代码以 **MIT License** 发布，详见 [LICENSE](./LICENSE)。
- 游戏数据（`talents` / `events` / `age` / `achievements` / `characters`）与剧情文本衍生自
  [VickScarlet/lifeRestart](https://github.com/VickScarlet/lifeRestart)（**MIT License, Copyright (c) 2021 神戸小鳥**），
  在此保留原作者版权声明。
