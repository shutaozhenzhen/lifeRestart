/**
 * simulator — 批量模拟内核（随机天赋 + 随机属性，跑多局并聚合结果）
 *
 * 用途：
 *   1. CLI 原型：`node src/cli/simulate.cli.js --runs 500 --seed 42`
 *   2. 前端「模拟统计」页：同一个内核分批驱动（每批若干局，中间让出主线程）
 *   —— 两处共用一份实现，避免"页面上算一套、CLI 里算另一套"。
 *
 * 关键设计：
 *   - **复用同一个 Life 实例**：每局的"重开"走 `remake()/start()`（会重置本局属性），
 *     不必重新解析 3.5MB 的 age 数据——这是能跑到上千局的前提。
 *   - 每局结果都是纯数据快照，聚合只依赖这些快照，可单独测试。
 *   - 时间/随机源全部可注入，测试用固定种子即可完整复现。
 */

// 随机策略（纯函数）。
import { ALLOC_KEYS } from './random-strategy.js'
// 策略解析（随机 / 固定，两条轴独立）。
import { DEFAULT_STRATEGY, normalizeStrategy, resolveAllocation, resolveTalents } from './strategy.js'
// 引擎实例与种子随机源（createSimulation 用）。
import Life from '../modules/life.js'
import { createRng } from '../functions/util.js'
// 批量场景的**跳过策略**（`async: true` / `deterministic: false` 的 Mod 不可逐位复现；
// 2026-10 能力补齐 ④）—— 与 consistency.cli.js 共用同一处实现，避免两份策略分叉。
import { modsToSkip } from '../mod/manifest.js'

// #MAX_YEARS
// 单局推进上限（数据覆盖 501 岁；这里留足余量并防止异常数据导致死循环）。
export const MAX_YEARS = 1000

// #avg
// 平均值（空数组返回 0）。
function avg(list) {
  // 空保护。
  if (!list || list.length === 0) return 0
  // 求和取平均。
  const total = list.reduce((a, b) => a + (Number(b) || 0), 0)
  // 保留两位小数，避免浮点噪声污染展示。
  return Math.round((total / list.length) * 100) / 100
}

// #median
// 中位数（空数组返回 0）。
function median(list) {
  // 空保护。
  if (!list || list.length === 0) return 0
  // 排序副本。
  const sorted = [...list].sort((a, b) => a - b)
  // 中点。
  const mid = Math.floor(sorted.length / 2)
  // 奇数取中间，偶数取两者均值。
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100
}

// #histogram
// 按 10 岁一档统计寿命分布（100 岁及以上合并为 "100+"）。
//
// @param {Array<number>} ages - 寿命列表
// @returns {Array<{label: string, count: number}>} 分档计数
export function histogram(ages = []) {
  // 分档定义。
  const buckets = []
  // 0-9 … 90-99。
  for (let start = 0; start < 100; start += 10) {
    // 标签。
    buckets.push({ label: `${start}-${start + 9}`, count: 0 })
  }
  // 100+。
  buckets.push({ label: '100+', count: 0 })
  // 归入分档。
  for (const age of ages) {
    // 数值化。
    const value = Math.max(0, Math.floor(Number(age) || 0))
    // 落在哪个档。
    const index = value >= 100 ? buckets.length - 1 : Math.floor(value / 10)
    // 计数。
    buckets[index].count++
  }
  // 返回。
  return buckets
}

// #collectionOf
// 读取引擎的收集统计（成就数 / 天赋选择率 / 事件收集率）。
//
// @param {object} life - Life 实例
// @returns {{achievements: number, talentRate: number, eventRate: number, achievementRate: number}} 收集统计
export function collectionOf(life) {
  // 统计项。
  const st = (life && life.statistics) || {}
  // 规范化（缺项返回 0）。
  return {
    // 累计达成成就数。
    achievements: st.CACHV?.value || 0,
    // 天赋选择率（0~1）。
    talentRate: st.RTLT?.value || 0,
    // 事件收集率（0~1）。
    eventRate: st.REVT?.value || 0,
    // 成就达成率（0~1）。
    achievementRate: st.RACHV?.value || 0,
  }
}

