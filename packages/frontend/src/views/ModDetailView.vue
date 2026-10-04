<script setup>
// Mod 数据详情页 —— 把某个 Mod "装了什么"**可视化**出来。
//
// 入口：Mod 管理页每张卡片上的「查看数据 →」→ /mods/<name>
//
// 为什么单独一页（而不是在卡片里展开）：
//   lifeRestart-data 有 501 年龄 / 184 天赋 / 1720 事件，需要搜索、页签、截断渲染
//   与分布图；塞进列表卡片会让 Mod 管理页变成两件事。独立路由还能深链 + 后退。
//
// 数据从哪来：utils/mod-detail.js —— 按 Mod 名**单独读、不合并**，
//   读法直接复用引擎的 `loadMod()`，所以"这一页显示的 = 引擎实际会加载的"。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '../stores/game.js'
import { loadModDetail, summarizeModData } from '../utils/mod-detail.js'
// 已安装 Mod 的本地存储（zip 装进来的 Mod 也要能看数据 —— 与发现/加载同一优先级）。
import { getModStore } from '../utils/mod-store.js'

// 路由（Mod 名在 params 里）。
const route = useRoute()
// 路由跳转。
const router = useRouter()
// 游戏 store（本页日志进日志面板/报告）。
const store = useGameStore()

// 一次最多渲染多少条（1720 条事件全渲染会明显卡顿）。
const RENDER_LIMIT = 50

// 数据集页签（顺序 = 引擎 DATA_FILES 的顺序）。
const DATASETS = [
  { key: 'talents', label: '天赋' },
  { key: 'events', label: '事件' },
  { key: 'achievements', label: '成就' },
  { key: 'characters', label: '名人' },
  { key: 'age', label: '年龄表' },
]

// Mod 名（路由参数）。
const name = computed(() => String(route.params.name || ''))
// 加载中。
const loading = ref(true)
// 详情（loadModDetail 的返回值）。
const detail = ref(null)
// 当前页签。
const tab = ref('talents')
// 搜索关键字。
const keyword = ref('')

// 统计（纯函数，见 utils/mod-detail.js）。
const stats = computed(() => summarizeModData(detail.value?.data || {}))
// 当前页签的数据集是否为空。
const tabCount = computed(() => stats.value.totals[tab.value] || 0)

// #pct
// 0~1 → 百分比宽度（条形）。
//
// @param {number} value - 数量
// @param {number} total - 总量
// @returns {string} CSS 宽度
function pct(value, total) {
  // 防 0。
  const t = Number(total) || 0
  // 计算（最小 2% 以保证可见）。
  return `${t > 0 ? Math.max(2, Math.round((Number(value) / t) * 100)) : 0}%`
}

// #gradeLabel
// 星级文案。
//
// @param {number|string} grade - 星级
// @returns {string} 文案
function gradeLabel(grade) {
  // 未知。
  if (grade === '未知') return '未标注'
  // 数字。
  return `${grade}星`
}

// #load
// 读这个 Mod 的详情并记日志。
//
// @returns {Promise<void>}
async function load() {
  // 名字还没就绪：路由参数的首次解析是异步的（刷新直进 /mods/xxx 时先空后到），
  // 保持"读取中"等 watcher 再来一次。
  if (!name.value) return
  // 加载态。
  loading.value = true
  // 本地已安装的 Mod（IndexedDB／内存回退）——读不到数据源不影响服务器上的 Mod。
  let modStore = null
  // 容错（本地存储不可用时只读服务器）。
  try {
    // 取存储。
    modStore = await getModStore()
  } catch (e) {
    // 记日志（不阻断）。
    store.pushLog('debug', `[UI][mod-detail] 本地 Mod 存储不可用：${e.message}`)
  }
  // 读（不抛：错误在返回值里）。
  const result = await loadModDetail({ name: name.value, store: modStore })
  // 记录。
  detail.value = result
  // 加载完成。
  loading.value = false
  // 页面日志（可观测：读到了什么 / 出了什么问题）。
  // **带上第一条错误的正文**：只报"错误 1 条"的话，线上出问题时日志报告里查不出原因
  // （2026-10 真实教训：Pages 404 那次报告里只有条数，得靠人肉猜）。
  store.pushLog(result.found ? 'info' : 'warn', `[UI][mod-detail] ${result.found ? '读到' : '未找到'} ${name.value}：${result.present.join('/') || '无数据'}｜文件 ${result.files.length} 个｜${result.errors.length ? `${result.errors.length} 条错误：${result.errors[0]}` : '无错误'}`)
  // 默认页签落在**第一个非空数据集**上（没有数据时留在天赋）。
  const first = DATASETS.find((d) => (stats.value.totals[d.key] || 0) > 0)
  // 切换。
  if (first) tab.value = first.key
}

