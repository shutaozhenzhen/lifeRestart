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

// #loadModState
// 读取 Mod 启停状态（localStorage 键 modsState，与 Mod 管理页共用）。
function loadModState(name) {
  // 读取。
  try {
    // 解析。
    const s = JSON.parse(localStorage.getItem('modsState'))
    // 返回该 Mod 启停。
    return s?.enabled?.[name] ?? null
  } catch {
    // 未知。
    return null
  }
}

// #fetchOriginalData
// 加载原版数据（lifeRestart-data 系统 Mod 的转换产物，已内置于 public/data/）。
// lifeRestart-data 是 data-mod 产物：新语法条件、字符串 ID、[id,权重] 二维数组，引擎可直接消费。
//
// @returns {Promise<object>} 原版数据 { age, total, talents, events, achievements, characters }
async function fetchOriginalData() {
  // 并行加载 5 个数据文件。
  const [age, talents, events, achievements, characters] = await Promise.all([
    fetch('/data/age.json').then(r => r.json()),
    fetch('/data/talents.json').then(r => r.json()),
    fetch('/data/events.json').then(r => r.json()),
    fetch('/data/achievements.json').then(r => r.json()),
    fetch('/data/characters.json').then(r => r.json()),
  ])
  // 返回整合数据。
  return {
    age,
    total: { TACHV: Object.keys(achievements).length, TEVT: Object.keys(events).length, TTLT: Object.keys(talents).length },
    talents,
    events,
    achievements,
    characters,
  }
}

// 组装游戏数据：数据源由 lifeRestart-data Mod 的启停状态决定。
// - 启用（Mod 管理页开关，localStorage modsState）→ 原版数据（lifeRestart-data 内置产物）。
// - 禁用 / 加载失败 → 回退 fixture 演示数据。
async function buildData() {
  // lifeRestart-data 启停状态。
  const originalEnabled = loadModState('lifeRestart-data')
  // 启用（缺省视为启用：系统内置默认开）。
  if (originalEnabled !== false) {
    // 尝试加载原版。
    try {
      // 原版数据。
      const data = await fetchOriginalData()
      // 页面日志：数据源。
      store.pushLog('info', `[UI][home] 数据源：lifeRestart-data 原版数据（${Object.keys(data.talents).length} 天赋 / ${Object.keys(data.events).length} 事件）`)
      // 返回。
      return data
    } catch (e) {
      // 页面日志：降级。
      store.pushLog('warn', `[UI][home] 原版数据加载失败（${e.message}），回退 fixture 演示数据`)
    }
  } else {
    // 页面日志：被禁用。
    store.pushLog('info', '[UI][home] lifeRestart-data 已禁用，使用 fixture 演示数据')
  }
  // 返回 fixture 演示数据（降级）。
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
  // 页面行为日志（常显进日志面板）。
  store.pushLog('info', '[UI][home] 开始新人生（引擎初始化）')
  // 标记加载。
  loading.value = true
  // 初始化引擎（数据源：lifeRestart-data 启用 → 原版；禁用 → fixture）。
  await store.init(await buildData())
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

    <!-- 设置 / Mod 管理入口 -->
    <div class="nav-btns">
      <button class="btn ghost" @click="router.push('/settings')">设置</button>
      <button class="btn ghost" @click="router.push('/mods')">Mod 管理</button>
    </div>
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
.nav-btns {
  display: flex;
  gap: 10px;
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

