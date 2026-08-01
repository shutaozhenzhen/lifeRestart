<script setup>
// 主页：模式选择 + 进入游戏。
// 加载演示数据初始化引擎，点击"开始新人生"进入游戏页。
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

// 开始新人生。
async function startGame() {
  // 标记加载。
  loading.value = true
  // 初始化引擎。
  await store.init(buildData())
  // 跳转到游戏页。
  router.push('/game')
}
</script>

<template>
  <div class="home">
    <h1 class="title">人生重开模拟器</h1>
    <p class="subtitle">这垃圾人生一秒也不想待了</p>
    <button class="btn" :disabled="loading" @click="startGame">
      {{ loading ? '加载中...' : '↻ 立即重开' }}
    </button>
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
</style>
