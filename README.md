# 人生重开模拟器 · Mod 内核重写版（AI 驱动）

把原版《人生重开模拟器》（`lifeRestart`）重写为**「以 Mod 为内核」**的架构：游戏规则、数据、AI 生成内容全部以 Mod 形式接入，
引擎只提供条件求值、参数系统、事件/天赋调度与钩子协议。纯 JavaScript 引擎 + Vue 3 前端 + AI 集成（OpenAI 兼容协议），
并提供 CLI 原型、桌面 / Web / 移动端打包。

> 🌐 **在线试玩**：<https://shutaozhenzhen.github.io/lifeRestart/>（GitHub Pages，纯静态；AI 增强不可用，详见下文）

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
├── mods/                       # 内置 Mod：base-mod / fun-mod / ai-mod / lifeRestart-data（均已入库）
├── platforms/
│   ├── electron/               # 桌面版：主进程起代理 + 窗口 + electron-builder 打包
│   ├── web/                    # 单进程静态站 + 内嵌代理（产出解压即运行的 zip）
│   └── mobile/                 # Capacitor 壳（CI 现场生成 Android 工程并打 debug APK）
├── pnpm-workspace.yaml
└── package.json
```

## 环境要求

- **Node.js ≥ 20**（开发验证于 v24）
- **pnpm 11.28.2**（monorepo workspace；版本由根 `package.json` 的 `packageManager` 字段固定，
  可用 `corepack enable` 后直接使用 `pnpm`）
- **跑测试不需要 pnpm**：根 `scripts/test-all.mjs` 用 Node 直接编排各包的 vitest（有 Node/npm 即可）
- 仅引擎与测试无需浏览器；前端需 `vite`，桌面/移动打包需额外工具链

## 快速开始

```bash
cd lifeRestart
pnpm install

# 全量测试（一条命令跑完成 workspace 内所有测试包；不依赖全局 pnpm）
pnpm test                   # 等价于 node scripts/test-all.mjs
node scripts/test-all.mjs   # 没有 pnpm 的环境用这条（npm test 亦可）

# 只跑单个包（参数按目录名/包名子串匹配）
node scripts/test-all.mjs game-engine   # 引擎 643 用例（35 spec）
node scripts/test-all.mjs frontend      # 前端 208 用例（25 spec：纯逻辑 + 组件/页面 + 真实数据全流程）
node scripts/test-all.mjs mobile        # 移动端 39 用例（脚本 + CI 不变量）

# 带参数透传给 vitest：`--` 之后的参数原样传给 vitest（不改包过滤）
node scripts/test-all.mjs game-engine -- -t 属性页先读数
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
node src/cli/simulate.cli.js --runs 30 --seed 42 [--mods ../../mods] [--json]  # 批量模拟（随机天赋+随机属性）
node src/cli/simulate.cli.js --runs 30 --talents 1001,1002 --alloc CHR=3,INT=4,STR=5,MNY=8 \
       --mods ../../mods --format md --out report.md   # 固定特性+固定属性，导出 CSV/JSON/Markdown

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
#    （mods/lifeRestart-data 与 packages/frontend/public/data 为同一转换产物，
#      均已入库，clone 后无需重新生成；仅在重新转换原版数据时才需要执行上一条命令）
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

**轨迹页**（`/game`）：顶部为紧凑状态栏（年龄/生命 + 五维属性一行胶囊），下方是**逐年完整轨迹列表**
（每年一岁一条，事件/天赋/天赋替换分类着色，新条目逐条入场并自动跟随最新，向上翻会暂停跟随、可点「回到最新」）。
支持**自动播放**（慢 1.6s / 正常 0.8s / 快 0.3s，进页面即开始，人生结束自动停，速度写入 localStorage），
也可手点「下一年」。

