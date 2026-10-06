<script setup>
// gameAPI 参考页（/mods/api）
//
// 与制作文档同构：内容在 `utils/mod-doc-api.js`，版式在 `components/DocPage.vue`。
// 这里的 API 条目会被 `utils/mod-doc.spec.js` 拿去与 engines `createGameAPI()` 的**真实键**
// 双向比对 —— 引擎加了 API 而文档没跟上会直接红。
//
// ⚠️ 路由注册顺序：必须在 `/mods/:name` **之前**。
import { onMounted } from 'vue'
import DocPage from '../components/DocPage.vue'
import { MOD_API } from '../utils/mod-doc-api.js'
import { useGameStore } from '../stores/game.js'

// 游戏 store。
const gameStore = useGameStore()

// 进入页面记一条。
onMounted(() => {
  gameStore.pushLog('info', `[UI][docs] 打开 gameAPI 参考（${MOD_API.sections.length} 节）`)
})
</script>

<template>
  <DocPage :doc="MOD_API" />
</template>
