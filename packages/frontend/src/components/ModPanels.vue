<script setup>
// ModPanels — 把某个 slot 上的 Mod 面板渲染成卡片（2026-10 能力补齐 ③）
//
// 用法：在页面模板里插一行 `<ModPanels slot="home" />`。没有面板时**什么都不渲染**
// （不占空间、不留空卡片）。
//
// 两个注册源都会汇到这张表里：
//   · `manifest.ui.panels`（静态声明）→ 应用启动时装好，主页/管理页立刻可见；
//   · `gameAPI.ui.addPanel`（运行期）→ 开局后追加（按条件显示的场景）。
//
// 内容块用 `components/DocBlocks.vue` 渲染（**与文档页同一个渲染器**，不许有第二份）。
import { computed } from 'vue'
// 扩展注册表（启动时装载 + 运行期追加）。
import { useExtensionsStore } from '../stores/extensions.js'
// 游戏 store（拿本局各 Mod 的界面桥 → 动作按钮的可点性）。
import { useGameStore } from '../stores/game.js'
// 内容块渲染器。
import DocBlocks from './DocBlocks.vue'
// 动作查找与触发。
import { hasAction as hasModAction, triggerAction } from '../utils/ui-actions.js'

// 属性：插在哪个 slot。
const props = defineProps({
  // slot 名（home / mods / property / game / summary / settings）。
  slot: { type: String, required: true },
})

// 扩展注册表。
const ext = useExtensionsStore()
// 游戏 store（`modUiBridges` 由 store.init 写入；未开局时为 null）。
const game = useGameStore()

// 该 slot 的面板（按注册顺序）。
const panels = computed(() => ext.panelsOf(props.slot))

// #hasAction
// 动作 id 是否已注册（决定按钮可点/禁用）。
//
// @param {string} id - 动作 id
// @returns {boolean} 是否可点
function hasAction(id) {
  // 问本局所有 Mod 的界面桥。
  return hasModAction(game.modUiBridges, id)
}

// #onAction
// 点击动作按钮（异常隔离在 ui-actions 里做）。
//
// @param {object} block - 动作块
// @returns {Promise<void>}
async function onAction(block) {
  // 触发（日志器用 store 的日志缓冲，用户能在日志面板里看到结果）。
  await triggerAction(game.modUiBridges, block, {
    // debug（成功）。
    debug: (m) => game.pushLog('debug', m),
    // warn（没注册）。
    warn: (m) => game.pushLog('warn', m),
    // error（回调失败）。
    error: (m) => game.pushLog('error', m),
  })
}
</script>

<template>
  <!-- 没有面板 → 什么都不渲染（页面上不留空壳）。 -->
  <div v-if="panels.length" class="mod-panels">
    <!-- 逐张卡片 -->
    <div v-for="p in panels" :key="p.id" class="mod-panel">
      <!-- 标题 + 来源 Mod（看得出是谁加的） -->
      <div class="panel-head">
        <span class="panel-title">{{ p.title || p.id }}</span>
        <span v-if="p.mod" class="panel-source">来自 Mod {{ p.mod }}</span>
      </div>
      <!-- 内容块 -->
      <DocBlocks
        :blocks="p.blocks"
        :id-prefix="`panel-${p.id}`"
        :on-action="onAction"
        :has-action="hasAction"
      />
    </div>
  </div>
</template>

<style scoped>
.mod-panels {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
}
.mod-panel {
  background: #16213e;
  border: 1px solid #2a3a5e;
  border-radius: 8px;
  padding: 12px 14px;
  text-align: left;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.panel-title {
  font-size: 14px;
  font-weight: bold;
  color: #ffd700;
}
.panel-source {
  font-size: 11px;
  color: #8f9bb3;
}
</style>
