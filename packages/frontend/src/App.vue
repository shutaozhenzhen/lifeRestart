<script setup>
// 根组件：路由出口。
// 所有页面都渲染在 <router-view> 中。
</script>

<template>
  <!-- 路由出口 -->
  <router-view />
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
