<script setup>
// Mod 制作文档页（/mods/docs）
//
// 这一层只做两件事：把内容数据交给公共渲染组件 + 记一条 UI 日志。
// 内容与渲染分别在 `utils/mod-doc-guide.js`（数据，可单测）与 `components/DocPage.vue`（版式）里，
// 这样"改文档"不会碰到页面逻辑，"改版式"也不会碰到内容。
//
// ⚠️ 路由注册顺序：必须在 `/mods/:name` **之前**（否则 `docs` 会被当成一个 Mod 的目录名）。
import { onMounted } from 'vue'
import DocPage from '../components/DocPage.vue'
import { MOD_GUIDE } from '../utils/mod-doc-guide.js'
import { useGameStore } from '../stores/game.js'

// 游戏 store（页面行为进日志面板）。
const gameStore = useGameStore()

// 进入页面记一条（常显日志，便于排错时确认"用户看的是哪份文档"）。
onMounted(() => {
  gameStore.pushLog('info', `[UI][docs] 打开 Mod 制作文档（${MOD_GUIDE.sections.length} 节）`)
})
</script>

<template>
  <DocPage :doc="MOD_GUIDE" />
</template>
