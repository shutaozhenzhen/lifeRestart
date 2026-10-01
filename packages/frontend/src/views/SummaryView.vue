<script setup>
// 人生总结页（对应原版 summary.js）。
//
// 本轮修复（用户反馈"总结页全是 —"）：
//   1. 评价分档缺省：引擎 config() 未注入 judge 表 → judge() 全返回 undefined。
//      已在引擎侧修（内置默认表 src/params/judge-config.js），本页把 J_* 键翻成中文。
//   2. 重开次数/成就/事件收集一直为 0：前端没给引擎注入 storage →
//      引擎退回内存实现，跨局数据全部丢失。已在 store.init 注入 localStorage 适配器。
//   3. 165 条成就一览到底、页面很长：改成固定高度滚动区。
//   4. statistics 取了却没用上：补「统计」区（成就/天赋/事件收集）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
// i18n：评价键（J_Normal/J_Good/J_Great）→ 可见文案。
import { loadLocale, t } from 'game-engine/src/i18n/index.js'
// 复制文本（剪贴板 API + 回退）。
import { copyText } from '../utils/log-export.js'
// 统计项的标签与格式化（集中定义，见该模块头部说明：RACHV 曾因两份手写清单漏配而裸展示）。
import { visibleStatistics } from '../utils/statistics-view.js'

// 路由。
const router = useRouter()
// 游戏 store。
const store = useGameStore()

// 总结数据（各属性分档评价）。
const summary = ref({})
// 成就列表。
const achievements = ref([])
// 统计信息。
const statistics = ref({})

// 中文词条表。
const locale = loadLocale('zh-cn')

// 总结条目展示（键 → 中文名）。
const summaryLabels = {
  SUM: '总评',
  HAGE: '最高年龄',
  HCHR: '最高颜值',
  HINT: '最高智力',
  HSTR: '最高体质',
  HMNY: '最高家境',
  HSPR: '最高快乐',
}

// 统计条目展示（键 → 中文名 + 格式化方式）见 utils/statistics-view.js。

// #judgeText
// 评价键 → 可见文案（缺词条时原样返回键名）。
//
// @param {string} key - J_* 评价键
// @returns {string} 文案
function judgeText(key) {
  // 空值返回空串。
  if (!key) return ''
  // 翻译。
  return t(locale, key)
}

// 统计条目列表（跳过 TMS：页头已显示"重开次数"）。
// 成就达成数带上分母（成就总数），比单看一个数字有用。
const statItems = computed(() => visibleStatistics(statistics.value, { totalAchievements: achievements.value.length }))

// 已达成成就数。
const achievedCount = computed(() => achievements.value.filter((a) => a.isAchieved).length)

// 挂载时读取总结（引擎侧 summary 会触发 SUMMARY 成就检测）。
onMounted(() => {
  // 需要已开局。
  if (!store.life) {
    // 回主页。
    router.push('/')
    return
  }
  // 读取总结（触发 SUMMARY 成就检测）。
  summary.value = store.life.summary || {}
  // 成就列表。
  achievements.value = store.life.achievements || []
  // 统计信息。
  statistics.value = store.life.statistics || {}
})

// 重开次数（引擎 TMS：storage 持久化，跨局累积）。
const times = computed(() => (store.life ? store.life.times : 0))

// 重开：次数 +1（写入 storage 持久化），回到主页。
function remake() {
  // 次数 +1（setter 内部会写 storage 并触发 END 成就检测）。
  store.life.times = store.life.times + 1
  // 清空状态（含完整轨迹，见 store.clearTrace）。
  store.selectedTalents = []
  store.allocation = { CHR: 0, INT: 0, STR: 0, MNY: 0 }
  store.clearTrace()
  // 回主页。
  router.push('/')
}

// 本局随机种子（mulberry32；显示出来供复现）。
const seed = computed(() => store.seed)
// 复现反馈。
const replayMessage = ref('')

// #replay
// 用同一颗种子重开一局（随机序列相同 → 同样的抽卡与事件；再做出同样的选择即可复现整局）。
async function replay() {
  // 重新初始化（种子不变）。
  const ok = await store.restartWithSeed(seed.value)
  // 失败（无数据引用，例如直接刷新本页）。
  if (!ok) {
    // 提示并回主页手动填种子。
    replayMessage.value = `无法直接复现，请回主页在「随机种子」填入 ${seed.value}`
    // 结束。
    return
  }
  // 进天赋页（同种子下抽卡结果与上一局一致）。
  router.push('/talent')
}

