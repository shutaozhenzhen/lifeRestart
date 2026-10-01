/**
 * strategy — 模拟策略解析（随机 / 固定，两条轴各自独立）
 *
 * 需求背景：
 *   最初只支持「随机特性 + 随机属性」。实际研究中更常见的是**控制变量**：
 *   「固定特性 + 随机属性」（看某几个天赋对寿命/总评分布的影响），
 *   或反过来「随机特性 + 固定属性」。因此两条轴都支持 random / fixed：
 *
 *     strategy = {
 *       talents:    { mode: 'random' | 'fixed', fixed: ['t1001', 't1002'] },
 *       allocation: { mode: 'random' | 'fixed', fixed: { CHR: 3, INT: 4, STR: 5, MNY: 8 } },
 *     }
 *
 * 固定策略的两条硬约束（都有测试）：
 *   1. 固定特性必须**在数据里存在**：不存在的 ID 被剔除并记入 warnings（不静默生效）；
 *      全空/全无效时回退随机，同样记 warnings（避免"以为在测某天赋，其实没测"）。
 *   2. 固定属性必须**放得进可用点数**：超过预算就按比例缩减（floor 后再按序补足到正好用完），
 *      保证每项 ≤ 单项上限且合计 = 可用点数，并记 warnings。
 */

// 随机策略原语。
import { ALLOC_KEYS, randomAllocation, randomTalents } from './random-strategy.js'

// #DEFAULT_STRATEGY
// 缺省策略：两条轴都随机（与旧行为一致）。
export const DEFAULT_STRATEGY = {
  // 特性。
  talents: { mode: 'random', fixed: [] },
  // 属性。
  allocation: { mode: 'random', fixed: {} },
}

// #normalizeStrategy
// 规范化策略对象（容错：缺字段/类型错误都退回随机）。
//
// @param {object} [strategy] - 原始策略
// @returns {{talents: {mode: string, fixed: string[]}, allocation: {mode: string, fixed: object}}} 规范化结果
export function normalizeStrategy(strategy) {
  // 特性轴。
  const talentMode = strategy?.talents?.mode === 'fixed' ? 'fixed' : 'random'
  // 固定特性 ID：去空、去重、转字符串。
  const fixedTalents = Array.isArray(strategy?.talents?.fixed)
    ? [...new Set(strategy.talents.fixed.filter((id) => id !== null && id !== undefined && id !== '').map((id) => String(id)))]
    : []
  // 属性轴。
  const allocMode = strategy?.allocation?.mode === 'fixed' ? 'fixed' : 'random'
  // 固定属性：只留数值。
  const fixedAlloc = {}
  // 遍历给定的键。
  for (const [key, value] of Object.entries(strategy?.allocation?.fixed || {})) {
    // 数值化（非数字忽略）。
    const num = Number(value)
    // 有效才收。
    if (Number.isFinite(num)) fixedAlloc[key] = num
  }
  // 返回。
  return {
    // 特性。
    talents: { mode: talentMode, fixed: fixedTalents },
    // 属性。
    allocation: { mode: allocMode, fixed: fixedAlloc },
  }
}

// #sumValues
// 求和（辅助）。
function sumValues(obj) {
  // 累加。
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0)
}

