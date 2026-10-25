# 人生重开模拟器 v2 —— 内核设计（推进核 + Mod 宿主）

- 分支：`v2`（**无共同祖先**的孤儿分支，从 0 实现）
- 日期：2026-10-18
- 状态：待批准

## 1. 意图

现引擎 `packages/game-engine` 约 13k 行（不含测试），其中真正不可替代的只有一件事：
**按年推进**。其余（六张表、事件、天赋、成就、条件 DSL、结算、AI、CLI、i18n、文档站）
都是内容或工具，却被写进了引擎内部，导致：

- 前端 29 个文件深度引用 `game-engine/src/mod/*` 等内部路径，没有公共边界；
- 引擎与前端各有一套 Mod 运行时，一致性靠文本级契约测试维持；
- 状态互相踩、改动无处追踪，出问题只能靠读代码。

**目标形态**：引擎 = 确定性调度器 + 状态容器 + Mod 宿主，**不懂任何游戏语义**；
一年的内容完全由 Mod 的钩子产生。仓库在新分支上从零实现，旧实现留在 `main` 作为
行为参考（不合并、不迁移代码）。

## 2. 目标

- **G1** 引擎（`packages/core`）只负责：年份自增、按序调用 Mod 钩子、维护状态、提供随机源与输出通道。
- **G2** 一局可**确定性复现**：同一 seed + 同一 Mod 集合 ⇒ 同一状态快照。
- **G3** 状态变更**可追踪**：每次写入记录 `{year, path, modId}`，冲突当场暴露。
- **G4** 浏览器里用一套最小内容 Mod 就能完整玩一局（出生 → 逐年 → 死亡 → 结算）。

## 3. 非目标（本期不做）

- Electron 桌面端、Web 单进程打包、APK（平台壳后置，先保证浏览器可玩）。
- AI 生成内容、在线 Mod 安装/文档站、i18n、命令行批量模拟（`sim`/`cli`）。
- 旧存档兼容、旧 Mod 的 API 向后兼容（后续可用 shim 单独做）。
- 性能优化（如并行批量跑局）。

## 4. 反目标（出现即视为设计失败）

- **A1** 引擎源码里出现游戏语义（`constitution`/`talent`/`death`/`achievement` 等词）。
- **A2** 存档依赖墙钟、`Math.random`、遍历顺序不确定的对象。
- **A3** Mod 通过共享可变对象互相踩状态，且无法定位是谁改的。
- **A4** 引擎为了"方便"提供 `ctx.state` 之类的原始引用。

## 5. 约束

- **C1** 目标运行环境含 Termux/Android：一切代码只在 `/data` 下执行；`/storage` 无法加载原生模块，仅作只读参考。
- **C2** 单机、无后端。浏览器端不引入服务端依赖。
- **C3** ESM only；`packages/core` **零运行时依赖**，测试用 `node --test`（不自带 vitest 依赖）。
- **C4** 钩子可返回 Promise，但**每年严格串行 await**（确定性优先）。
- **C5** 前端仍然 Vue + Vite（零成本延续），但**只读 state、只消费事件流**。

## 6. 备选方案与选择

| 方案 | 内容 | 取舍 |
|---|---|---|
| A 裸 VM | `for (m of mods) m.onYear(ctx)`，ctx 是普通对象 + `Math.random` | 最简（~150 行），但存档只能深拷贝、无法回放、冲突不可查 |
| **B 受控总线（已选）** | ctx 只有 `get/set/update/keys/rng/emit/log/end`；state 只存 JSON；写入追踪；RNG 种子化 | 多 ~350 行，换来存档/回放/测试/冲突定位 |
| C 只搬不重构 | 把 `modules/` 等下沉成官方 Mod，保留现 gameAPI | 改动最小，但边界没变 |

选择 **B**，且钩子采用 **(a) 纯副作用式**：一年 = 按序调用各 Mod 的 `onYear`，
Mod 自己读改状态、自己输出文案；引擎不解释"体质"是什么。

## 7. 已决定的设计

### 7.1 包结构

```
packages/core/src/
  clock.js      advance()：年份自增、三段钩子、错误隔离
  state.js      KV 容器：点路径、JSON 校验、变更日志、快照
  rng.js        sfc32：状态可序列化，存档即续跑
  bus.js        emit/log：事件流（唯一输出通道）
  ctx.js        门面：每个 Mod 一个实例，锁死内部对象
  runtime.js    宿主：加载、依赖排序、生命周期、全局副作用检测
packages/mods/base/      属性、逐年规则、死亡判定（内容）
packages/frontend/       Vue 渲染：只读 state + 消费事件流
```

