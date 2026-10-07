/**
 * statistics-view — 统计项的展示定义（键 → 中文标签 + 格式化方式）
 *
 * 为什么单独成模块（真实缺陷复盘）：
 *   引擎给 `life.statistics` 加了 `RACHV`（成就达成率）后，总结页只在自己文件里
 *   维护「标签表」与「比率格式化列表」两份手写清单 —— 两份都漏了 RACHV，
 *   于是页面直接显示内部键名与裸浮点：`RACHV 0.006060606060606061（普通）`。
 *   根因不是"漏了一行"，而是**同一件事写了两份、且没有覆盖性检查**。
 *   这里合成一张表：一个键要么有完整定义（标签 + kind），要么就是未登记；
 *   配套测试会拿引擎真实的 statistics 键来核对（引擎新增统计项而界面没跟上 → 直接红）。
 */

// #STATISTICS_VIEW
// 统计项的展示定义。
//   - count：计数，原样显示（可选带分母）
//   - ratio：0~1 比率，显示成百分比
//   - hidden：不在「收集统计」列表里重复显示（页头已单独展示）
export const STATISTICS_VIEW = {
  // 重开次数（页头已显示）。
  TMS: { label: '重开次数', kind: 'count', hidden: true },
  // 累计达成成就数。
  CACHV: { label: '成就达成数', kind: 'count' },
  // 成就达成率（CACHV / 成就总数）。
  RACHV: { label: '成就达成率', kind: 'ratio' },
  // 天赋选择率（已选过的天赋 / 天赋总数）。
  RTLT: { label: '天赋选择率', kind: 'ratio' },
  // 事件收集率（已触发过的事件 / 事件总数）。
  REVT: { label: '事件收集率', kind: 'ratio' },
}

// #EXTERNAL_STATISTICS
// **外部登记**（2026-10 能力补齐 ③：Mod 通过 `manifest.ui.stats` / `gameAPI.ui.addStat`
// 声明自己的统计项）。键 → 展示定义，与内置的 STATISTICS_VIEW 同形。
//
// ⚠️ 与内置表分开存：内置表是"引擎统计项 ↔ 界面"的**编译期契约**（有覆盖性守卫），
//    外部登记是**运行期**来的，混进 STATISTICS_VIEW 会让那条守卫失去意义（它核对的
//    应该是"引擎有哪些键"，不是"这一局注册了哪些键"）。
const EXTERNAL_STATISTICS = {}

// #registerExternalStatistics
// 登记一批外部统计项（幂等；重复登记同 key 以后者为准）。
//
// 只有 Mod 声明的 key 在 `life.statistics` 里**真实存在**时才该调这里（SummaryView 负责
// 这个判断并给出 warn）—— 否则页面上会出现一行永远显示 `—` 的假统计。
//
// @param {Array<{key: string, label: string, kind?: string}>} items - 声明项
// @returns {number} 实际登记的条数
export function registerExternalStatistics(items = []) {
  // 计数。
  let n = 0
  // 逐项。
  for (const item of items || []) {
    // 形状/键非法跳过（不抛：运行期数据不该让总结页崩）。
    if (!item || typeof item.key !== 'string' || item.key.length === 0) continue
    // 标签（缺失退回键名，与内部登记一致）。
    const label = typeof item.label === 'string' && item.label.length > 0 ? item.label : item.key
    // kind 白名单（缺省 count）。
    const kind = item.kind === 'ratio' ? 'ratio' : 'count'
    // 登记。
    EXTERNAL_STATISTICS[item.key] = { label, kind }
    // 计数。
    n++
  }
  // 返回。
  return n
}

// #clearExternalStatistics
// 清掉全部外部登记（重开一局 / 测试用）。
//
// @returns {void}
export function clearExternalStatistics() {
  // 清。
  for (const key of Object.keys(EXTERNAL_STATISTICS)) delete EXTERNAL_STATISTICS[key]
}

// #statisticsDef
// 取某个键的展示定义（内置优先；内置没有则看外部登记）。
//
// @param {string} key - 统计键
// @returns {object|undefined} 定义
function statisticsDef(key) {
  // 内置优先（引擎自己的统计项永远是权威定义）。
  return STATISTICS_VIEW[key] || EXTERNAL_STATISTICS[key]
}

// #statisticsLabel
// 取中文标签（未登记的键原样返回，并会被覆盖性测试拦住）。
//
// @param {string} key - 统计键
// @returns {string} 标签
export function statisticsLabel(key) {
  // 已登记用标签，否则回退键名。
  return statisticsDef(key)?.label || key
}

// #isKnownStatistic
// 是否已登记展示定义（内置或外部）。
//
// @param {string} key - 统计键
// @returns {boolean} 是否登记
export function isKnownStatistic(key) {
  // 判断。
  return Object.prototype.hasOwnProperty.call(STATISTICS_VIEW, key)
    || Object.prototype.hasOwnProperty.call(EXTERNAL_STATISTICS, key)
}

// #formatStatistic
// 按 kind 格式化数值。
//
// @param {string} key - 统计键
// @param {object} item - 引擎统计项 { value, judge }
// @param {object} [options]
// @param {number} [options.totalAchievements] - 成就总数（给 CACHV 显示分母）
// @returns {string} 展示文本
export function formatStatistic(key, item, { totalAchievements } = {}) {
  // 缺项。
  if (!item) return '—'
  // 定义（内置优先，其次外部登记 —— 见 statisticsDef）。
  const def = statisticsDef(key)
  // 比率 → 百分比（一位小数）。
  if (def?.kind === 'ratio') return `${(Number(item.value || 0) * 100).toFixed(1)}%`
  // 成就达成数：有总数就显示 n / 总（比单看一个数字有用）。
  if (key === 'CACHV' && totalAchievements) return `${item.value} / ${totalAchievements}`
  // 其余原样。
  return String(item.value ?? '—')
}

// #visibleStatistics
// 把引擎的 statistics 转成可直接渲染的行（跳过 hidden 项）。
//
// @param {object} statistics - life.statistics
// @param {object} [options] - 透传（totalAchievements）
// @returns {Array<{key: string, label: string, text: string, judge: string|null, known: boolean}>} 行
export function visibleStatistics(statistics, options = {}) {
  // 逐项。
  return Object.entries(statistics || {})
    // 跳过页头已展示的项（内置表里的 hidden；外部登记没有 hidden 这个概念）。
    .filter(([key]) => !STATISTICS_VIEW[key]?.hidden)
    // 转成展示行。
    .map(([key, item]) => ({
      // 原始键（列表 key 用）。
      key,
      // 中文标签。
      label: statisticsLabel(key),
      // 格式化后的值。
      text: formatStatistic(key, item, options),
      // 评价键（页面翻中文）。
      judge: item?.judge ?? null,
      // 是否已登记（未登记会被测试拦住）。
      known: isKnownStatistic(key),
    }))
}