// #resolveTalents
// 解析本局使用的天赋。
//
// @param {object} params
// @param {object} params.strategy - 已规范化策略
// @param {Array<object>} [params.pool] - 随机模式的抽卡池
// @param {number} [params.limit] - 可选上限
// @param {Function} [params.isConflict] - 互斥判定（随机模式用）
// @param {Function} [params.random] - 随机源
// @param {object} [params.talentTable] - 全量天赋表（id → 天赋对象），用于校验与取名
// @returns {{talents: string[], mode: string, warnings: string[]}} 结果
export function resolveTalents({ strategy, pool = [], limit = 3, isConflict, random = Math.random, talentTable } = {}) {
  // 规范化。
  const norm = normalizeStrategy(strategy)
  // 警告收集。
  const warnings = []
  // 随机模式：直接抽卡。
  if (norm.talents.mode !== 'fixed') {
    // 抽取。
    const talents = randomTalents({ pool, limit, isConflict, random })
    // 返回。
    return { talents, mode: 'random', warnings }
  }
  // 固定模式：校验 ID 是否真实存在。
  const known = []
  // 未知 ID。
  const unknown = []
  // 逐个校验。
  for (const id of norm.talents.fixed) {
    // 无表可查时按"信任传入值"处理（保持可测性）。
    if (talentTable && !(id in talentTable)) {
      // 记入未知。
      unknown.push(id)
      // 跳过。
      continue
    }
    // 去重收下。
    if (!known.includes(id)) known.push(id)
  }
  // 未知 ID 提醒（不静默）。
  if (unknown.length > 0) warnings.push(`固定特性中有 ${unknown.length} 个 ID 不存在，已忽略：${unknown.join('、')}`)
  // 一个有效都没有 → 回退随机。
  if (known.length === 0) {
    // 抽取。
    const talents = randomTalents({ pool, limit, isConflict, random })
    // 提醒。
    warnings.push('固定特性列表为空或全部无效，本局已回退随机特性')
    // 返回（mode 仍标 random，便于统计时看出实际用了什么）。
    return { talents, mode: 'random', warnings }
  }
  // 超出可选上限：截断并提醒。
  if (known.length > limit) {
    // 提醒。
    warnings.push(`固定特性 ${known.length} 个超过上限 ${limit}，已截取前 ${limit} 个`)
  }
  // 返回（保持用户给定顺序 → 可复现）。
  return { talents: known.slice(0, limit), mode: 'fixed', warnings }
}

// #resolveAllocation
// 解析本局使用的属性分配。
//
// @param {object} params
// @param {object} params.strategy - 已规范化策略
// @param {number} params.points - 可用点数
// @param {Array<string>} [params.keys] - 可分配属性
// @param {number} [params.max] - 单项上限
// @param {Function} [params.random] - 随机源
// @returns {{allocation: object, mode: string, warnings: string[]}} 结果
export function resolveAllocation({ strategy, points = 0, keys = ALLOC_KEYS, max = 10, random = Math.random } = {}) {
  // 规范化。
  const norm = normalizeStrategy(strategy)
  // 警告。
  const warnings = []
  // 随机模式。
  if (norm.allocation.mode !== 'fixed') {
    // 随机分配。
    return { allocation: randomAllocation({ points, keys, max, random }), mode: 'random', warnings }
  }
  // 固定模式：先按 [0, max] 截断。
  const requested = {}
  // 逐项处理。
  for (const key of keys) {
    // 取给定值（缺省 0）。
    const value = Math.floor(Number(norm.allocation.fixed[key]) || 0)
    // 截断到合法区间。
    requested[key] = Math.max(0, Math.min(max, value))
  }
  // 合计。
  const total = sumValues(requested)
  // 在预算内：原样使用。
  if (total <= points) {
    // 返回。
    return { allocation: { ...requested }, mode: 'fixed', warnings }
  }
  // 超预算：按比例缩减。
  const scaled = {}
  // 逐项 floor。
  for (const key of keys) scaled[key] = Math.floor((requested[key] * points) / total)
  // 余下点数（floor 丢掉的零头）。
  let left = points - sumValues(scaled)
  // 按序补足（不超出该项的原始请求，避免把点补到用户没要的属性上）。
  for (const key of keys) {
    // 该项还能补多少。
    while (left > 0 && scaled[key] < requested[key]) {
      // 补一点。
      scaled[key]++
      // 余量减少。
      left--
    }
  }
  // 提醒。
  warnings.push(`固定属性合计 ${total} 超过可用 ${points}，已按比例缩减为 ${sumValues(scaled)}`)
  // 返回。
  return { allocation: scaled, mode: 'fixed', warnings }
}
