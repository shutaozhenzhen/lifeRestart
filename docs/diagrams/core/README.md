# v2 内核图表集（3 张 Graphviz 图）

**位置**：`lifeRestart/docs/diagrams/core/`（v2 分支的仓库内文档）。
**入库内容**：`.dot` 源 + `.svg` 矢量图 + 本 README。**PNG 不入库** —— 它是本地产物（渲染预览用），已由**仓库根 `.gitignore`** 的 `docs/diagrams/**/*.png` 排除；需要时按下面「渲染」一节自己生成。

**为什么与 v1 的图表集分开**：根目录 `_图表_架构与流程/` 记录的是 **`main` 分支（v1）** 的架构 —— 相对路径目录 + `manifest.json` + `code.js` + `gameAPI` + 5 张数据表。`v2` 是**孤根分支**（与 `main` 无共同祖先），内核换成了「零游戏语义的推进核 + 门面式 Mod 契约」，两边的同名概念（钩子、Mod、状态）**是不同实现**，画进同一套图会把那边的「关键不变量」搅乱。所以 v2 单独成集。

三张图覆盖 v2 内核的全部机制，对应代码 `packages/{core/src,mods/base,frontend}`（8 个源文件、61 个 `node --test` 用例）。

| # | 图 | 回答什么问题 | 主要代码锚点 |
|---|----|--------------|--------------|
| v2-01 | 模块结构与边界 | v2 分几层？Mod 能碰到什么、碰不到什么？ | `core/src/{runtime,clock,ctx,state,rng,bus,json}.js`、`mods/base/index.js`、`frontend/app.js` |
| v2-02 | 一年时序与短路 | `advance()` 一年到底按什么顺序做了什么？`ctx.end()` 与抛错分别怎么收场？ | `core/src/clock.js` 的 `advance()` / `callHook()`、`ctx.js` 的 `guard()` |
| v2-03 | Mod 契约与快照 | 写一个 Mod 要导出什么？`ctx` 给哪些方法？存档是什么形状、读档校验哪几步？ | `core/src/ctx.js`、`runtime.js` 的 `snapshot()` / `load()`；规范 `docs/superpowers/specs/2026-10-18-core-design.md` §7.3 |

## 逐图解读

### v2-01 · 模块结构与边界

四层，从外到内：

1. **内容层 · Mod** —— `packages/mods/base/index.js` 22 行就是**全部内容**（`manifest` + `init` + `onYear` + `dispose`）。"换一套玩法"= 换 `createRuntime({ mods })` 的数组，不需要改引擎。
2. **宿主层** —— `runtime.js` 负责排序（显式 `order` → `requires` 拓扑 → id 字典序）、冲突检测、快照/读档；`clock.js` 负责一年的三段推进与错误隔离。
3. **边界层 · 门面** —— `ctx.js` 冻结对象，Mod 只能经它读写状态、取随机数、发事件；`guard()` 把"只能在钩子里做事"变成抛错而不是静默失效。
4. **基础设施** —— `state`（单一 JSON 树 + 点路径 + 变更日志）、`rng`（sfc32，状态 4 个整数 → 存档即续跑）、`bus`（唯一输出通道）、`json`（只允许 JSON 值）。**这四个都不对外**，Mod 拿不到本体。

图里两块 note 是这套设计的落脚点：右下「引擎零游戏语义的机器守卫」（`no-semantics.test.js` 用 grep 断言 `core/src` 的非注释代码不含 `constitution`/`talent`/`death`/`achievement` 等词）、左下「边界清单」（Mod 拿不到 state/bus/rng 本体、`Math.random`、`Date.now`、文件系统、网络、玩家输入、钩子之外的时机）。

### v2-02 · 一年时序与短路

按 `clock.js` 的 `advance()` 走：已结束直接返回 → `boot()`（`init` 只跑一次）→ `year += 1`（**在钩子之前**，所以钩子读到的 `ctx.year` 已是新年）→ 三段 `onYearBefore/onYear/onYearAfter` × 逐 Mod **严格串行 await** → 无条件 `emit year:end` → 返回。

三条容易记错的语义都在图上：

- **`ctx.end()` 短路**：结束标志一置位，当年余下的 Mod 与后续两个阶段全体跳过（但是 `year:end` 仍会发）。
- **错误隔离**：单个钩子抛错只发 `core:error { phase, message }` 并继续下一个 Mod（`failFast: true` 才重新抛）；**只留 message 不留 stack**，因为 stack 含绝对路径会让同 seed 的 hash 跨机器不一致。
- **横切守卫**：`activeId` 只在该 Mod 自己的钩子里等于它；钩子外（定时器/Promise 回调里）调 `ctx.set` 会抛「会破坏确定性」。

