<script setup>
// 根组件：路由出口 + 全局日志悬浮窗 + 成就提示。
// 悬浮窗与成就提示放在 <router-view> 之外——任何页面（包括渲染中崩溃的页面）都能用它们，
// 且成就的 SUMMARY/END 时机发生在总结页与「重开」时，挂在单个页面里会漏。
import LogDock from './components/LogDock.vue'
import AchievementToast from './components/AchievementToast.vue'
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
