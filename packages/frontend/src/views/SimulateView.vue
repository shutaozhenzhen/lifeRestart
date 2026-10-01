<script setup>
// 模拟统计页（「模拟系统」的前端入口）。
//
// 做什么：按策略批量跑 N 局并聚合输出结果。
//   策略两条轴各自可随机或固定：
//     - 特性：随机抽卡 ／ **固定**（从全部天赋里挑，做控制变量实验）
//     - 属性：随机分配 ／ 固定（手填四项，超出可用点数时引擎会按比例缩减并警告）
//   结果可导出 CSV / JSON / Markdown（与 CLI 共用同一导出器）。
//
// 为什么长这样：
//   真实数据下**单局 0.3~1.5 秒**（老年阶段每年要判几百个事件条件），所以
//   页面必须：分批执行 + 进度条 + 每局速度与剩余时间估算 + 可随时取消；
//   另外提供「快速模式」（演示数据）让几十毫秒一局，适合快速看分布。
//
// 复用：模拟内核/策略/导出器都在 game-engine（与 CLI 同一份实现）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
// 数据加载（与主页同一实现：原版数据 → fixture 降级）。
import { loadGameData, buildFixtureData } from '../utils/game-data.js'
// 分批模拟驱动器。
import { runSimulation } from '../utils/simulation-runner.js'
// 下载文本（Blob + <a download>，与日志导出同一实现）。
import { downloadText } from '../utils/log-export.js'
// 导出器（CSV/JSON/Markdown）与策略文案。
import { FORMAT_LIST, exportSimulation, formatStrategy } from 'game-engine/src/sim/exporters.js'
// 评价文案翻译（J_* → 普通/优秀/极佳）。
import { loadLocale, t } from 'game-engine/src/i18n/index.js'

// 路由。
const router = useRouter()
// 中文词条。
const locale = loadLocale('zh-cn')

// 可选局数档位。
const RUN_OPTIONS = [10, 30, 50, 100]
// 特性可选上限（与引擎 talentSelectLimit 一致）。
const TALENT_LIMIT = 3
// 属性单项上限（与引擎 propertyAllocateLimit 一致）。
const ALLOC_MAX = 10
// 四项可分配属性（中文名与属性分配页一致）。
const ALLOC_ITEMS = [
  { k: 'CHR', n: '颜值' },
  { k: 'INT', n: '智力' },
  { k: 'STR', n: '体质' },
  { k: 'MNY', n: '家境' },
]
// 天赋列表一次最多渲染多少条（184 条全渲染会拖慢页面，用搜索过滤）。
const TALENT_RENDER_LIMIT = 60

// 局数（默认 30：真实数据约 40 秒，快速模式约 1 秒）。
const runs = ref(30)
// 随机种子输入（空 = 不可复现）。
const seedInput = ref('')
// 快速模式（用演示数据，几十毫秒一局）。
const fastMode = ref(false)
// 运行中。
const running = ref(false)
// 取消标记。
const cancelled = ref(false)
// 进度。
const done = ref(0)
// 已用毫秒。
const elapsedMs = ref(0)
// 最近一局寿命（进度行用）。
const lastAge = ref(null)
// 聚合结果。
const stats = ref(null)
// 逐局结果（导出用）。
const results = ref([])
// 数据源描述。
const dataSource = ref('')
// 真实数据（进入页面时加载一次，供非快速模式使用）。
const realData = ref(null)
// 加载失败提示（真实数据不可用时提示用户切快速模式）。
const loadError = ref('')
// 导出反馈。
const exportFeedback = ref('')

// ── 策略状态 ──
// 特性来源：random / fixed。
const talentMode = ref('random')
// 已固定的特性 ID。
const pickedTalents = ref([])
// 特性搜索关键字。
const talentFilter = ref('')
// 属性来源：random / fixed。
const allocMode = ref('random')
// 固定属性值。
const fixedAlloc = ref({ CHR: 0, INT: 0, STR: 0, MNY: 0 })

// #judgeText
// 评价键 → 可见文案。
function judgeText(key) {
  // 空值保护。
  if (!key) return ''
  // 翻译。
  return t(locale, key)
}

