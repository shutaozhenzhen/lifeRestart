# example-async-mod —— Mod 异步介入逐岁流程（教学样板）

> **默认禁用**（与 `example-mod` 一样没进 `mod-catalog.js` 的启用清单）：教学 Mod 不该悄悄
> 改变所有人的游戏数据。到 `/mods` 手动启用后，轨迹页才会看到它注入的两句话。

## 它演示什么

**唯一一件以前做不到的事**：`await` 完再往**当年**轨迹里塞内容。

在那之前（`AGENTS.md` 边界 ②）的实情是：`life.next()` 是同步函数，三个逐岁钩子走
`emitSync`，async 回调返回的 Promise 被**直接丢弃** —— 于是"某年去后端取一句剧情"
永远晚到一步（UI 早在 `next()` 返回时就做了轨迹快照）。

## 两个文件

| 文件 | 作用 |
|------|------|
| `manifest.json` | `"async": true` + `"asyncHooks": ["onBeforeYear", "onAfterYear"]` —— **opt-in 开关** |
| `code.js` | 两个 `async` 钩子：`await` 一个定时器后把文本塞进当年轨迹 |

```json
{
  "name": "example-async-mod",
  "version": "1.0.0",
  "permissions": ["hooks"],
  "dependencies": ["lifeRestart-data"],
  "async": true,
  "asyncHooks": ["onBeforeYear", "onAfterYear"]
}
```

## `async` / `asyncHooks` 的语义（照抄即可）

- `async` 缺省 **false**：不写它，引擎与前端一切照旧（还是同步 `life.next()`）——这是本能力
  的第一约束，也是它不破坏任何既有复现用例的原因。
- `asyncHooks` 可选：只把列出的**逐岁钩子**按异步等。合法名只有三个：
  `onBeforeYear` / `onYearAdvance` / `onAfterYear`。写别的（例如 `onEventRender`）是
  **manifest 校验硬错误** —— 那两个钩子是抽卡/渲染时机，调用方当场要结果，异步没有意义。
- 不写 `asyncHooks` = 本 Mod 用到的逐岁钩子都按异步等。

## 三条必须知道的边界

1. **超时 3 秒**：单个异步钩子超过 3000ms（可配）→ 记一条 warn（带 Mod 名与钩子名）并
   **继续推进**。慢后端不会把游戏卡死。
2. **抛错/超时都不污染轨迹**：要么整段 await 完成、要么整段被放弃，不会写出半截数据。
   已经发生的同步副作用无法回滚（JS 没有事务），所以钩子里要"先取数据、最后再改"。
3. **批量模拟 / 一致性检查会跳过 `async: true` 的 Mod**（异步 = 不可逐位复现），
   并在 `stats.warnings` / 一致性报告的脚注里写明"跳过了谁、为什么"—— 不许静默丢。

## 怎么自己跑一遍

```bash
# 引擎侧（真跑一局，看注入是否进了当年轨迹）：
cd packages/game-engine
node src/cli/game.cli.js --data ../../../remake/public/data      # 同步路径：看不到异步注入
```

引擎单测里有一条**真跑**的用例：`packages/game-engine/src/mod/async-year-hooks.spec.js` 的
「示例 Mod 真跑一局」——它把这份 code.js 挂到真 Life 上，断言两句话确实进了当年轨迹。

## 随机数与可复现

`nextAsync()` 与 `next()` **共用同一次推进**（`Life.#advanceYear()`），所以同种子下
随机数消耗顺序完全一致、游戏内容逐字节相同。**但**：本 Mod 自己引入的不确定性
（网络、时钟、后端返回的内容）不受引擎保证 —— 这正是 sim/consistency 跳过它的原因。
