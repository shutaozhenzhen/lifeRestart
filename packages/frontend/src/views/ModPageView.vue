<script setup>
// ModPageView — 渲染 Mod 通过 `manifest.ui.pages`（或 `gameAPI.ui.addPage`）注册的页面
// 路由：`/mods/page/:id`（**必须注册在 `/mods/:name` 之前**，否则会落到 Mod 数据详情页，
// 与 `/mods/docs`、`/mods/api` 是同一个坑）。
//
// 三种"看不到内容"的情况都要给**可读的空态**（不许白屏、不许抛）：
//   1. 页面 id 不属于任何 Mod（Mod 已卸载 / 已完全移除 / id 写错）；
//   2. 页面属于某个 Mod，但那个 Mod **当前未启用**（enabled=false 或被完全移除）；
//   3. 页面属于某个 Mod、Mod 也启用了，但声明没能载入（manifest.ui 校验没过 → 看日志面板）。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
// 扩展注册表（启动时装好 manifest 声明；运行期注册也会汇进来）。
import { useExtensionsStore } from '../stores/extensions.js'
// 游戏 store（动作按钮的可点性）。
import { useGameStore } from '../stores/game.js'
// 内容块渲染器（**与文档页同一个**）。
import DocBlocks from '../components/DocBlocks.vue'
// 动作查找与触发。
import { hasAction as hasModAction, triggerAction } from '../utils/ui-actions.js'

// 路由（:id）。
const route = useRoute()
// 返回按钮。
const router = useRouter()
// 扩展注册表。
const ext = useExtensionsStore()
// 游戏 store。
const game = useGameStore()

// 页面 id（路由参数可能是数组，统一取字符串）。
const pageId = computed(() => String(route.params.id ?? ''))

// 命中的页面声明（含来源 Mod 名）。
const page = computed(() => ext.findPage(pageId.value))

// 找不到时的原因文案（纯函数，store 里）。
const missingReason = computed(() => ext.explainMissingPage(pageId.value))

// #hasAction
// 动作 id 是否已注册。
//
// @param {string} id - 动作 id
// @returns {boolean} 是否可点
function hasAction(id) {
  // 问本局所有 Mod 的界面桥。
  return hasModAction(game.modUiBridges, id)
}

// #onAction
// 触发动作（异常隔离在 ui-actions 里）。
//
// @param {object} block - 动作块
// @returns {Promise<void>}
async function onAction(block) {
  // 触发。
  await triggerAction(game.modUiBridges, block, {
    // debug。
    debug: (m) => game.pushLog('debug', m),
    // warn。
    warn: (m) => game.pushLog('warn', m),
    // error。
    error: (m) => game.pushLog('error', m),
  })
}
</script>

<template>
  <div class="mod-page">
    <!-- 命中：渲染页面 -->
    <template v-if="page">
      <h2 class="title">{{ page.title || page.id }}</h2>
      <p class="subtitle">
        Mod 页面 <code>{{ page.id }}</code>
        <span v-if="page.mod">· 来自 Mod {{ page.mod }}</span>
      </p>
      <DocBlocks
        :blocks="page.blocks"
        :id-prefix="`page-${page.id}`"
        :on-action="onAction"
        :has-action="hasAction"
      />
      <div class="actions">
        <button class="btn" @click="router.push('/mods')">Mod 管理</button>
        <button class="btn ghost" @click="router.back()">← 返回</button>
      </div>
    </template>

    <!-- 空态：说清"为什么看不到"（不白屏、不抛） -->
    <template v-else>
      <h2 class="title">Mod 页面</h2>
      <p class="empty">{{ missingReason }}</p>
      <div class="actions">
        <button class="btn" @click="router.push('/mods')">去 Mod 管理</button>
        <button class="btn ghost" @click="router.push('/')">回主页</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mod-page {
  padding: 30px;
  max-width: 900px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 6px;
}
.subtitle {
  text-align: center;
  font-size: 12px;
  color: #8f9bb3;
  margin-bottom: 18px;
}
.subtitle code {
  color: #ffd700;
}
.empty {
  text-align: center;
  font-size: 13px;
  line-height: 1.9;
  color: #ffb84d;
  background: #16213e;
  border-radius: 8px;
  padding: 16px 18px;
  margin: 20px 0;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 22px;
}
/* 本项目的 `.btn` 不是全局样式，每个页面各定义一份（有源码守卫钉住）。 */
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  background: #16457a;
}
.btn.ghost {
  background: transparent;
  border: 1px solid #2a3a5e;
}
</style>