右侧 note 解释了**为什么必须串行**：三个钩子共享同一棵 state 树，`onYear` 写的值 `onYearAfter` 要读；并发执行会让"谁先谁后"变成非确定性。

### v2-03 · Mod 契约与快照

四张表 + 一条「约束」虚线：

- **Mod 契约**：`manifest` 必需（`id` 唯一 / `name` / `version`，可选 `order` 缺省 `Infinity`、`requires[]`），六个钩子全部可选。
- **ctx 门面**：`year` / `get` / `set` / `update` / `keys` / `rng.int|float|pick|weighted` / `emit` / `log` / `end` 共 12 项，一个不多。
- **快照**：`{ version, seed, rng[4], year, ended, reason, state, mods[] }` —— `JSON.stringify` 即完整存档。
- **load 校验顺序**：版本 → seed 一致 → year → rng 形状 → Mod 集合 `id@version` 逐个一致 → 才动内部；**任一步失败运行时保持原样**（有 I2 用例）。
- **三条硬约束**：① 守卫（钩子外调用抛错）② 冲突检测（同年同路径不同 Mod → `core:conflict`，只报不拦）③ 错误隔离（去 stack）。

## 渲染

在仓库根（`lifeRestart/`）执行；需要 Graphviz（本机 `dot -V` = 16.1.0），中文字体 `Microsoft YaHei`（Windows 自带 `msyh.ttc`）：

```powershell
$dot = 'C:\Users\13588\scoop\shims\dot.exe'   # 或 PATH 里的 dot
Get-ChildItem docs/diagrams/core -Filter *.dot | ForEach-Object {
  & $dot -Tsvg $_.FullName -o "$($_.DirectoryName)/$($_.BaseName).svg"           # 入库
  & $dot -Tpng -Gdpi=130 $_.FullName -o "$($_.DirectoryName)/$($_.BaseName).png" # 本地预览，不入库
}
```

- **入库的只有 `.dot` + `.svg`**（矢量图能无损缩放，体积也小：三张 SVG 合计约 69 KB，对应 PNG 约 866 KB）。
- 本地想快速看图就渲染 PNG；它已被仓库根 `.gitignore` 排除，不会意外提交。
- **只改 `.svg` 不改 `.dot` 视为漏改**（`.dot` 是源，`.svg` 是产物）。

## 画图硬规则（这批图踩到的）

1. **中文靠 `fontname="Microsoft YaHei"`**；换平台要换字体，否则 PNG 出方块。
2. HTML-like label 里的 `&` 必须写 `&amp;`；**`<FONT>` 不支持 `BGCOLOR`** —— 表头/徽章底色要用 `<TD BGCOLOR>`（v2-03 四张表的标题行就是这么做的）。
3. **两列版式要用 `{ rank=same; A; B }` 显式指定**：v2-03 最初用 `rankdir=LR` 平铺四张表，结果被拉成 **3572×894** 的细条、字号缩到看不清；改成 TB + 两行 `rank=same` 后是 2322×1607。
4. **尽量别画反向边**：v2-03 原来有一条 `load → ctx`（读档后重建）的虚线，横穿整张图；现在把它写进表格第 6 步（"重建 clock 与全部 ctx"）而不画箭头。
5. **校验文字是否真的进了图**时要注意：Graphviz 的 SVG 会把空格写成 `&#160;`、连字符写成 `&#45;`、并且逐行拆成多个 `<text>`。按原字符串 grep 会假阴性（本轮 `no-semantics.test.js` 就误报过一次），要先去掉 HTML 实体与空白再比子串。
6. 长标签里换行用 `\n`。带引号的 label（`label="..."`）里 `{` `}` `|` `<` `>` 都是字面量，可直接写；只有 **HTML label**（`label=<...>`）里才需要处理标记语法。

## 改代码 → 改哪张图

| 改动 | 要同步的图 |
|------|------------|
| 新增/修改 Mod 钩子或 `ctx` 方法 | v2-03（契约表）+ v2-02（若落在某一段时序里） |
| 改 `advance()` 的推进顺序、短路语义、错误策略 | v2-02 |
| 改排序规则、冲突检测、快照字段、`load` 校验 | v2-03（快照/约束）+ v2-01（分层归属） |
| 新增 core 模块或改变"谁不对外" | v2-01 |
| 前端从"只渲染事件流"变成参与逻辑 | v2-01（frontend 节点）+ v2-02（若引入逐岁交互） |

## 生成元信息

- Graphviz `dot` 16.1.0；SVG 为默认矢量输出；PNG（本地）为 `-Gdpi=130`
- PNG 尺寸（本地渲染参考）：v2-01 `2351×1697`、v2-02 `1836×2156`、v2-03 `2322×1607`
- 生成日期：2026-10-31，对应 `v2` 分支 `HEAD`（27 个跟踪文件，`packages/core` 61 个测试全过）
