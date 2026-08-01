<script setup>
// 主页：模式选择 + 开始新人生。
// 两种模式（对应原版 mode.js）：
//   custom    自定义模式 → 天赋选择页
//   celebrity 名人模式 → 名人页（Step 后续实现，先走天赋）
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// 演示数据（fixture）。
import { AGE_DATA, TOTAL } from 'game-engine/src/fixtures/property.fixture.js'
import { TALENTS, EVENTS } from 'game-engine/src/fixtures/talent-event.fixture.js'
import { ACHIEVEMENTS } from 'game-engine/src/fixtures/achievement-character.fixture.js'
// 克隆工具。
import { clone } from 'game-engine/src/functions/util.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 初始化状态。
const loading = ref(false)
// 当前选中的模式。
const activeMode = ref('custom')

// 组装演示数据。
function buildData() {
  // 返回完整数据。
  return {
    age: clone(AGE_DATA),
    total: TOTAL,
    talents: clone(TALENTS),
    events: clone(EVENTS),
    achievements: clone(ACHIEVEMENTS),
    characters: {},
  }
}

// 选择模式。
function chooseMode(mode) {
  // 记录模式到 store。
  store.setMode(mode)
  // 更新本地高亮。
  activeMode.value = mode
}

// 开始新人生。
async function startGame() {
  // 标记加载。
  loading.value = true
  // 初始化引擎。
  await store.init(buildData())
  // 跳转到天赋选择页（名人模式暂同路径，Step 后续分离）。
  router.push('/talent')
}
</script>

<template>
  <div class="home">
    <h1 class="title">人生重开模拟器</h1>
    <p class="subtitle">这垃圾人生一秒也不想待了</p>

    <!-- 模式选择 -->
    <div class="modes">
      <button
        class="mode"
        :class="{ active: activeMode === 'custom' }"
        @click="chooseMode('custom')"
      >
        <span class="mode-name">自定义模式</span>
        <span class="mode-desc">自己分配属性，选择天赋</span>
      </button>
      <button
        class="mode"
        :class="{ active: activeMode === 'celebrity' }"
        @click="chooseMode('celebrity')"
      >
        <span class="mode-name">名人模式</span>
        <span class="mode-desc">模拟名人生平</span>
      </button>
    </div>

    <button class="btn" :disabled="loading" @click="startGame">
      {{ loading ? '加载中...' : '↻ 立即重开' }}
    </button>

    <!-- Mod 管理入口 -->
    <button class="btn ghost" @click="router.push('/mods')">Mod 管理</button>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;
}
.title {
  font-size: 48px;
  font-weight: bold;
}
.subtitle {
  color: #aaa;
  font-size: 16px;
}
.modes {
  display: flex;
  gap: 16px;
}
.mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 32px;
  border: 2px solid #2a3a5e;
  border-radius: 12px;
  background: #16213e;
  color: #eee;
  cursor: pointer;
}
.mode.active {
  border-color: #e94560;
  background: #1a2a4e;
}
.mode-name {
  font-size: 18px;
  font-weight: bold;
}
.mode-desc {
  font-size: 12px;
  color: #aaa;
}
.btn {
  padding: 14px 40px;
  font-size: 18px;
  border: none;
  border-radius: 8px;
  background: #e94560;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  background: #ff6b81;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.ghost {
  background: transparent;
  border: 1px solid #2a3a5e;
}
</style>