// #runOneLife
// 跑一局：按策略准备天赋与属性 → 推进到结束 → 采集快照。
//
// @param {object} params
// @param {object} params.life - Life 实例（会被就地重开，可复用）
// @param {Function} [params.random] - 随机源
// @param {object} [params.strategy] - 策略（缺省两条轴都随机）
// @param {object} [params.talentTable] - 全量天赋表（id → 对象），固定特性校验与取名用
// @returns {object} 单局结果
export function runOneLife({ life, random = Math.random, strategy, talentTable } = {}) {
  // 规范化策略。
  const plan = normalizeStrategy(strategy)
  // 1) 天赋：随机模式抽卡；固定模式用给定 ID（带存在性校验）。
  // 惰性抽卡：固定模式下如果 ID 都有效就不抽（省一次随机数消耗，也让固定实验更稳定）；
  // 但若固定列表为空/全部无效（会回退随机），必须先备好抽卡池——否则会跑出"没有天赋的一局"。
  const fixedValid = plan.talents.mode === 'fixed'
    ? plan.talents.fixed.filter((id) => !talentTable || id in talentTable)
    : []
  // 是否需要抽卡池。
  const needPool = plan.talents.mode !== 'fixed' || fixedValid.length === 0
  // 抽卡池。
  const pool = needPool ? life.talentRandom() : []
  // 解析结果。
  const talentResolved = resolveTalents({
    // 策略。
    strategy: plan,
    // 抽卡池。
    pool,
    // 上限（引擎配置）。
    limit: life.talentSelectLimit,
    // 互斥判定：引擎的 exclude 返回冲突 ID 或 null。
    isConflict: (chosen, id) => life.exclude(chosen, id) !== null,
    // 随机源。
    random,
    // 全量天赋表。
    talentTable,
  })
  // 选中的天赋。
  const talents = talentResolved.talents
  // 2) 属性：随机模式随机分配；固定模式按给定值（超预算按比例缩减）。
  const allocationResolved = resolveAllocation({
    // 策略。
    strategy: plan,
    // 可分配点数（含天赋加成）。
    points: life.getPropertyPoints(),
    // 四项可分配属性。
    keys: ALLOC_KEYS,
    // 单项上限。
    max: Array.isArray(life.propertyAllocateLimit) ? life.propertyAllocateLimit[1] : 10,
    // 随机源。
    random,
  })
  // 分配结果。
  const allocation = allocationResolved.allocation
  // 3) 开局（remake 会重置本局属性并跑天赋替换链）。
  const replaces = life.remake(talents)
  // 应用分配。
  life.start(allocation)
  // 4) 逐年推进到结束（带上限保护）。
  let years = 0
  // 事件/天赋触发条数。
  let events = 0
  let talentsTriggered = 0
  // 循环。
  while (!life.request('PROPERTY').isEnd() && years < MAX_YEARS) {
    // 推进一年。
    const result = life.next()
    // 计数。
    years++
    // 统计条目类型。
    for (const item of result.content || []) {
      // 事件。
      if (item.type === 'EVT') events++
      // 天赋触发。
      else if (item.type === 'TLT') talentsTriggered++
    }
    // 引擎判定结束：不必再推进。
    if (result.isEnd) break
  }
  // 5) 采集快照（summary 会顺带触发 SUMMARY 时机的成就检测，与真实流程一致）。
  const summary = life.summary || {}
  // 可见属性。
  const propertys = { ...life.propertys }
  // 累计达成数（本局增量由 createSimulator 计算）。
  const achievedTotal = life.achievements.filter((a) => a.isAchieved).length
  // 抽卡池按 ID 索引（随机模式下用于把选中的 ID 还原成可读天赋信息）。
  const poolById = new Map((pool || []).filter((t) => t && t.id !== undefined).map((t) => [t.id, t]))
  // 取名：优先全量天赋表（固定特性不在抽卡池里，必须查表），其次抽卡池。
  const lookup = (id) => talentTable?.[id] || poolById.get(id)
  // 选中天赋的明细（ID + 名称 + 星级；名称缺失时回退 ID）。
  const talentDetails = talents.map((id) => ({
    // ID。
    id,
    // 名称。
    name: lookup(id)?.name || String(id),
    // 星级。
    grade: lookup(id)?.grade ?? null,
  }))
  // 本局警告（固定特性无效 / 固定属性超预算等）。
  const warnings = [...talentResolved.warnings, ...allocationResolved.warnings]
  // 返回快照。
  return {
    // 寿命。
    age: propertys.AGE,
    // 随机到的天赋。
    talents,
    // 天赋明细（供 UI 展示名称）。
    talentDetails,
    // 本局实际使用的特性来源（random/fixed：固定列表全无效时会回退成 random，需如实记录）。
    talentsMode: talentResolved.mode,
    // 本局实际使用的属性来源。
    allocationMode: allocationResolved.mode,
    // 本局策略与本局警告（导出与聚合都会带上）。
    strategy: plan,
    warnings,
    // 天赋替换条数。
    replaces: Array.isArray(replaces) ? replaces.length : 0,
    // 属性分配。
    allocation,
    // 终局属性（CHR/INT/STR/MNY/SPR/AGE…）。
    propertys,
    // 总评（数值 + 评价键）。
    sum: summary.SUM?.value ?? 0,
    grade: summary.SUM?.judge ?? null,
    // 历史最高年龄。
    maxAge: summary.HAGE?.value ?? null,
    // 历史最高属性。
    maxPropertys: {
      // 最高颜值。
      CHR: summary.HCHR?.value ?? null,
      // 最高智力。
      INT: summary.HINT?.value ?? null,
      // 最高体质。
      STR: summary.HSTR?.value ?? null,
      // 最高家境。
      MNY: summary.HMNY?.value ?? null,
      // 最高快乐。
      SPR: summary.HSPR?.value ?? null,
    },
    // 本局事件条数。
    events,
    // 本局触发的天赋次数。
    talentsTriggered,
    // 累计成就数（供上层算增量）。
    achievedTotal,
  }
}