**全局日志悬浮窗**（右下角，任意页面常驻，含渲染崩溃的页面——它挂在路由出口之外）：
出现 error 级日志（含 `window` 未捕获异常、Vue 渲染异常）会自动展开并亮角标；
一键**复制**或**下载**报告（`liferestart-log-YYYYMMDD-HHmmss.txt`），报告含页面地址、路由、UA、视口、
游戏与 Mod 状态以及全部日志（缓冲上限 1000 条）。快捷键 `Ctrl+Shift+L` 随时收放。

**总结页**（`/summary`）：属性评价（总评 / 最高年龄 / 五项最高值，带「普通·优秀·极佳」分档）、
收集统计（成就达成数 `n / 总数`、成就达成率、天赋选择率、事件收集率——比率统一显示为百分比）、
成就列表（165 条，固定高度滚动区），以及本局**随机种子**（复制 / 「用此种子再来一局」）。
统计项的标签与格式化集中在 `src/utils/statistics-view.js`：**引擎新增统计项而这里没登记会被测试直接拦住**
（`RACHV` 就曾因两份手写清单漏配而在页面上裸显示成 `RACHV 0.006060606060606061`）。
重开次数、达成成就、已见事件带 `lifeRestart:` 前缀写入 localStorage，**跨局累积**
（重开次数在点「↻ 重开」时 +1）。引擎 `storage` 未注入时会退回内存实现，这些数据会恒为空。

**成就达成提示**：达成成就时右上角弹出提示卡（🏆 成就达成 + 名称 + 描述 + 星级），**4 秒自动消失**、
也可点击关闭；同一条成就不堆叠，最多同时显示 3 条。因为成就的触发时机有四种
（`START` 开局 / `TRAJECTORY` 逐年 / `SUMMARY` 开总结页 / `END` 点重开），提示做成**全局组件**
挂在 `App.vue`（与日志悬浮窗同级），所以任何页面都不会漏。链路：
引擎 `achieve()` → `emit('achievement', 成就对象)` → `store.handleEngineEvent()` → `store.achievementToasts`
→ `components/AchievementToast.vue`；同时记一条 `[UI][achievement] 达成成就：xxx` 进日志（报告可核对）。

**随机种子与复现**：每局开始都会分配一颗 **32 位种子**（主页可留空自动生成，也可手填旧种子），
所有随机（天赋抽卡、事件抽取、RDM 效果）都来自 `createRng(seed)` —— **同种子 + 同样选择 = 同一局人生**。
种子的显示位置：主页输入框、轨迹页状态栏（点一下复制）、总结页（复制 / 「用此种子再来一局」）、
日志报告头部（`随机种子 : xxx（填入主页种子框可复现同一局）`）。

**模拟统计页**（`/simulate`，新增「模拟系统」）：**按策略批量跑 N 局并聚合输出结果**
——寿命分布直方图、总评分档、属性均值（终局 / 历史最高）、收集率、最佳一局（含天赋名称与分配明细）。
**策略两条轴各自可随机或固定**：特性（随机抽卡 ／ 从全部天赋里挑最多 3 个做控制变量实验）、
属性（随机分配 ／ 手填四项）。支持局数档位（10/30/50/100 + 自定义）、随机种子（可复现）、
**快速模式**（演示数据，毫秒级一局）、运行进度（局/秒 + 预计剩余）与**随时停止**（保留已完成部分的聚合）；
结果可**导出 CSV / JSON / Markdown**（Markdown 可直接贴进 issue，JSON 供脚本二次分析）。

固定策略的两条硬约束（都有一致行为与测试）：固定特性里**不存在的 ID 会被剔除**、全无效则回退随机，
并在结果与报告里给 ⚠ 警告（不静默）；固定属性**超出可用点数时按比例缩减**到正好用完（单项不超上限）并警告。

> 性能：真实数据下**单局 0.3~1.5 秒**（老年阶段每年要判几百个事件条件，寿命越长越慢），
> 所以页面按局分批执行、批间让出主线程，并对 `condition` 加了**编译缓存**（见下）。
> 想快速看分布就勾「快速模式」。CLI 等价入口见下方 `simulate.cli.js`（支持 `--talents` / `--alloc` / `--format` / `--out`）。