// Mod 名一变就重新加载。
//
// 为什么不能只写 onMounted：`/mods/a` → `/mods/b` 时路由**复用同一个组件实例**，
// onMounted 不会再触发，页面会看着像"点了没反应"；而且路由参数的首次解析是异步的
// （memory/hash history 的首次导航），必须等参数到齐再读。
watch(name, load, { immediate: true })

// #rows
// 当前页签的条目（归一化成统一结构 → 模板只负责渲染）。
//
// @returns {Array<{id: string, title: string, subtitle: string, badges: string[]}>} 行
const rows = computed(() => {
  // 数据。
  const data = detail.value?.data || {}
  // 关键字（小写）。
  const kw = keyword.value.trim().toLowerCase()
  // 命中判定（标题 + 副标题）。
  const hit = (r) => !kw || `${r.title} ${r.subtitle} ${r.id}`.toLowerCase().includes(kw)
  // 结果。
  let list = []
  // 按页签归一化。
  if (tab.value === 'talents') {
    // 天赋：星级 / 名称 / 描述 / 条件。
    list = Object.values(data.talents || {}).map((t) => ({
      id: String(t?.id ?? ''),
      title: String(t?.name ?? t?.id ?? ''),
      subtitle: String(t?.description ?? ''),
      badges: [gradeLabel(t?.grade), t?.condition ? '有条件' : '', t?.exclusive ? '专属（不入池）' : '', t?.replacement ? '可替换' : ''].filter(Boolean),
    }))
  } else if (tab.value === 'events') {
    // 事件：正文 + 条件/分支标记。
    list = Object.values(data.events || {}).map((e) => ({
      id: String(e?.id ?? ''),
      title: String(e?.event ?? ''),
      subtitle: e?.postEvent ? `补充：${e.postEvent}` : '',
      badges: [e?.NoRandom ? '关键剧情' : '', e?.include ? 'include' : '', e?.exclude ? 'exclude' : '', Array.isArray(e?.branch) && e.branch.length ? `分支×${e.branch.length}` : '', e?.effect ? '属性变化' : ''].filter(Boolean),
    }))
  } else if (tab.value === 'achievements') {
    // 成就：名称 / 描述 / 星级 / 时机。
    list = Object.values(data.achievements || {}).map((a) => ({
      id: String(a?.id ?? ''),
      title: String(a?.name ?? a?.id ?? ''),
      subtitle: String(a?.description ?? ''),
      badges: [gradeLabel(a?.grade), a?.opportunity ? String(a.opportunity) : '', a?.hide ? '隐藏' : '', a?.condition ? '有条件' : ''].filter(Boolean),
    }))
  } else if (tab.value === 'characters') {
    // 名人：名称 / 初始属性 / 专属天赋数。
    list = Object.values(data.characters || {}).map((c) => ({
      id: String(c?.id ?? ''),
      title: String(c?.name ?? c?.id ?? ''),
      subtitle: c?.property && typeof c.property === 'object'
        ? Object.entries(c.property).map(([k, v]) => `${k} ${v}`).join(' · ')
        : '',
      badges: [Array.isArray(c?.talent) && c.talent.length ? `天赋×${c.talent.length}` : ''].filter(Boolean),
    }))
  } else {
    // 年龄表：按年龄升序；标题 = 年龄，副标题 = 候选事件数/天赋数。
    list = Object.values(data.age || {}).map((row) => ({
      id: String(row?.age ?? ''),
      title: `${row?.age} 岁`,
      subtitle: `候选事件 ${Array.isArray(row?.event) ? row.event.length : 0} 个${Array.isArray(row?.talent) && row.talent.length ? ` · 固定天赋 ${row.talent.length} 个` : ''}`,
      badges: [],
    })).sort((a, b) => Number(a.id) - Number(b.id))
  }
  // 过滤。
  return list.filter(hit)
})