// #copySeed
// 复制种子到剪贴板。
async function copySeed() {
  // 复制。
  const ok = await copyText(String(seed.value ?? ''))
  // 反馈。
  replayMessage.value = ok ? `已复制种子 ${seed.value}` : '复制失败（可手动选中复制）'
}
</script>

<template>
  <div class="summary">
    <h2 class="title">人生总结</h2>
    <p class="subtitle">重开次数：{{ times }}</p>
    <!-- 本局随机种子：复现的关键信息（同种子 + 同样选择 = 同一局） -->
    <p class="seed-line">
      随机种子：<b class="seed-value">{{ seed }}</b>
      <button class="btn tiny" @click="copySeed">复制</button>
      <button class="btn tiny" @click="replay">用此种子再来一局</button>
    </p>
    <p v-if="replayMessage" class="seed-msg">{{ replayMessage }}</p>

    <!-- 属性评价 -->
    <div class="section">
      <h3>属性评价</h3>
      <div v-for="(v, key) in summary" :key="key" class="row">
        <span class="label">{{ summaryLabels[key] || key }}</span>
        <span class="value">
          <template v-if="v">{{ v.value }}（{{ judgeText(v.judge) }}）</template>
          <template v-else>—</template>
        </span>
      </div>
      <p v-if="Object.keys(summary).length === 0" class="empty">（暂无评价数据）</p>
    </div>

    <!-- 统计（成就/天赋/事件收集） -->
    <div class="section statistics">
      <h3>收集统计</h3>
      <div v-for="row in statItems" :key="row.key" class="row" :class="{ unknown: !row.known }">
        <span class="label">{{ row.label }}</span>
        <span class="value">
          <template v-if="row.text !== '—'">{{ row.text }}（{{ judgeText(row.judge) }}）</template>
          <template v-else>—</template>
        </span>
      </div>
      <p v-if="statItems.length === 0" class="empty">（暂无统计数据）</p>
    </div>

    <!-- 成就列表（固定高度滚动：共 165 条） -->
    <div class="section">
      <h3>成就（{{ achievedCount }}/{{ achievements.length }}）</h3>
      <div class="ach-list">
        <div v-for="a in achievements" :key="a.id" class="ach" :class="{ done: a.isAchieved }">
          <span class="ach-name">{{ a.isAchieved ? a.name : (a.hide ? '???' : a.name) }}</span>
          <span v-if="a.isAchieved" class="ach-check">✓</span>
        </div>
        <div v-if="achievements.length === 0" class="empty">（暂无成就）</div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="actions">
      <button class="btn primary" @click="remake">↻ 重开</button>
      <button class="btn" @click="router.push('/')">回主页</button>
    </div>
  </div>
</template>

<style scoped>
.summary {
  padding: 30px;
  max-width: 520px;
  margin: 0 auto;
}
/* 随机种子行（复现用） */
.seed-line {
  text-align: center;
  font-size: 12px;
  color: #9aa7bd;
  margin-top: 6px;
}
.seed-value {
  color: #ffd700;
  font-family: ui-monospace, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.seed-msg {
  text-align: center;
  font-size: 12px;
  color: #4d9de0;
  margin-top: 4px;
}
.btn.tiny {
  padding: 3px 8px;
  font-size: 11px;
  margin-left: 6px;
}
/* 未登记的统计键（引擎加了新统计项但界面没跟上）：用告警色标出来，
   正常情况不该出现——statistics-view.spec.js 的覆盖性用例会先在 CI 拦住。 */
.statistics .row.unknown .label {
  color: #ffb84d;
}
.title {
  text-align: center;
  margin-bottom: 8px;
}
.subtitle {
  text-align: center;
  color: #aaa;
  margin-bottom: 24px;
}
.section {
  background: #16213e;
  border-radius: 8px;
  padding: 18px;
  margin-bottom: 16px;
}
.section h3 {
  margin-bottom: 12px;
  font-size: 15px;
  color: #aaa;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #2a3a5e;
}
.row:last-child {
  border-bottom: none;
}
.value {
  color: #ffd700;
}
/* 成就：固定高度滚动，避免 165 条把页面撑得很长 */
.ach-list {
  max-height: 260px;
  overflow-y: auto;
  padding-right: 4px;
}
.ach {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  color: #777;
  font-size: 13px;
}
.ach.done {
  color: #eee;
}
.ach-check {
  color: #4caf50;
  font-weight: bold;
}
.empty {
  color: #666;
  text-align: center;
  padding: 10px 0;
}
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 24px;
}
.btn {
  padding: 12px 28px;
  border: none;
  border-radius: 8px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn.primary {
  background: #e94560;
}
.btn:hover {
  filter: brightness(1.2);
}
</style>