## 在线版（GitHub Pages）

线上试玩：**<https://shutaozhenzhen.github.io/lifeRestart/>**

纯静态部署（`packages/frontend` 的 Vite 构建产物），由 [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml)
在推送到 `main` 时自动构建并发布（也可在 Actions 页手动 `workflow_dispatch` 触发）。

| 项 | 说明 |
|---|---|
| 路由 | Hash 模式（`#/xxx`），静态托管无需 404 回退 |
| 资源路径 | `vite.config.js` 设 `base: './'`，`HomeView` 数据请求基于 `import.meta.env.BASE_URL`，兼容 `https://<user>.github.io/<repo>/` 子路径 |
| 数据 | `packages/frontend/public/data/` 随构建复制进产物（约 3.9 MB，Pages 自动 gzip） |
| **AI 功能** | **不可用**：Pages 只托管静态文件，没有 Node 运行时，`/ai-proxy` 不可达。游戏本体完全可玩，仅 AI 增强关闭；如需 AI，构建时设 `VITE_AI_PROXY` 指向自建代理（逻辑见 `packages/game-engine/server.js`） |

部署前置：仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（一次性）。

> ✅ lockfile 已用 pnpm 11.28.2 重算（补齐 `packages/frontend` 的 `vitest` 依赖），
> 两个 workflow 均使用 `pnpm install --frozen-lockfile`。
> 日后再改依赖时的正确姿势：在**没有 `node_modules` 的干净目录**里执行 `pnpm install --lockfile-only`
> 重算 lockfile（pnpm 在已有 `node_modules` 时只对照自己的安装记录，**不会**改写仓库 lockfile），
> 提交后才能继续保持冻结安装。

## 平台打包