// #pct
// 0~1 → 百分比文本。
function pct(value) {
  // 格式化。
  return `${((Number(value) || 0) * 100).toFixed(1)}%`
}

// 数据源：真实数据 / 演示数据。
const activeData = computed(() => (fastMode.value ? buildFixtureData() : realData.value))
// 天赋全表（按星级、名称排序，便于挑选）。
const talentList = computed(() => {
  // 取表。
  const table = activeData.value?.talents || {}
  // 转数组。
  return Object.values(table)
    // 兜底 ID（极端数据下缺 id）。
    .map((item) => ({ grade: item.grade ?? 0, ...item }))
    // 排序：星级高的在前，其次按名称。
    .sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || String(a.name).localeCompare(String(b.name), 'zh-CN'))
})
// 按关键字过滤后的天赋（并限制渲染条数）。
const filteredTalents = computed(() => {
  // 关键字。
  const keyword = talentFilter.value.trim().toLowerCase()
  // 过滤。
  const matched = keyword
    ? talentList.value.filter((item) => String(item.name).toLowerCase().includes(keyword) || String(item.id).toLowerCase().includes(keyword))
    : talentList.value
  // 截断渲染。
  return matched.slice(0, TALENT_RENDER_LIMIT)
})
// 过滤后是否被截断（提示用户继续输入关键字）。
const talentTruncated = computed(() => {
  // 关键字。
  const keyword = talentFilter.value.trim().toLowerCase()
  // 命中总数。
  const total = keyword
    ? talentList.value.filter((item) => String(item.name).toLowerCase().includes(keyword) || String(item.id).toLowerCase().includes(keyword)).length
    : talentList.value.length
  // 是否超过渲染上限。
  return total > TALENT_RENDER_LIMIT
})
// 天赋 ID → 名称。
function talentName(id) {
  // 查表。
  return talentList.value.find((item) => item.id === id)?.name || id
}
// #toggleTalent
// 选中/取消一个固定特性（受上限约束）。
function toggleTalent(id) {
  // 已选 → 取消。
  if (pickedTalents.value.includes(id)) {
    // 移除。
    pickedTalents.value = pickedTalents.value.filter((item) => item !== id)
    // 结束。
    return
  }
  // 超出上限：忽略（UI 上这些项已被禁用）。
  if (pickedTalents.value.length >= TALENT_LIMIT) return
  // 追加。
  pickedTalents.value = [...pickedTalents.value, id]
}
// 固定属性合计。
const fixedAllocTotal = computed(() => Object.values(fixedAlloc.value).reduce((a, b) => a + (Number(b) || 0), 0))
// 当前策略（传给引擎）。
const strategy = computed(() => ({
  // 特性轴。
  talents: { mode: talentMode.value, fixed: [...pickedTalents.value] },
  // 属性轴。
  allocation: { mode: allocMode.value, fixed: { ...fixedAlloc.value } },
}))
// 结果里的策略文案。
const strategyText = computed(() => formatStrategy(stats.value?.strategy, { talentName }))
// 结果里最大值（用于直方图条形缩放）。
const maxBucket = computed(() => Math.max(1, ...(stats.value?.age.histogram || []).map((b) => b.count)))
// 每局平均耗时（秒）。
const secondsPerRun = computed(() => (done.value > 0 ? elapsedMs.value / 1000 / done.value : 0))
// 预计剩余时间（秒）。
const etaSeconds = computed(() => {
  // 未开始/已结束。
  if (!running.value || secondsPerRun.value <= 0) return 0
  // 剩余局数 × 每局耗时。
  return Math.max(0, Math.round((runs.value - done.value) * secondsPerRun.value))
})
// 开始前的粗估（真实数据 ~1.4s/局，演示数据 ~0.01s/局）。
const estimateSeconds = computed(() => Math.round(runs.value * (fastMode.value ? 0.01 : 1.4)))