// #visibleRows
// 截断后的可见行（避免一次渲染上千条）。
const visibleRows = computed(() => rows.value.slice(0, RENDER_LIMIT))
// 是否被截断。
const truncated = computed(() => rows.value.length > RENDER_LIMIT)
// 当前页签的统计对象（分布图用）。
const tabStats = computed(() => stats.value[tab.value] || {})

// 返回 Mod 管理页。
function back() {
  // 返回。
  router.push('/mods')
}
</script>

<template>
  <div class="mod-detail">
    <h2 class="title">Mod 数据：{{ name }}</h2>
    <div class="actions">
      <button class="btn back" @click="back">← 返回 Mod 管理</button>
      <button class="btn" :disabled="loading" @click="load">↻ 重新读取</button>
    </div>

    <!-- 加载中 -->
    <p v-if="loading" class="hint">读取中…</p>

    <template v-else>
      <!-- 错误（不静默：读不到 / 坏 JSON / manifest 非法都显示出来） -->
      <div v-if="detail?.errors?.length" class="errors">
        <p v-for="(e, i) in detail.errors" :key="i" class="err">⚠ {{ e }}</p>
      </div>

      <!-- 未找到 -->
      <div v-if="!detail?.found" class="section">
        <p class="hint">
          没有这个 Mod（服务器上没有它的 <code>manifest.json</code>，本地也没装）。
          回 Mod 管理页确认名字，或先安装它。
        </p>
      </div>

      <template v-else>
        <!-- manifest 概览 -->
        <div class="section">
          <h3>基本信息</h3>
          <div class="kv">
            <span class="k">名称</span><span class="v">{{ detail.manifest.name || name }}</span>
            <span class="k">版本</span><span class="v">{{ detail.manifest.version || '（未标注）' }}</span>
            <span class="k">作者</span><span class="v">{{ detail.manifest.author || '（未标注）' }}</span>
            <span class="k">描述</span><span class="v">{{ detail.manifest.description || '（未提供描述）' }}</span>
            <span class="k">类型</span>
            <span class="v">
              <span v-if="detail.manifest.system" class="badge sys">系统 Mod</span>
              <span v-else class="badge">第三方 Mod</span>
              <span v-if="detail.manifest.dependencies && Object.keys(detail.manifest.dependencies).length" class="badge">依赖 {{ Object.keys(detail.manifest.dependencies).join('、') }}</span>
            </span>
            <span class="k">权限声明</span>
            <span class="v">
              <span v-if="!detail.manifest.permissions || !detail.manifest.permissions.length" class="dim">（无）</span>
              <span v-for="p in detail.manifest.permissions || []" :key="p" class="badge perm">{{ p }}</span>
            </span>
            <span class="k">目标平台</span>
            <span class="v"><span v-for="t in detail.manifest.targets || ['browser']" :key="t" class="badge">{{ t }}</span></span>
            <span class="k">入口</span>
            <span class="v">
              <span class="badge">浏览器 {{ detail.manifest.entry?.browser || (detail.manifest.targets && !detail.manifest.targets.includes('browser') ? '—' : 'code.js') }}</span>
              <span class="badge">Node {{ detail.manifest.entry?.node || '—' }}</span>
            </span>
            <span class="k">manifest 校验</span>
            <span class="v">
              <span v-if="detail.check?.ok" class="ok">通过</span>
              <span v-else class="err">未通过</span>
            </span>
            <span class="k">代码规模</span>
            <span class="v">{{ detail.codeLines ? `${detail.codeLines} 行（不会被本页执行）` : '（无 code.js）' }}</span>
          </div>
        </div>

        <!-- 数据概览 -->
        <div class="section">
          <h3>数据概览</h3>
          <p class="hint">共 {{ stats.totals.all }} 条内容（按引擎的数据文件约定逐张读取；一张表都没有时说明这个 Mod 只提供代码/钩子）。</p>
          <div class="overview">
            <div v-for="d in DATASETS" :key="d.key" class="cell">
              <span class="num">{{ stats.totals[d.key] }}</span>
              <span class="lbl">{{ d.label }}</span>
            </div>
          </div>
        </div>

        <!-- 可视化：分布图 -->
        <div v-if="stats.totals.all > 0" class="section">
          <h3>分布可视化</h3>

          <!-- 天赋星级 -->
          <template v-if="stats.talents.count">
            <p class="chart-title">天赋星级分布（共 {{ stats.talents.count }} 个）</p>
            <div class="chart">
              <div v-for="b in stats.talents.byGrade" :key="String(b.key)" class="bar-row">
                <span class="bar-label">{{ gradeLabel(b.key) }}</span>
                <span class="bar-track"><span class="bar-fill" :style="{ width: pct(b.count, stats.talents.count) }"></span></span>
                <span class="bar-count">{{ b.count }}</span>
              </div>
            </div>
            <p class="hint">
              有条件 {{ stats.talents.withCondition }} · 专属（不入抽取池）{{ stats.talents.exclusive }} · 带替换链 {{ stats.talents.withReplacement }}
              <template v-if="stats.talents.effectKeys.length"> · 效果涉及 {{ stats.talents.effectKeys.map(e => e.key).join('/') }}</template>
            </p>
          </template>

          <!-- 事件构成 -->
          <template v-if="stats.events.count">
            <p class="chart-title">事件构成（共 {{ stats.events.count }} 条，可重叠）</p>
            <div class="chart">
              <div v-for="b in [
                { k: '关键剧情（不随机）', v: stats.events.noRandom },
                { k: 'include 条件', v: stats.events.withInclude },
                { k: 'exclude 条件', v: stats.events.withExclude },
                { k: '带分支', v: stats.events.withBranch },
                { k: '有属性变化', v: stats.events.withEffect },
                { k: '有补充文本', v: stats.events.withPostEvent },
              ]" :key="b.k" class="bar-row">
                <span class="bar-label">{{ b.k }}</span>
                <span class="bar-track"><span class="bar-fill alt" :style="{ width: pct(b.v, stats.events.count) }"></span></span>
                <span class="bar-count">{{ b.v }}</span>
              </div>
            </div>
            <p class="hint">分支总数 {{ stats.events.branches }} 条<template v-if="stats.events.effectKeys.length"> · 效果涉及 {{ stats.events.effectKeys.map(e => e.key).join('/') }}</template></p>
          </template>

          <!-- 成就时机 -->
          <template v-if="stats.achievements.count">
            <p class="chart-title">成就达成时机（共 {{ stats.achievements.count }} 个）</p>
            <div class="chart">
              <div v-for="b in stats.achievements.byOpportunity" :key="String(b.key)" class="bar-row">
                <span class="bar-label">{{ b.key }}</span>
                <span class="bar-track"><span class="bar-fill gold" :style="{ width: pct(b.count, stats.achievements.count) }"></span></span>
                <span class="bar-count">{{ b.count }}</span>
              </div>
            </div>
            <p class="hint">星级分布 {{ stats.achievements.byGrade.map(b => `${gradeLabel(b.key)} ${b.count}`).join(' · ') }}<template v-if="stats.achievements.hidden"> · 隐藏成就 {{ stats.achievements.hidden }} 个</template></p>
          </template>

          <!-- 年龄覆盖 -->
          <template v-if="stats.age.count">
            <p class="chart-title">年龄覆盖 {{ stats.age.min }} ~ {{ stats.age.max }} 岁（{{ stats.age.count }} 个年龄档）</p>
            <p class="hint">
              候选事件槽位共 {{ stats.age.eventSlots }} 个（平均每岁 {{ stats.age.avgEvents.toFixed(1) }} 个）· 固定天赋槽位 {{ stats.age.talentSlots }} 个
            </p>
            <div class="chart">
              <div v-for="r in stats.age.topAges" :key="r.age" class="bar-row">
                <span class="bar-label">{{ r.age }} 岁</span>
                <span class="bar-track"><span class="bar-fill alt" :style="{ width: pct(r.events, stats.age.topAges[0]?.events || 1) }"></span></span>
                <span class="bar-count">{{ r.events }}</span>
              </div>
            </div>
            <p class="hint">↑ 候选事件最多的 8 个年龄</p>
          </template>
        </div>

        <!-- 条目浏览 -->
        <div class="section">
          <h3>条目浏览</h3>
          <div class="tabs">
            <button
              v-for="d in DATASETS"
              :key="d.key"
              class="chip tab"
              :class="{ active: tab === d.key }"
              @click="tab = d.key"
            >{{ d.label }} {{ stats.totals[d.key] }}</button>
          </div>
          <div class="search-row">
            <input v-model="keyword" class="num wide search" placeholder="搜索名称 / 描述 / ID" />
            <span class="hint">命中 {{ rows.length }} 条<template v-if="truncated">（只显示前 {{ RENDER_LIMIT }} 条，继续输入可缩小范围）</template></span>
          </div>
          <div v-if="!tabCount" class="hint">（这个 Mod 没有{{ DATASETS.find(d => d.key === tab)?.label }}数据）</div>
          <ul v-else class="rows">
            <li v-for="r in visibleRows" :key="r.id" class="row">
              <span class="row-id">{{ r.id }}</span>
              <span class="row-main">
                <span class="row-title">{{ r.title }}</span>
                <span v-if="r.subtitle" class="row-sub">{{ r.subtitle }}</span>
              </span>
              <span class="row-badges">
                <span v-for="b in r.badges" :key="b" class="badge">{{ b }}</span>
              </span>
            </li>
          </ul>
        </div>

        <!-- 文件清单 -->
        <div class="section">
          <h3>文件清单（{{ detail.files.length }}）</h3>
          <p class="hint">
            来源：{{ detail.filesFromIndex ? 'Mod 自带的 files.json' : '引擎的约定清单（该 Mod 没有 files.json）' }}
            <template v-if="detail.dataFrom">
              · 数据目录：<code>{{ detail.dataFrom }}</code>（这个 Mod 的数据放在站点该目录下，不在自己的目录里 —— 系统 Data Mod 就是这样，避免把 4MB 数据复制一份）
            </template>
          </p>
          <p class="files"><code v-for="f in detail.files" :key="f">{{ f }}</code></p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.mod-detail {
  padding: 30px;
  max-width: 900px;
  margin: 0 auto;
}
.title {
  text-align: center;
  margin-bottom: 12px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 18px;
}
.btn {
  padding: 8px 18px;
  border: none;
  border-radius: 6px;
  background: #0f3460;
  color: #fff;
  cursor: pointer;
}
.btn:hover {
  filter: brightness(1.2);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.section {
  background: #16213e;
  border: 1px solid #22304f;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}
.section h3 {
  margin-bottom: 10px;
}
.hint {
  color: #9aa7bd;
  font-size: 12px;
  margin-bottom: 8px;
}
.dim {
  color: #666;
}
.ok {
  color: #4caf50;
}
.err {
  color: #ff6b6b;
}
.errors {
  margin-bottom: 12px;
}
.kv {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 6px 12px;
  font-size: 13px;
}
.k {
  color: #9aa7bd;
}
.v {
  color: #eee;
  word-break: break-all;
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  margin-right: 6px;
  border-radius: 999px;
  background: #0f3460;
  color: #cfe3ff;
  font-size: 11px;
}
.badge.sys {
  background: #e94560;
  color: #fff;
}
.badge.perm {
  background: #2a3a5e;
}
.overview {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
  border-radius: 6px;
  background: #101a33;
}
.cell .num {
  font-size: 20px;
  font-weight: bold;
  color: #ffd700;
}
.cell .lbl {
  font-size: 11px;
  color: #9aa7bd;
}
.chart-title {
  font-size: 13px;
  color: #cfe3ff;
  margin: 10px 0 6px;
}
.bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.bar-label {
  width: 130px;
  flex: none;
  font-size: 11px;
  color: #9aa7bd;
}
.bar-track {
  flex: 1;
  height: 10px;
  border-radius: 4px;
  background: #101a33;
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  background: #e94560;
}
.bar-fill.alt {
  background: #4a7fd4;
}
.bar-fill.gold {
  background: #ffd700;
}
.bar-count {
  width: 48px;
  flex: none;
  text-align: right;
  font-size: 11px;
  color: #eee;
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.chip {
  padding: 5px 12px;
  border: 1px solid #22304f;
  border-radius: 6px;
  background: #101a33;
  color: #9aa7bd;
  cursor: pointer;
  font-size: 12px;
}
.chip.active {
  background: #e94560;
  border-color: #e94560;
  color: #fff;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.num.wide.search {
  width: 220px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #22304f;
  background: #101a33;
  color: #eee;
  font-size: 12px;
}
.rows {
  list-style: none;
  max-height: 420px;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid #22304f;
}
.row-id {
  width: 70px;
  flex: none;
  font-size: 11px;
  color: #ffd700;
}
.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.row-title {
  font-size: 13px;
  color: #eee;
}
.row-sub {
  font-size: 11px;
  color: #9aa7bd;
}
.row-badges {
  flex: none;
  max-width: 320px;
  text-align: right;
}
.files code {
  display: inline-block;
  margin: 0 6px 6px 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: #101a33;
  color: #9aa7bd;
  font-size: 11px;
}
</style>