// #summarize
// 聚合多局结果。
//
// @param {Array<object>} results - 单局结果数组
// @param {object} [meta]
// @param {number|null} [meta.seed] - 使用的随机种子（便于复现）
// @param {object} [meta.collection] - collectionOf() 的快照
// @returns {object} 聚合统计
export function summarize(results = [], meta = {}) {
  // 局数。
  const runs = results.length
  // 空结果：返回可渲染的零值结构（避免调用方到处判空）。
  if (runs === 0) {
    // 零值聚合。
    return {
      // 局数。
      runs: 0,
      // 种子。
      seed: meta.seed ?? null,
      // 寿命统计。
      age: { min: 0, max: 0, avg: 0, median: 0, histogram: histogram([]) },
      // 总评统计。
      sum: { min: 0, max: 0, avg: 0, grades: {} },
      // 属性均值。
      propertys: {},
      // 历史最高均值。
      maxPropertys: {},
      // 收集统计（取引擎末态）。
      collection: meta.collection || {},
      // 平均本局成就数。
      achievementsPerRun: 0,
      // 策略（固定/随机）。
      strategy: meta.strategy || null,
      // 警告。
      warnings: [],
      // 最佳/最长寿样本。
      best: null,
      longest: null,
    }
  }
  // 寿命列表。
  const ages = results.map((r) => r.age)
  // 总评列表。
  const sums = results.map((r) => r.sum)
  // 分档计数。
  const grades = {}
  // 逐局累计分档。
  for (const r of results) {
    // 无评价键则跳过。
    if (!r.grade) continue
    // 计数。
    grades[r.grade] = (grades[r.grade] || 0) + 1
  }
  // 属性均值（终局）。
  const propertys = {}
  // 逐属性求均值。
  for (const key of ['CHR', 'INT', 'STR', 'MNY', 'SPR']) {
    propertys[key] = avg(results.map((r) => r.propertys?.[key] ?? 0))
  }
  // 历史最高属性均值。
  const maxPropertys = {}
  // 逐属性求均值。
  for (const key of ['CHR', 'INT', 'STR', 'MNY', 'SPR']) {
    maxPropertys[key] = avg(results.map((r) => r.maxPropertys?.[key] ?? 0))
  }
  // 最佳一局：总评最高（并列取更长寿）。
  const best = results.reduce((a, b) => (b.sum > a.sum || (b.sum === a.sum && b.age > a.age) ? b : a))
  // 最长寿一局。
  const longest = results.reduce((a, b) => (b.age > a.age ? b : a))
  // 返回聚合。
  return {
    // 局数。
    runs,
    // 种子。
    seed: meta.seed ?? null,
    // 寿命统计。
    age: { min: Math.min(...ages), max: Math.max(...ages), avg: avg(ages), median: median(ages), histogram: histogram(ages) },
    // 总评统计。
    sum: { min: Math.min(...sums), max: Math.max(...sums), avg: avg(sums), grades },
    // 属性均值。
    propertys,
    // 历史最高均值。
    maxPropertys,
    // 收集统计。
    collection: meta.collection || {},
    // 平均每局达成成就数。
    achievementsPerRun: avg(results.map((r) => r.achievements || 0)),
    // 策略（优先用调用方给的，其次取第一局记录的）。
    strategy: meta.strategy || results[0]?.strategy || null,
    // 去重后的警告（固定特性无效、固定属性超预算等，导出与 UI 都会展示）。
    warnings: [...new Set(results.flatMap((r) => r.warnings || []))],
    // 最佳一局。
    best,
    // 最长寿一局。
    longest,
  }
}

