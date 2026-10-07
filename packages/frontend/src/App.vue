<script setup>
// 根组件：路由出口 + 全局日志悬浮窗 + 成就提示。
// 悬浮窗与成就提示放在 <router-view> 之外——任何页面（包括渲染中崩溃的页面）都能用它们，
// 且成就的 SUMMARY/END 时机发生在总结页与「重开」时，挂在单个页面里会漏。
import { onMounted } from 'vue'
import LogDock from './components/LogDock.vue'
import AchievementToast from './components/AchievementToast.vue'
// Mod 界面扩展注册表（2026-10 能力补齐 ③）。
import { useExtensionsStore } from './stores/extensions.js'
import { useGameStore } from './stores/game.js'

// 扩展注册表。
const extensions = useExtensionsStore()
// 游戏 store（只为把排障信息写进日志面板）。
const game = useGameStore()

// #loadExtensions
// 应用启动时装载 Mod 的**静态**界面声明（`manifest.ui`）。
//
// 为什么在这里（与 LogDock / AchievementToast 同级）：
//   · 必须在**开局之前**就装好 —— 主页 / Mod 管理页也要能看到 Mod 加的面板；
//   · 启动时不执行 `code.js`（它需要 Life，且重复执行会让钩子重复注册），
//     所以**运行期注册**（`gameAPI.ui.*`）只会在开一局之后追加进来（两者汇进同一张表）。
//
// 任何失败都只降级为"没有界面扩展"（**不许报错、不许白屏**：这是启动路径）。
onMounted(async () => {
  // 装载（内部全兜底：Mod 目录 404 / 全部禁用 / manifest 写坏都不抛）。
  await extensions.load({ log: { warn: (m) => game.pushLog('warn', m), debug: (m) => game.pushLog('debug', m) } })
  // 装载结果进日志面板（Mod 作者排障的第一手信息）。
  game.pushLog(extensions.errors.length > 0 ? 'warn' : 'info', `[UI][mod-ui] ${extensions.status}`)
  // 坏数据逐条（不静默）。
  for (const e of extensions.errors) game.pushLog('warn', `[UI][mod-ui] ${e}`)
})
</script>

<template>
  <!-- 路由出口 -->
  <router-view />
  <!-- 成就达成提示（全局常驻） -->
  <AchievementToast />
  <!-- 全局日志悬浮窗（常驻，不随路由切换卸载） -->
  <LogDock />
</template>

<style>
/* 全局基础样式 */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: #1a1a2e;
  color: #eee;
  min-height: 100vh;
}
</style>