### 7.2 一年时序

```js
async advance() {
  year += 1
  for (const m of mods) await m.onYearBefore?.(m.ctx)
  for (const m of mods) await m.onYear?.(m.ctx)
  for (const m of mods) await m.onYearAfter?.(m.ctx)
  emit('year:end', { year })
  return ended ? 'ended' : 'running'
}
```

`ended` 只能由 `ctx.end(reason)` 置位 —— 这是引擎唯一理解的语义（类似 `process.exit`）。

### 7.3 ctx 契约（引擎对外唯一接口）

```js
ctx.year                          // 只读数字
ctx.get(path)                     // 点路径读取，返回深拷贝
ctx.set(path, value)              // 写；值必须 JSON 可序列化，否则抛错
ctx.update(path, fn)              // 原子读改写
ctx.keys(prefix)                  // 前缀枚举
ctx.rng.int(n) / float() / pick(xs) / weighted(entries)   // 唯一随机源
ctx.emit(kind, payload)           // 输出事件
ctx.log(text)                     // = emit('log', { text })
ctx.end(reason, detail?)          // 宣告结束
```

**不提供**：state 原始对象、`Math.random`、`Date.now`、文件系统、网络。
`runtime` 在开发模式检测 Mod 直接使用 `Math.random`/`Date.now` 并告警。

### 7.4 状态：全局共享 + 命名前缀（我的判断，可推翻）

state 是**单一 JSON 树**，路径一律 `namespace.key`，namespace 取 Mod id：
`base.attrs.constitution`、`base.age`。理由：跨 Mod 协作零成本，读取不需要额外 API。
代价：靠约定防污染；用变更日志 + 同年同路径双写告警补偿。

**替代方案**（若你更看重隔离）：每 Mod 独立命名空间，读别人必须 `ctx.read('base', path)`。

### 7.5 存档与回放

```json
{ "version": 1, "seed": "...", "rng": [s1,s2,s3,s4], "year": 37,
  "state": { ... }, "mods": [{ "id": "base", "version": "0.1.0" }] }
```

- 快照 = `year + rng 状态 + state`，因为 state 只含 JSON，`JSON.stringify` 即完整存档。
- 回放判据：同 seed、同 Mod 集合，跑 N 年到快照的 hash 必须一致（黄金测试）。
- 变更日志用于调试与冲突检测，不进入存档。

### 7.6 事件流与前端渲染契约

首期只有四种 kind：`log`（叙事文本）、`stat`（属性变化提示）、`stage`（人生阶段切换）、
`year:end`。前端按 kind 渲染；**Mod 永远不碰 DOM**。`manifest.ui` 之类声明式 UI 本期不做。

### 7.7 Mod 生命周期与隔离

`init(ctx)` → 每年三段钩子 → `dispose()`。钩子抛错：记录并 `emit('core:error')`，
默认**继续**（一局不因单个 Mod 崩溃而丢），开发模式可设为 fail-fast。

## 8. 留给构建者的判断（已按此执行）

- 事件 payload 暂不做 schema 校验，只要求 JSON。
- 冲突检测粒度：同一 `(year, path)` 被两个 Mod 写入 → `emit('core:conflict')`。
- 前端首版只做三屏：开局、逐年、结算（不做动画与主题）。

## 9. 验收标准

1. 不加载任何 Mod 跑 100 年：产出 100 条 `year:end`，不崩。
2. `packages/core` 源码中 grep 不到语义词（脚本自动断言）。
3. 同 seed 跑两次，快照 hash 相同；换 seed 则不同。
4. `base` Mod 在浏览器中完整玩一局（出生 → 死亡 → 结算）。
5. `core` 自带测试覆盖：调度顺序、JSON 校验、RNG 确定性、快照往返、错误隔离、冲突告警。

## 10. 风险

- **R1** Mod 是任意 JS，`Math.random` 只能检测不能根治 → 约定 + lint。
- **R2** 全局 KV 的路径命名靠人守，写错就退化回"互相踩"。
- **R3** 旧实现 `main` 冻结后不再修 bug，若 v2 迟迟不能玩，仓库会有一个长期不可用的分支。
