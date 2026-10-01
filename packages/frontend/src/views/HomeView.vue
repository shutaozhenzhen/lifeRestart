<script setup>
// 主页：模式选择 + 开始新人生。
// 两种模式（对应原版 mode.js）：
//   custom    自定义模式 → 天赋选择页
//   celebrity 名人模式 → 名人页（Step 后续实现，先走天赋）
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// 数据加载（与模拟页共用同一实现：原版数据 → fixture 降级）。
import { loadGameData } from '../utils/game-data.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()
// 初始化状态。
const loading = ref(false)
// 当前选中的模式。
const activeMode = ref('custom')
// 随机种子输入（留空 = 每局自动生成；填旧种子 = 复现同一局）。
const seedInput = ref('')

// 组装游戏数据：数据源由 lifeRestart-data Mod 的启停状态决定。
// 加载逻辑（含降级与 dataSource 标注）统一在 utils/game-data.js —— 模拟页共用同一份实现。
async function buildData() {
  // 按优先级加载（原版数据 → fixture 降级），并拿到来源描述。
  const { data, dataSource, degraded } = await loadGameData()
  // 页面日志：数据源（降级用 warn，便于在日志面板一眼看到）。
  store.pushLog(degraded ? 'warn' : 'info', `[UI][home] 数据源：${dataSource}`)
  // 记录数据源摘要（日志报告头部会带上，便于判断问题是否与数据相关）。
  store.dataSource = dataSource
  // 返回数据。
  return data
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
  // 初始化引擎：种子留空 → 自动生成（随后显示在轨迹页/总结页），填了就用它复现。
  await store.init(await buildData(), { seed: seedInput.value })
  // 日志：本局种子（复现的关键信息）。
  store.pushLog('info', `[UI][home] 本局随机种子：${store.seed}`)
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

    <!-- 随机种子：留空自动生成（每局都会在轨迹页/总结页显示），填入旧种子即可复现同一局 -->
    <div class="seed-row">
      <label class="seed-label" for="seed-input">随机种子</label>
      <input
        id="seed-input"
        v-model="seedInput"
        class="seed-input"
        :disabled="loading"
        placeholder="留空 = 随机生成"
        inputmode="numeric"
      />
      <button class="btn ghost tiny" :disabled="loading || !seedInput" @click="seedInput = ''">清空</button>
    </div>
    <p class="seed-hint">同一局 = 同一种子 + 同样的选择（抽卡结果与属性分配顺序一致）</p>

    <!-- 设置 / Mod 管理 / 模拟统计入口 -->
    <div class="nav-btns">
      <button class="btn ghost" @click="router.push('/settings')">设置</button>
      <button class="btn ghost" @click="router.push('/mods')">Mod 管理</button>
      <button class="btn ghost" @click="router.push('/simulate')">模拟统计</button>
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
/* 随机种子输入行 */
.seed-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seed-label {
  font-size: 13px;
  color: #aaa;
}
.seed-input {
  width: 160px;
  padding: 7px 10px;
  border: 1px solid #2a3a5e;
  border-radius: 6px;
  background: #16213e;
  color: #eee;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.seed-hint {
  font-size: 12px;
  color: #777;
  margin-top: -12px;
}
.btn.ghost.tiny {
  padding: 6px 10px;
  font-size: 12px;
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