// #skipPolicyWarning
// 把**跳过策略**变成一条给用户看的警告（2026-10 能力补齐 ④）。
//
// 为什么必须有这条（而不是"悄悄跳过"）：批量模拟的结论是"寿命分布 / 收集率"，而
// `async: true` 的 Mod 逐岁等外部世界 → 不可逐位复现；`deterministic: false` 同理。
// 静默跳过会让报告里的数字**少了一块却没人知道**（旧约定：警告必须一路带到
// `stats.warnings` / 报告 / 页面）。
//
// @param {object} params
// @param {Array<{name: string, reasons: string[]}>} [params.skipped] - modsToSkip() 的 notReproducible
// @param {object} [params.simulator] - 模拟器（有则把警告并进它的逐局结果 → summarize 带上）
// @param {Array} [params.results] - 单局结果数组（没有 simulator 时用它）
// @param {object} [params.log] - 日志器（出声）
// @returns {string[]} 警告文本（空数组 = 没有跳过任何东西）
export function skipPolicyWarning({ skipped = [], simulator = null, results = null, log } = {}) {
  // 没有要跳过的。
  if (!Array.isArray(skipped) || skipped.length === 0) return []
  // 警告文本（逐 Mod 一行、带上理由 —— "为什么少了一个 Mod"必须自解释）。
  const warnings = skipped.map((x) => `批量模拟已跳过 Mod ${x.name}（${(x.reasons || []).join('；')}）—— 异步/不确定行为无法逐位复现，它的数据与代码未参与本报告`)
  // 并进逐局结果（summarize 会把它们去重汇总到 stats.warnings；页面的"每局警告"也能看到）。
  if (simulator && Array.isArray(simulator.results)) {
    // 逐局补。
    for (const r of simulator.results) r.warnings = [...(r.warnings || []), ...warnings]
  } else if (Array.isArray(results)) {
    // 直接给的结果数组。
    for (const r of results) r.warnings = [...(r.warnings || []), ...warnings]
  }
  // 出声。
  for (const w of warnings) log?.warn?.(w)
  // 返回。
  return warnings
}