// #start
// 开始模拟。
async function start() {
  // 数据不可用。
  if (!activeData.value) {
    // 提示。
    loadError.value = '数据未就绪（真实数据加载失败），请勾选「快速模式」用演示数据'
    // 中断。
    return
  }
  // 复位。
  running.value = true
  cancelled.value = false
  stats.value = null
  results.value = []
  done.value = 0
  elapsedMs.value = 0
  lastAge.value = null
  exportFeedback.value = ''
  // 种子：空串 → null（不可复现）。
  const seed = seedInput.value === '' ? null : Number(seedInput.value)
  // 计时起点（用于进度里的实时秒数）。
  const startedAt = Date.now()
  // 跑。
  const result = await runSimulation({
    // 数据。
    data: activeData.value,
    // 局数。
    runs: Math.max(1, Number(runs.value) || 1),
    // 种子。
    seed: Number.isFinite(seed) ? seed : null,
    // 每批 1 局：单局可达秒级，逐局汇报才能让进度条动起来。
    chunk: 1,
    // 策略（随机/固定特性与属性）。
    strategy: strategy.value,
    // 取消判定。
    shouldStop: () => cancelled.value,
    // 进度回调。
    onProgress: (d, total, last) => {
      // 更新进度。
      done.value = d
      // 实时耗时。
      elapsedMs.value = Date.now() - startedAt
      // 最近一局寿命。
      lastAge.value = last?.age ?? null
    },
  })
  // 落结果（取消也保留已跑部分的聚合）。
  stats.value = result.stats
  results.value = result.results
  elapsedMs.value = result.elapsedMs
  done.value = result.results.length
  running.value = false
}

// #stop
// 取消模拟（保留已完成部分的结果）。
function stop() {
  // 置标记（驱动器在下一批开始前检查）。
  cancelled.value = true
}

// #exportResult
// 导出当前结果（CSV / JSON / Markdown）。
//
// @param {string} format - csv/json/md
function exportResult(format) {
  // 无结果不导出。
  if (!stats.value) return
  // 生成文本与文件名（与 CLI 同一导出器）。
  const { text, fileName } = exportSimulation({
    // 格式。
    format,
    // 聚合。
    stats: stats.value,
    // 逐局。
    results: results.value,
    // 元信息（策略 → 报告头部；天赋表 → 固定特性渲染成名称）。
    meta: { strategy: stats.value.strategy, talentName },
  })
  // 下载。
  downloadText(text, fileName)
  // 反馈。
  exportFeedback.value = `已导出 ${format.toUpperCase()}：${fileName}`
}

// 挂载：加载数据（失败则提示可用快速模式）。
onMounted(async () => {
  // 加载。
  const { data, dataSource: source, degraded } = await loadGameData()
  // 记录。
  realData.value = data
  dataSource.value = source
  // 加载失败时默认勾上快速模式，保证页面开箱可用。
  if (degraded) {
    fastMode.value = true
    loadError.value = '原版数据不可用，已切到快速模式（演示数据）'
  }
})

// 返回主页。
function back() {
  // 返回。
  router.push('/')
}
</script>

