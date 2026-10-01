<script setup>
// 人生轨迹页（对应原版 trajectory.js）。
//
// 本次优化（用户反馈：属性区太占地方 / 没有自动播放 / 事件只剩一条）：
//   1. 属性区从 3 列大卡片改为一行紧凑胶囊（年龄/生命 + 五个属性），把纵向空间让给轨迹。
//   2. 新增自动播放（慢/正常/快三档，进入页面即开始，可暂停），结束自动停。
//   3. 事件不再每年覆盖：store.history 累积每年条目，页面逐年渲染完整列表，并自动跟随最新。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// 自动播放器（定时器逻辑独立模块，有单测）。
import { createAutoPlayer, PLAY_SPEEDS, DEFAULT_SPEED, speedDelay } from '../utils/auto-play.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()

// 属性面板条目（名称 + 键）。
const propsList = [
  { key: 'CHR', label: '颜值' },
  { key: 'INT', label: '智力' },
  { key: 'STR', label: '体质' },
  { key: 'MNY', label: '家境' },
  { key: 'SPR', label: '快乐' },
]

// 当前生命值（读 store 的响应式镜像）。
// 注意：不能写成 life.request('PROPERTY').get('LIF')——Life 实例是 markRaw 的，
// 引擎内部状态不是响应式依赖，computed 会永久缓存首次结果（曾导致死亡后仍继续推进）。
const lif = computed(() => store.lif)
// 是否结束（同上，来自 store 的响应式镜像）。
const isEnd = computed(() => store.isEnd)
// 当前年龄（引擎 AGE 开局前为 -1，钳到 0）。
const age = computed(() => Math.max(0, Number(store.propertys.AGE) || 0))

// 播放中标志（按钮文案/禁用态用；与 player.running 同步维护）。
const playing = ref(false)
// 播放速度档位（localStorage 持久化）。
const speed = ref(localStorage.getItem('playSpeed') || DEFAULT_SPEED)
// 速度选项。
const speeds = PLAY_SPEEDS

// 轨迹滚动容器。
const listEl = ref(null)
// 是否跟随最新（用户往上翻时暂停自动滚动，避免"抢滚动"）。
const stick = ref(true)

// #advance
// 推进一年（手动按钮与自动播放共用；守卫在 store.advanceYear 内）。
//
// @returns {void}
function advance() {
  // 推进（store 记录流水 + 累积轨迹；已结束会自行返回 false 且不推进）。
  store.advanceYear()
}

// #onTick
// 自动播放的每次推进：返回 false 表示停止（人生结束）。
//
// @returns {boolean} 是否继续
function onTick() {
  // 推进一年并询问是否还能继续。
  const keepGoing = store.advanceYear()
  // 结束：同步按钮状态并停止播放。
  if (!keepGoing) {
    playing.value = false
    return false
  }
  // 继续。
  return true
}

// 自动播放器。
const player = createAutoPlayer({ onTick, delayMs: speedDelay(speed.value) })

// #togglePlay
// 播放/暂停。
//
// @returns {void}
function togglePlay() {
  // 结束态不能播。
  if (isEnd.value && !playing.value) return
  // 收放。
  player.toggle()
  // 同步标志。
  playing.value = player.running
}

// #changeSpeed
// 切换播放速度（写入 localStorage；播放中立即生效）。
//
// @param {string} key - slow/normal/fast
// @returns {void}
function changeSpeed(key) {
  // 记录。
  speed.value = key
  // 持久化。
  localStorage.setItem('playSpeed', key)
  // 播放中：按新间隔重排。
  player.setDelay(speedDelay(key))
}

// #scrollToBottom
// 滚到最新一条。
//
// @returns {Promise<void>}
async function scrollToBottom() {
  // 等 DOM 更新。
  await nextTick()
  // 有容器则滚到底。
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  // 恢复跟随。
  stick.value = true
}