// #createSimulation
// 一站式创建模拟环境（**推荐的入口**）。
//
// 为什么需要它（测试暴露的坑）：
//   可复现要求「游戏内部的随机」与「模拟策略的随机」来自同一个种子序列。
//   但游戏内部的随机（事件抽取、RDM 效果）来自 **Life 实例自己的随机源**，
//   只给 createSimulator 传 random 是**不够的**——那样两套相同种子的模拟器
//   仍会跑出不同的人生。这里把同一个 RNG 同时注入 Life 与策略层，
//   让"正确用法"成为唯一用法。
//
// @param {object} params
// @param {object} params.data - 游戏数据
// @param {number|null} [params.seed] - 随机种子（null/缺省 → Math.random，不可复现）
// @param {Function} [params.random] - 直接注入随机源（优先于 seed）
// @param {object} [params.storage] - 存储适配器（模拟建议传内存实现，避免污染玩家存档）
// @param {object} [params.logger] - 日志器
// @param {object} [params.propertyConfig] - 属性 judge 配置（缺省用引擎内置）
// @returns {Promise<{life: object, simulator: object, seed: number|null, random: Function}>} 模拟环境
export async function createSimulation({ data, seed = null, random, storage, logger, propertyConfig, strategy } = {}) {
  // 随机源：显式注入优先；给了种子用种子 RNG；否则 Math.random（不可复现）。
  const rng = typeof random === 'function' ? random : seed === null || seed === undefined ? Math.random : createRng(seed)
  // 建实例（同一个 RNG 注入 Life）。
  const life = new Life({ data, random: rng, storage, logger })
  // 初始化数据。
  await life.initial()
  // 配置（空参走内置 judge 分档；显式传入则以传入为准）。
  life.config(propertyConfig ? { propertyConfig } : undefined)
  // 模拟器（策略层复用同一个 RNG；天赋表用于固定特性校验与取名）。
  const simulator = createSimulator({ life, random: rng, strategy, talentTable: data?.talents })
  // 返回。
  return { life, simulator, seed: typeof random === 'function' ? null : seed ?? null, random: rng }
}

// #createSimulator
// 创建模拟器：分批跑、可查询进度、最后聚合。
//
// 注意：`random` 只影响**策略层**（抽天赋/分属性）。要完整可复现，
// 请用 createSimulation()，或自己把同一个种子 RNG 也传给 Life 构造函数。
//
// @param {object} params
// @param {object} params.life - Life 实例（调用方负责构造，通常是内存 storage 的实例）
// @param {Function} [params.random] - 随机源（固定种子可复现）
// @param {object} [params.strategy] - 策略（随机/固定特性与属性；缺省都随机）
// @param {object} [params.talentTable] - 全量天赋表（固定特性校验与取名）
// @param {Function} [params.onRun] - 每局结束回调（(result, index) => void）
// @returns {{run: Function, runOne: Function, results: Array, summarize: Function, collection: Function, progress: Function}} 模拟器
export function createSimulator({ life, random = Math.random, strategy = DEFAULT_STRATEGY, talentTable, onRun } = {}) {
  // 已完成的局结果。
  const results = []
  // 规范化策略（一次即可，逐局复用）。
  const plan = normalizeStrategy(strategy)
  // 上一局的累计成就数（用于算本局增量）。
  let prevAchieved = 0
  // #runOne：跑一局并入队。
  function runOne() {
    // 跑一局。
    const result = runOneLife({ life, random, strategy: plan, talentTable })
    // 本局成就增量（引擎的 ACHV 是累计值）。
    result.achievements = Math.max(0, (result.achievedTotal || 0) - prevAchieved)
    // 更新基准。
    prevAchieved = result.achievedTotal || 0
    // 入队。
    results.push(result)
    // 回调。
    if (typeof onRun === 'function') onRun(result, results.length)
    // 返回。
    return result
  }
  // 返回对外接口。
  return {
    // 分批跑 count 局。
    run(count = 1) {
      // 逐局。
      for (let i = 0; i < count; i++) {
        // 跑。
        runOne()
      }
      // 返回累计结果。
      return results
    },
    // 只跑一局。
    runOne,
    // 结果（响应式引用：前端可据此渲染进度）。
    results,
    // 已完成局数。
    progress() {
      // 局数。
      return results.length
    },
    // 当前收集统计（引擎末态）。
    collection() {
      // 读取。
      return collectionOf(life)
    },
    // 聚合（含种子、策略与收集统计）。
    summarize(meta = {}) {
      // 聚合。
      return summarize(results, {
        // 种子。
        seed: meta.seed ?? null,
        // 策略：调用方覆盖优先，否则用本模拟器的策略。
        strategy: meta.strategy || plan,
        // 收集统计。
        collection: collectionOf(life),
      })
    },
  }
}