```bash
# 桌面版（Electron：主进程起代理 + 窗口；electron-builder 打包 exe）
cd platforms/electron && npx electron . --smoke    # 冒烟
                       pnpm dist                   # 打包

# Web 版（单进程：静态资源 + 内嵌代理，产出解压即运行的 zip）
cd platforms/web && node scripts/build.js          # → release/liferestart-web.zip

# 移动版（Capacitor：把前端产物同步到 www/，再生成 Android 工程打 debug APK）
cd platforms/mobile
pnpm build                       # 前端产物 → www/（已构建过则直接复用，--rebuild 可强制重建）
node scripts/collect-apk.js      # 可选：把 APK 收集到 out/liferestart-mobile-debug.apk（CI 用）
pnpm android:add && pnpm android:sync && pnpm android:open
# 需要 JDK 21（Capacitor 7 / AGP 8.11+）；CI 里由 .github/workflows/release-test.yml 的 mobile job 全程执行
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

## 随机种子与复现

### 算法：mulberry32（`src/functions/util.js` 的 `createRng(seed)`）

公有领域的 32 位 PRNG，约 5 行；本项目用它统一驱动所有随机：

```
状态 a ← seed >>> 0                                    // 种子进入算法的唯一入口
每次调用：
  a = (a + 0x6D2B79F5) | 0                             // 推进状态（黄金比例增量，均匀遍历 2^32）
  t = Math.imul(a ^ (a >>> 15), 1 | a)                 // 位混淆第一轮
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t       // 位混淆第二轮（雪崩）
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296         // 32 位整数 → [0,1)
```

为什么选它：

| 性质 | 说明 |
|---|---|
| **确定性** | 同 `seed` + **同一调用顺序** → 完全相同的序列（这就是"复现"的基础） |
| 周期 | **2³²**（约 43 亿个数），远超一局人生（几千次抽取）与批量模拟（几十万次） |
| 速度 | 纯整数运算，无查表/浮点累加；单局上百年的模拟开销可忽略 |
| 分布 | 统计质量足够支撑游戏判定与蒙特卡洛；**非密码学安全**（不要用于密钥/令牌） |
| 独立性 | 一个实例一条流；要"互不影响的独立流"就用不同 seed 或多个实例 |

代价与注意：
- **调用顺序即契约**：多抽一次卡、少掷一次骰子，后面的序列就全变了。所以复现要求
  "同种子 + 同样的选择"（例如天赋池抽取后选同样的那几张）。
- `seed` 会被规范化为 32 位无符号整数（`normalizeSeed`：负数/小数/字符串都能安全转换，
  空值与非法值 → 视为"未指定"而自动生成，不会把 `NaN` 传进 `createRng`）。
- 批量模拟里**同一个种子 RNG 同时注入 Life（游戏内随机）与策略层（抽天赋/分属性）**，
  否则"相同种子"仍会跑出不同人生（见 `sim.createSimulation`）。

### 复现路径

1. 主页「随机种子」留空 → 每局自动生成；填上一局的种子 → 直接复现。
2. 轨迹页状态栏显示当前种子（点击复制）；总结页显示种子 + 「用此种子再来一局」
   （同种子重开 → 抽卡顺序与上一局一致，再做出同样的选择即可复现整局）。
3. 日志报告头部带上种子，因此**用户把报告贴过来，就等于把那一局带过来了**。
4. CLI/模拟：`--seed 42` 固定种子；`node src/cli/simulate.cli.js --seed 42 --runs 30` 结果可复现。

## 测试

| 位置 | 用例数 | 覆盖 |
|---|---|---|
| `packages/game-engine` | 643 | condition（含**编译缓存**）/ compat / params / 各模块 / mod（含 **zip 读写**与**HTTP 文件源**）/ ai / cli / data-loader / **sim（策略 + 模拟内核 + 导出器 + CLI）** / util（**种子 RNG 与规范化**） |
| `packages/frontend` | 208 | 纯逻辑（日志/自动播放/storage/mods-state/**Mod 运行时与 zip 安装**/**数据加载**/**模拟驱动器**/**统计展示**）+ **7 个页面 + 1 个公共组件测试** + **真实数据全流程集成** + **种子复现闭环（真实数据）** |
| `platforms/electron` | 5 | 桌面版主进程/打包逻辑 |
| `platforms/web` | 7 | Web 版构建与内嵌代理 |
| `platforms/mobile` | 39 | 前端产物同步（复用/强制重建/残缺即失败）、APK 收集（**递归查找 + 固定文件名 + 找不到就失败**）、**CI workflow 不变量**（JDK 21 / 平铺上传 / 递归收集 / `--latest`） |
| **合计** | **902** | 由 `node scripts/test-all.mjs` 逐包编排（5 个包全部参与） |

### 前端测试分层（2026-10 补齐）

| 层次 | 文件 | 说明 |
|---|---|---|
| 接线契约 | `src/life/create-life.spec.js` | 应用侧构造 Life 的**唯一入口**（`src/life/create-life.js`）：断言空参 `config()` 下 summary/statistics 非空、remake 前可读点数、注入 storage 后跨实例保留 |
| 全流程集成 | `src/router/flow.spec.js` | 真实路由 + 真实组件 + 真实 store 走完 主页→天赋→属性→轨迹→总结；含"死亡后不再推进""总结页无 —""重开次数落盘"等历史 bug 的端到端回归 |
| 页面组件 | `src/views/*.spec.js` | 7 个 view 各自的行为与数据契约（点数/天赋选择/状态栏/自动播放/评价与统计/日志等级/Mod 开关与 AI 配置） |
| 公共组件 | `src/components/LogDock.spec.js` | 悬浮窗：角标、自动展开、过滤、复制/下载、清空、快捷键 |
| 纯逻辑 | `src/utils/*.spec.js`、`src/stores/game.spec.js` | 注入式依赖，Node 环境即可跑 |

- 组件测试用 **happy-dom** + `@vue/test-utils`：在文件首行加 `// @vitest-environment happy-dom` 即可
  （默认仍是 node 环境，纯逻辑用例不受影响）。
- 公共装置见 `src/test-utils/setup.js`（fixture 数据、内存 localStorage、fetch 打桩、`mountView` 复用当前 pinia）；
  **真实数据**加载见 `src/test-utils/real-data.js`（直读 `public/data/*.json`，node 环境也能用）。
- **数据选择原则**：涉及「种子是否生效 / 能否复现 / 寿命分布」这类结论的用例**一律用真实数据**
  （501 年龄 / 184 天赋 / 1720 事件），fixture 只用于接线类快速用例——fixture 只有 4 个候选天赋、
  每个年龄单一事件，随机性几乎不可观测（只看得到顺序）。全流程集成测试的主流程也跑真实数据。
- 断言原则：页面测试断言**值/文案/状态**，而不是"没抛异常"。

源码为**逐行中文注释**。测试在 CI 中自动执行：`.github/workflows/test.yml`（push/PR 触发，
`pnpm install --frozen-lockfile` + `pnpm test`），与 Pages 部署 workflow 相互独立。
另有 `.github/workflows/release-test.yml`：每次 push 重建唯一的滚动 `test` release
（网页版 zip / Web 单进程 zip / 桌面 exe / **移动 apk**）。

> `platforms/mobile/release-workflow.spec.js` 会**对 release workflow 本身做结构断言**——打包链路的问题
> 不会在单元测试里暴露（它们只在 CI 里、且在"绿灯"的状态下发生）。已经踩过的三个坑都固化成了断言：
> `--prerelease` 导致 release 在侧栏与 `/releases/latest` 都看不到、`continue-on-error` 让产物缺失被绿灯掩盖、
> 以及 upload-artifact v4 的压缩根规则让 APK 落到子目录后被平铺通配符静默漏掉。

## 进度

- **阶段一 ~ 四（Step 1–22）**：全部完成 —— 引擎内核、Vue 前端 UI、Mod 系统、AI 集成（含代理服务）
- **阶段五（平台打包 Step 23–26）**：Step 23（Electron）/ 24（Web）/ 26（跨平台一致性）完成；Step 25（Capacitor 移动端）**CI 已能真实产出 debug APK**（ubuntu runner + JDK 21 现场 `cap add android` + `gradlew assembleDebug`，产物随滚动 test release 发布）；**App 内嵌 AI 代理（nodejs-mobile）尚未实现**，当前 APK 只含 WebView 前端
- **GitHub Pages 在线版**：已上线 <https://shutaozhenzhen.github.io/lifeRestart/>（阶段五延伸，纯静态托管；AI 不可用）
- **工程化基线（2026-09-30）**：lockfile 重算 + 全流程 `--frozen-lockfile`；根目录 `pnpm test`
  不再依赖全局 pnpm；新增测试 CI；上游 `remake` 已重构为 TS monorepo（数据路径未变，Data Mod 无需重转）
- **可观测性与轨迹页（2026-10-01）**：全局日志悬浮窗（任意页面一键导出报告，含 `window` 未捕获
  异常与 Vue 渲染异常；缓冲上限 1000、`Ctrl+Shift+L` 收放）；轨迹页改为逐年完整轨迹 + 自动播放
  （三档速度、结束自动停）。同时修复：属性分配页白屏（`#initialData` 未初始化）、死亡后仍继续推进
  （`markRaw` 实例 + `computed` 非响应式依赖 → 缓存 `false`）、`doEvent(null)` 记 warn 刷屏；
  根测试入口支持 `--` 透传带值参数（如 `-t <pattern>`）

## 数据来源与许可

- 本项目代码以 **MIT License** 发布，详见 [LICENSE](./LICENSE)。
- 游戏数据（`talents` / `events` / `age` / `achievements` / `characters`）与剧情文本衍生自
  [VickScarlet/lifeRestart](https://github.com/VickScarlet/lifeRestart)（**MIT License, Copyright (c) 2021 神戸小鳥**），
  在此保留原作者版权声明；第三方归属与转换说明详见 [NOTICE](./NOTICE)。