// #onScroll
// 滚动时判断是否仍贴底（决定新条目是否自动跟随）。
//
// @returns {void}
function onScroll() {
  // 容器。
  const el = listEl.value
  // 无容器返回。
  if (!el) return
  // 距底部 24px 内视为贴底。
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

// #kindLabel
// 条目类型标签。
//
// @param {object} c - 条目
// @returns {string} 标签
function kindLabel(c) {
  // 事件 / 天赋 / 天赋替换。
  if (c.type === 'EVT') return '事件'
  if (c.type === 'TLT') return '天赋'
  if (c.type === 'talentReplace') return '替换'
  // 其它（Mod/AI 注入等）。
  return '信息'
}

// #kindClass
// 条目类型样式类。
//
// @param {object} c - 条目
// @returns {string} class
function kindClass(c) {
  // 事件蓝色 / 天赋金色 / 替换紫色 / 其它灰色。
  if (c.type === 'EVT') return 'evt'
  if (c.type === 'TLT') return 'tlt'
  if (c.type === 'talentReplace') return 'rep'
  // 兜底。
  return 'other'
}

// #textOf
// 条目主文本。
//
// @param {object} c - 条目
// @returns {string} 文本
function textOf(c) {
  // 天赋替换：源 → 目标。
  if (c.type === 'talentReplace') return `${c.source?.name || '?'} → ${c.target?.name || '?'}`
  // 天赋：名称（描述走副文本）。
  if (c.type === 'TLT') return c.name || c.description || '（天赋）'
  // 事件/其它：描述。
  return c.description || '（无描述）'
}

// #subOf
// 条目副文本（天赋描述 / 事件后续）。
//
// @param {object} c - 条目
// @returns {string} 文本（无则空）
function subOf(c) {
  // 天赋：描述。
  if (c.type === 'TLT') return c.description || ''
  // 事件：后续分支。
  if (c.type === 'EVT') return c.postEvent ? `后续：${c.postEvent}` : ''
  // 其它无副文本。
  return ''
}

// 挂载：未开局则开局（返回/刷新后不重复），随后自动开始播放。
onMounted(() => {
  // 未开局则开局（stared 守卫，避免重复 remake + start）。
  if (!store.started) store.begin({ ...store.allocation })
  // 已结束（例如从总结页返回）不自动播放。
  if (!isEnd.value) {
    // 起播放。
    player.start()
    // 同步标志。
    playing.value = true
  }
  // 滚到最新。
  scrollToBottom()
})

// 卸载：停止播放（避免离开页面后定时器继续推进人生）。
onBeforeUnmount(() => {
  // 停止。
  player.stop()
})

// 新轨迹：跟随最新。
watch(() => store.history.length, () => {
  // 只有贴底时才自动滚（用户往上翻就尊重其位置）。
  if (stick.value) scrollToBottom()
})

// 重开：回到天赋选择页。
function restart() {
  // 停止播放。
  player.stop()
  // 清空选择。
  store.selectedTalents = []
  store.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
  // 回主页。
  router.push('/')
}

// 查看总结。
function summary() {
  // 停止播放。
  player.stop()
  // 跳转总结页。
  router.push('/summary')
}
</script>

<template>
  <div class="game">
    <!-- 顶部紧凑状态栏：属性 + 操作（把纵向空间让给轨迹列表） -->
    <header class="hud">
      <div class="hud-row stats">
        <span class="pill age">第 {{ age }} 岁</span>
        <span class="pill lif" :class="{ dead: isEnd }">生命 {{ lif }}</span>
        <span v-for="item in propsList" :key="item.key" class="pill">
          {{ item.label }} <b>{{ store.propertys[item.key] }}</b>
        </span>
      </div>

      <div class="hud-row actions">
        <button class="btn primary" :disabled="isEnd || playing" @click="advance">下一年</button>
        <button class="btn play" :class="{ on: playing }" :disabled="isEnd && !playing" @click="togglePlay">
          {{ playing ? '⏸ 暂停' : '▶ 自动播放' }}
        </button>
        <span class="speed">
          <button
            v-for="s in speeds"
            :key="s.key"
            class="chip"
            :class="{ active: speed === s.key }"
            :title="`每 ${s.delayMs}ms 推进一年`"
            @click="changeSpeed(s.key)"
          >{{ s.label }}</button>
        </span>
        <span class="spacer"></span>
        <button class="btn" :disabled="!isEnd" @click="summary">总结</button>
        <button class="btn" @click="restart">重开</button>
      </div>
    </header>

    <!-- 轨迹：逐年完整列表，滚动 -->
    <main ref="listEl" class="trace" @scroll="onScroll">
      <section v-for="y in store.history" :key="y.age" class="year" :class="{ dead: y.isEnd }">
        <div class="year-head">
          <span class="year-age">{{ y.age }} 岁</span>
          <span v-if="y.items.length === 0" class="year-none">平安无事</span>
        </div>
        <div
          v-for="(c, i) in y.items"
          :key="i"
          class="entry"
          :class="kindClass(c)"
          :style="{ animationDelay: `${Math.min(i, 6) * 55}ms` }"
        >
          <span class="kind">{{ kindLabel(c) }}</span>
          <span class="body">
            <span class="text">{{ textOf(c) }}</span>
            <span v-if="subOf(c)" class="sub">{{ subOf(c) }}</span>
          </span>
        </div>
      </section>

      <p v-if="store.history.length === 0" class="empty">
        正在开始人生…（若长时间没有内容，点上方「下一年」）
      </p>
    </main>

    <!-- 未跟随最新时提供回到最新 -->
    <button v-if="!stick" class="jump" @click="scrollToBottom">↓ 回到最新</button>
  </div>
</template>

<style scoped>
/* 整页：上下两块，轨迹区占满剩余高度并独立滚动 */
.game {
  display: flex;
  flex-direction: column;
  /* 移动端优先用 dvh（地址栏收起/展开不会裁掉底部操作区） */
  height: 100vh;
  height: 100dvh;
  max-width: 720px;
  margin: 0 auto;
  padding: 10px 12px 0;
  /* 「回到最新」按钮的定位父级 */
  position: relative;
}
/* 状态栏 */
.hud {
  flex-shrink: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #22304f;
}
.hud-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.hud-row.actions {
  margin-top: 8px;
}
/* 属性胶囊：一行放完，数值加粗 */
.stats .pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #16213e;
  color: #9aa7bd;
  font-size: 12px;
  line-height: 1.5;
}
.stats .pill b {
  color: #fff;
  font-size: 13px;
}
.stats .pill.age {
  background: #0f3460;
  color: #cfe3ff;
}
.stats .pill.age b {
  color: #fff;
}
.stats .pill.lif {
  background: #1b3a2a;
  color: #a8e6c0;
}
.stats .pill.lif.dead {
  background: #4a1b28;
  color: #ff9db0;
}
/* 按钮 */
.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.btn.primary {
  background: #e94560;
}
.btn.play.on {
  background: #b8860b;
}
.btn:hover {
  filter: brightness(1.2);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.spacer {
  flex: 1;
}
.speed {
  display: inline-flex;
  gap: 4px;
}
.chip {
  padding: 4px 8px;
  border: 1px solid #22304f;
  border-radius: 10px;
  background: transparent;
  color: #9aa7bd;
  font-size: 11px;
  cursor: pointer;
}
.chip.active {
  background: #0f3460;
  color: #fff;
}
/* 轨迹区 */
.trace {
  flex: 1;
  overflow-y: auto;
  padding: 10px 2px 96px; /* 底部留白：避开右下角日志悬浮窗 */
}
.year {
  margin-bottom: 8px;
  padding-left: 8px;
  border-left: 2px solid #22304f;
}
.year.dead {
  border-left-color: #e94560;
}
.year-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.year-age {
  font-size: 13px;
  color: #ffd700;
  font-weight: bold;
}
.year-none {
  font-size: 12px;
  color: #6b7688;
}
.entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 5px;
  border-radius: 6px;
  background: #16213e;
  /* 新条目入场动画（配合行内 animation-delay：同一年内逐条浮现，视觉上"逐个触发"） */
  animation: rise 0.18s ease-out both;
}
.entry.evt {
  border-left: 3px solid #4d9de0;
}
.entry.tlt {
  border-left: 3px solid #ffd700;
}
.entry.rep {
  border-left: 3px solid #a06cd5;
}
.entry.other {
  border-left: 3px solid #6b7688;
}
.kind {
  flex-shrink: 0;
  font-size: 11px;
  color: #aab6c8;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 1px 6px;
  margin-top: 1px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.text {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.sub {
  font-size: 11px;
  color: #8f9bb3;
  line-height: 1.4;
}
.empty {
  color: #666;
  text-align: center;
  padding: 40px 0;
}
/* 回到最新 */
.jump {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 16px;
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: #0f3460;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
/* 入场动画 */
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