<template>
  <div class="simulate">
    <h2 class="title">模拟统计</h2>
    <button class="btn back" @click="back">← 返回</button>

    <!-- 控制区 -->
    <div class="section">
      <h3>模拟设置</h3>
      <p class="hint">
        每局按下方策略准备特性与属性，跑完一生后统计。真实数据单局约 1 秒
        （老年阶段每年要判几百个事件条件），局数越大越慢；可随时停止。
      </p>

      <div class="field">
        <label>局数</label>
        <div class="chips">
          <button
            v-for="n in RUN_OPTIONS"
            :key="n"
            class="chip run"
            :class="{ active: runs === n }"
            :disabled="running"
            @click="runs = n"
          >{{ n }}</button>
          <input v-model.number="runs" class="num" type="number" min="1" max="2000" :disabled="running" />
        </div>
      </div>

      <div class="field">
        <label>随机种子</label>
        <input v-model="seedInput" class="num wide" placeholder="留空 = 不可复现" :disabled="running" />
      </div>

      <!-- 特性策略 -->
      <div class="field">
        <label>特性来源</label>
        <div class="chips">
          <button class="chip talent-mode" :class="{ active: talentMode === 'random' }" :disabled="running" @click="talentMode = 'random'">随机</button>
          <button class="chip talent-mode" :class="{ active: talentMode === 'fixed' }" :disabled="running" @click="talentMode = 'fixed'">固定</button>
        </div>
        <span v-if="talentMode === 'fixed'" class="hint">已选 {{ pickedTalents.length }}/{{ TALENT_LIMIT }}</span>
      </div>
      <template v-if="talentMode === 'fixed'">
        <div class="field">
          <label>挑选特性</label>
          <input v-model="talentFilter" class="num wide search" placeholder="搜索天赋名 / ID" :disabled="running" />
          <button class="chip" :disabled="running || !pickedTalents.length" @click="pickedTalents = []">清空</button>
        </div>
        <div class="talent-list">
          <label
            v-for="item in filteredTalents"
            :key="item.id"
            class="talent-item"
            :class="{ picked: pickedTalents.includes(item.id) }"
          >
            <input
              type="checkbox"
              :checked="pickedTalents.includes(item.id)"
              :disabled="running || (!pickedTalents.includes(item.id) && pickedTalents.length >= TALENT_LIMIT)"
              @change="toggleTalent(item.id)"
            />
            <span class="t-name">{{ item.name }}</span>
            <span class="t-grade">{{ '★'.repeat(Math.max(0, Math.min(3, item.grade || 0))) || '—' }}</span>
          </label>
          <p v-if="!filteredTalents.length" class="hint">没有匹配的天赋</p>
        </div>
        <p class="hint">
          {{ talentTruncated ? `仅显示前 ${TALENT_RENDER_LIMIT} 个，继续输入可缩小范围；` : '' }}
          已选：{{ pickedTalents.length ? pickedTalents.map(id => talentName(id)).join('、') : '（未选，将回退随机）' }}
        </p>
      </template>

      <!-- 属性策略 -->
      <div class="field">
        <label>属性来源</label>
        <div class="chips">
          <button class="chip alloc-mode" :class="{ active: allocMode === 'random' }" :disabled="running" @click="allocMode = 'random'">随机</button>
          <button class="chip alloc-mode" :class="{ active: allocMode === 'fixed' }" :disabled="running" @click="allocMode = 'fixed'">固定</button>
        </div>
      </div>
      <template v-if="allocMode === 'fixed'">
        <div class="field" v-for="item in ALLOC_ITEMS" :key="item.k">
          <label>{{ item.n }}</label>
          <input v-model.number="fixedAlloc[item.k]" class="num alloc" type="number" min="0" :max="ALLOC_MAX" :disabled="running" />
        </div>
        <p class="hint">
          合计 {{ fixedAllocTotal }} 点（单项上限 {{ ALLOC_MAX }}）。
          可用点数 = 20 + 固定特性的加成，超出时引擎会按比例缩减并给出警告。
        </p>
      </template>

      <div class="field">
        <label>快速模式</label>
        <label class="checkbox">
          <input v-model="fastMode" type="checkbox" :disabled="running" />
          用演示数据（每局毫秒级，适合快速看分布）
        </label>
      </div>

      <div class="field">
        <label>数据源</label>
        <span class="source">{{ fastMode ? 'fixture 演示数据' : dataSource || '（未就绪）' }}</span>
      </div>

      <div class="actions">
        <button v-if="!running" class="btn primary" @click="start">▶ 开始模拟</button>
        <button v-else class="btn stop" @click="stop">■ 停止</button>
        <span v-if="!running && !stats" class="hint">预计耗时约 {{ estimateSeconds }} 秒</span>
      </div>

      <p v-if="loadError" class="warn">{{ loadError }}</p>
    </div>

    <!-- 进度 -->
    <div v-if="running || done > 0" class="section">
      <h3>进度</h3>
      <div class="progress">
        <div class="bar" :style="{ width: `${Math.min(100, (done / Math.max(1, runs)) * 100)}%` }"></div>
      </div>
      <p class="progress-text">
        已完成 <b>{{ done }}</b>/{{ runs }} 局
        <template v-if="secondsPerRun > 0">
          （{{ (elapsedMs / 1000).toFixed(1) }}s，约 {{ (1 / secondsPerRun).toFixed(1) }} 局/秒<template v-if="running">，预计剩余 {{ etaSeconds }}s</template>）
        </template>
        <template v-if="lastAge !== null"> · 最近一局 {{ lastAge }} 岁</template>
      </p>
    </div>

    <!-- 结果 -->
    <template v-if="stats">
      <!-- 导出 -->
      <div class="section">
        <h3>导出结果</h3>
        <div class="chips">
          <button v-for="fmt in FORMAT_LIST" :key="fmt" class="chip" @click="exportResult(fmt)">{{ fmt.toUpperCase() }}</button>
        </div>
        <p class="hint">CSV 给表格工具，JSON 给脚本消费，Markdown 可直接贴进 issue / 文档。</p>
        <p v-if="exportFeedback" class="ok">{{ exportFeedback }}</p>
      </div>

      <!-- 警告（固定特性无效、固定属性超预算等） -->
      <div v-if="(stats.warnings || []).length" class="section warn-block">
        <h3>警告</h3>
        <p v-for="(w, i) in stats.warnings" :key="i" class="warn">⚠ {{ w }}</p>
      </div>

      <!-- 概览 -->
      <div class="section">
        <h3>概览（{{ stats.runs }} 局<template v-if="stats.seed !== null">，seed={{ stats.seed }}</template>）</h3>
        <p class="hint">策略：{{ strategyText }}</p>
        <div class="overview">
          <div class="cell"><span class="k">平均寿命</span><span class="v">{{ stats.age.avg }}</span></div>
          <div class="cell"><span class="k">最长寿</span><span class="v">{{ stats.age.max }}</span></div>
          <div class="cell"><span class="k">寿命中位</span><span class="v">{{ stats.age.median }}</span></div>
          <div class="cell"><span class="k">平均总评</span><span class="v">{{ stats.sum.avg }}</span></div>
          <div class="cell"><span class="k">最高总评</span><span class="v">{{ stats.sum.max }}</span></div>
          <div class="cell"><span class="k">每局成就</span><span class="v">{{ stats.achievementsPerRun }}</span></div>
        </div>
      </div>

      <!-- 寿命分布 -->
      <div class="section">
        <h3>寿命分布</h3>
        <div v-for="b in stats.age.histogram" :key="b.label" class="bar-row">
          <span class="bar-label">{{ b.label }}</span>
          <span class="bar-track"><span class="bar-fill" :style="{ width: `${(b.count / maxBucket) * 100}%` }"></span></span>
          <span class="bar-count">{{ b.count }}</span>
        </div>
      </div>

      <!-- 总评分档 -->
      <div class="section">
        <h3>总评分档</h3>
        <div v-for="key in ['J_Great', 'J_Good', 'J_Normal']" :key="key" class="row">
          <span class="label">{{ judgeText(key) }}</span>
          <span class="value">{{ stats.sum.grades[key] || 0 }} 局</span>
        </div>
      </div>

      <!-- 属性均值 -->
      <div class="section">
        <h3>属性均值（终局 / 历史最高）</h3>
        <div v-for="item in [{ k: 'CHR', n: '颜值' }, { k: 'INT', n: '智力' }, { k: 'STR', n: '体质' }, { k: 'MNY', n: '家境' }, { k: 'SPR', n: '快乐' }]" :key="item.k" class="row">
          <span class="label">{{ item.n }}</span>
          <span class="value">{{ stats.propertys[item.k] ?? 0 }} / {{ stats.maxPropertys[item.k] ?? 0 }}</span>
        </div>
      </div>

      <!-- 收集率 -->
      <div class="section">
        <h3>收集</h3>
        <div class="row"><span class="label">成就达成率</span><span class="value">{{ pct(stats.collection.achievementRate) }}（{{ stats.collection.achievements || 0 }} 个）</span></div>
        <div class="row"><span class="label">天赋选择率</span><span class="value">{{ pct(stats.collection.talentRate) }}</span></div>
        <div class="row"><span class="label">事件收集率</span><span class="value">{{ pct(stats.collection.eventRate) }}</span></div>
      </div>

      <!-- 最佳一局 -->
      <div v-if="stats.best" class="section">
        <h3>最佳一局（总评最高）</h3>
        <div class="row"><span class="label">寿命 / 总评</span><span class="value">{{ stats.best.age }} 岁 / {{ stats.best.sum }}（{{ judgeText(stats.best.grade) }}）</span></div>
        <div class="row">
          <span class="label">天赋</span>
          <span class="value">
            <template v-if="stats.best.talentDetails && stats.best.talentDetails.length">
              {{ stats.best.talentDetails.map(d => d.name).join('、') }}
            </template>
            <template v-else>（无）</template>
          </span>
        </div>
        <div class="row">
          <span class="label">属性分配</span>
          <span class="value">颜值 {{ stats.best.allocation.CHR }} / 智力 {{ stats.best.allocation.INT }} / 体质 {{ stats.best.allocation.STR }} / 家境 {{ stats.best.allocation.MNY }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.simulate {
  padding: 30px;
  max-width: 640px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 16px;
}
.back {
  margin-bottom: 16px;
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
.hint {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
  margin: 6px 0;
}
.warn {
  font-size: 12px;
  color: #ffb84d;
  margin-top: 8px;
  line-height: 1.6;
}
.ok {
  font-size: 12px;
  color: #4d9de0;
  margin-top: 8px;
}
.warn-block {
  border-left: 3px solid #ffb84d;
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.field label {
  width: 72px;
  font-size: 13px;
  color: #aaa;
  flex-shrink: 0;
}
.chips {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.chip {
  padding: 5px 12px;
  font-size: 12px;
  border: 1px solid #22304f;
  border-radius: 10px;
  background: transparent;
  color: #9aa7bd;
  cursor: pointer;
}
.chip.active {
  background: #0f3460;
  color: #fff;
}
.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.num {
  width: 84px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid #22304f;
  background: #101a33;
  color: #eee;
  font-size: 12px;
}
.num.wide {
  width: 160px;
}
.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9aa7bd;
}
.source {
  font-size: 12px;
  color: #ffd700;
}
/* 天赋选择列表（固定特性用） */
.talent-list {
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid #22304f;
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 8px;
}
.talent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #cfd8e3;
  cursor: pointer;
  width: auto;
}
.talent-item:hover {
  background: #101a33;
}
.talent-item.picked {
  background: #0f3460;
  color: #fff;
}
.talent-item .t-name {
  flex: 1;
}
.talent-item .t-grade {
  color: #ffd700;
  font-size: 11px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.btn {
  padding: 9px 18px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn.primary {
  background: #e94560;
}
.btn.stop {
  background: #b8860b;
}
.btn:hover {
  filter: brightness(1.2);
}
/* 进度条 */
.progress {
  height: 8px;
  border-radius: 4px;
  background: #101a33;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: #e94560;
  transition: width 0.2s;
}
.progress-text {
  font-size: 12px;
  color: #9aa7bd;
  margin-top: 8px;
}
.progress-text b {
  color: #fff;
}
/* 概览网格 */
.overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.cell {
  background: #101a33;
  border-radius: 6px;
  padding: 10px;
  text-align: center;
}
.cell .k {
  display: block;
  font-size: 11px;
  color: #8f9bb3;
}
.cell .v {
  font-size: 20px;
  font-weight: bold;
  color: #fff;
}
/* 行 */
.row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid #2a3a5e;
}
.row:last-child {
  border-bottom: none;
}
.label {
  color: #aaa;
  font-size: 13px;
}
.value {
  color: #ffd700;
  font-size: 13px;
}
/* 直方图 */
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
}
.bar-label {
  width: 44px;
  color: #8f9bb3;
  text-align: right;
}
.bar-track {
  flex: 1;
  height: 10px;
  background: #101a33;
  border-radius: 5px;
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  background: #4d9de0;
}
.bar-count {
  width: 32px;
  color: #cfd8e3;
  text-align: right;
}
</style>
