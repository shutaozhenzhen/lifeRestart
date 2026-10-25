# 人生重开模拟器 v2（内核重写）

**这个分支（`v2`）与 `main` 没有共同祖先。** 旧实现完整保留在 `main`，只作行为参考，不合并、不移植代码。

## 这是什么

一个**确定性推进核 + Mod 宿主**：引擎只会"把年份加一，然后按顺序问每个 Mod 这一年发生了什么"，
不认识任何游戏概念（没有"体质"、没有"天赋"、没有"死亡判定"——这些全在 Mod 里）。

当前内容只有一个 **最小 `base` Mod**，它只有两个事件：**无事发生** 和 **死亡**。
这一版的目标是**证明内核跑得通**，不是复刻玩法。

## 跑起来

```bash
# 测试（46 个，零依赖，node 22+）
cd packages/core && node --test

# 浏览器（无需安装任何依赖）
cd /data/data/com.termux/files/home/git/lifeRestart-v2
python3 -m http.server 8000
# 打开 http://localhost:8000/packages/frontend/ ，填 seed，点开始
```

## 结构

```
packages/core/src/
  rng.js       种子化 RNG（sfc32），状态可序列化 —— 存档即续跑
  json.js      只接受 JSON 可序列化的值
  state.js     点路径 KV：可追踪变更、深拷贝快照
  bus.js       事件总线（引擎与 Mod 唯一的输出通道）
  ctx.js       Mod 门面（get/set/update/keys/rng/emit/log/end），内部引用全锁死
  clock.js     推进核：before → on → after 三段钩子，逐 Mod、严格串行 await
  runtime.js   Mod 宿主：顺序解析（order → requires → id）、冲突检测、快照/读档
packages/mods/base/   最小内容：无事发生 / 死亡
packages/frontend/    零依赖静态页：开局 / 逐年 / 结算
```

## 设计约束（详见 docs/superpowers/specs/）

- **State 只存 JSON**：写函数、`NaN`、循环引用当场抛错。
- **随机只走 `ctx.rng`**：同 seed + 同 Mod 集合 ⇒ `state + 事件流` 的 hash 完全一致。
- **Mod 不碰 DOM**：只能 `emit` 事件，由前端渲染。
- **引擎不含游戏语义**：`packages/core/src` 的非注释代码由测试断言不含 `talent`/`grade`/`constitution` 等词。
- **本期不含**：玩家选择、AI、i18n、CLI、Electron、APK、存档界面。

## 文档

- 设计：`docs/superpowers/specs/2026-10-18-core-design.md`
- 计划：`docs/superpowers/plans/2026-10-18-core-v2.md`
