/**
 * exporters — 模拟结果导出（CSV / JSON / Markdown）
 *
 * 为什么放引擎侧：
 *   CLI（写文件）与前端（下载）都需要同一份序列化。放在页面里就会出现
 *   "页面导出的 CSV 和 CLI 导出的不一样"，且无法用纯函数测试。
 *
 * 设计：
 *   - 三个纯函数 toCSV / toMarkdown / toJSON：输入 (stats, results, meta)，输出字符串。
 *   - exportSimulation() 统一分发，同时给出文件名与 MIME（供 <a download> 与写文件用）。
 *   - CSV 做**标准转义**（含逗号/引号/换行的单元格加引号并把内部引号翻倍）——
 *     天赋名称、事件文本都可能带这些字符，不转义会直接破坏列结构。
 */

// 导出格式与扩展名/MIME。
const FORMATS = {
  // 逗号分隔值：给 Excel / pandas。
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  // 结构化原始数据：给脚本消费或二次分析。
  json: { ext: 'json', mime: 'application/json;charset=utf-8' },
  // Markdown：给人看，可直接贴进 issue / PR / 文档。
  md: { ext: 'md', mime: 'text/markdown;charset=utf-8' },
}

// #FORMAT_LIST
// 支持的格式列表（UI 渲染按钮用）。
export const FORMAT_LIST = Object.keys(FORMATS)

// #属性中文名
// 与页面展示保持一致。
const PROP_LABELS = { CHR: '颜值', INT: '智力', STR: '体质', MNY: '家境', SPR: '快乐' }

// #pad
// 两位补零。
function pad(n) {
  // 补零。
  return String(n).padStart(2, '0')
}

// #formatStamp
// 时间戳：YYYYMMDD-HHmmss（文件名与报告头部共用）。
//
// @param {Date} [date] - 时间（缺省当前）
// @returns {string} 形如 20261001-184000
export function formatStamp(date = new Date()) {
  // 拼装。
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

// #buildFileName
// 生成导出文件名（ASCII 安全，避免各平台下载乱码）。
//
// @param {object} params
// @param {string} params.format - csv/json/md
// @param {number} [params.runs] - 局数
// @param {number|null} [params.seed] - 种子
// @param {Date} [params.date] - 时间
// @returns {string} 文件名
export function buildFileName({ format = 'json', runs = 0, seed = null, date = new Date() } = {}) {
  // 扩展名。
  const ext = FORMATS[format]?.ext || 'txt'
  // 种子片段（无种子省略）。
  const seedPart = seed === null || seed === undefined ? '' : `-seed${seed}`
  // 拼装。
  return `liferestart-sim-runs${runs}${seedPart}-${formatStamp(date)}.${ext}`
}

// #formatStrategy
// 把策略对象渲染成一行可读文本（报告头部/CSV 注释用）。
//
// @param {object} [strategy] - 策略
// @param {object} [options]
// @param {Function} [options.talentName] - ID → 名称
// @returns {string} 文本
export function formatStrategy(strategy, { talentName } = {}) {
  // 缺省。
  if (!strategy) return '特性：随机；属性：随机'
  // 特性部分。
  const talentMode = strategy.talents?.mode === 'fixed' ? 'fixed' : 'random'
  // 固定特性名列表。
  const fixedTalents = (strategy.talents?.fixed || []).map((id) => (talentName ? talentName(id) : id))
  // 特性文案。
  const talents = talentMode === 'fixed' ? `固定（${fixedTalents.join('、') || '未指定'}）` : '随机'
  // 属性部分。
  const allocMode = strategy.allocation?.mode === 'fixed' ? 'fixed' : 'random'
  // 固定属性文案。
  const alloc = allocMode === 'fixed'
    ? `固定（${Object.entries(strategy.allocation?.fixed || {}).map(([k, v]) => `${PROP_LABELS[k] || k} ${v}`).join(' / ')}）`
    : '随机'
  // 组合。
  return `特性：${talents}；属性：${alloc}`
}

// #normalizeStats
// 容错：stats 缺失/非对象时给一份可渲染的零值结构。
// （导出是"最后一公里"，不该因为调用方还没拿到聚合就崩掉整个流程。）
//
// @param {object} stats - 聚合结果
// @param {Array<object>} results - 逐局结果
// @returns {object} 可安全读取的聚合结果
function normalizeStats(stats, results = []) {
  // 已是对象直接用。
  if (stats && typeof stats === 'object') return stats
  // 零值结构。
  return {
    // 局数。
    runs: (results || []).length,
    // 种子。
    seed: null,
    // 寿命。
    age: { min: 0, max: 0, avg: 0, median: 0, histogram: [] },
    // 总评。
    sum: { min: 0, max: 0, avg: 0, grades: {} },
    // 属性。
    propertys: {},
    maxPropertys: {},
    // 收集。
    collection: {},
    // 每局成就。
    achievementsPerRun: 0,
    // 策略与警告。
    strategy: null,
    warnings: [],
    // 样本。
    best: null,
    longest: null,
  }
}

// #csvCell
// CSV 单元格转义：含分隔符/引号/换行时加引号并把内部引号翻倍。
//
// @param {*} value - 值
// @returns {string} 转义后的单元格
export function csvCell(value) {
  // null/undefined → 空。
  const text = value === null || value === undefined ? '' : String(value)
  // 是否需要引号。
  const needQuote = /[",\n\r]/.test(text)
  // 转义。
  return needQuote ? `"${text.replace(/"/g, '""')}"` : text
}

// #toCSV
// 逐局明细 → CSV（一局一行）。
//
// @param {object} stats - 聚合结果
// @param {Array<object>} results - 逐局结果
// @returns {string} CSV 文本
export function toCSV(stats, results = []) {
  // 容错。
  stats = normalizeStats(stats, results)
  // 表头。
  const header = [
    '序号', '寿命', '总评', '评价',
    '最高年龄', '最高颜值', '最高智力', '最高体质', '最高家境', '最高快乐',
    '终局颜值', '终局智力', '终局体质', '终局家境', '终局快乐',
    '天赋', '天赋数', '分配颜值', '分配智力', '分配体质', '分配家境',
    '事件数', '天赋触发', '本局成就',
  ]
  // 行。
  const rows = [header.map(csvCell).join(',')]
  // 逐局。
  results.forEach((r, index) => {
    // 天赋名（分号分隔：CSV 单元格内不用逗号，读起来也更清楚）。
    const talents = (r.talentDetails || []).map((d) => d.name).join(';') || (r.talents || []).join(';')
    // 行数据。
    const row = [
      // 序号（从 1 开始）。
      index + 1,
      // 寿命。
      r.age,
      // 总评。
      r.sum,
      // 评价键。
      r.grade,
      // 历史最高。
      r.maxAge,
      r.maxPropertys?.CHR, r.maxPropertys?.INT, r.maxPropertys?.STR, r.maxPropertys?.MNY, r.maxPropertys?.SPR,
      // 终局属性。
      r.propertys?.CHR, r.propertys?.INT, r.propertys?.STR, r.propertys?.MNY, r.propertys?.SPR,
      // 天赋。
      talents,
      (r.talents || []).length,
      // 分配。
      r.allocation?.CHR, r.allocation?.INT, r.allocation?.STR, r.allocation?.MNY,
      // 统计。
      r.events,
      r.talentsTriggered,
      r.achievements,
    ]
    // 追加行。
    rows.push(row.map(csvCell).join(','))
  })
  // 末尾换行（便于追加）。
  return `${rows.join('\n')}\n`
}

// #toMarkdown
// 聚合结果 → Markdown 报告（可读性优先，可直接贴 issue）。
//
// @param {object} stats - 聚合结果
// @param {Array<object>} results - 逐局结果
// @param {object} [meta]
// @param {object} [meta.strategy] - 策略
// @param {Function} [meta.talentName] - ID → 名称
// @param {Date} [meta.date] - 生成时间
// @returns {string} Markdown 文本
export function toMarkdown(stats, results = [], { strategy, talentName, date = new Date() } = {}) {
  // 容错。
  stats = normalizeStats(stats, results)
  // 百分比。
  const pct = (v) => `${((Number(v) || 0) * 100).toFixed(1)}%`
  // 行缓冲。
  const lines = []
  // 标题。
  lines.push('# 人生重开模拟器 · 批量模拟报告')
  lines.push('')
  // 元信息。
  lines.push(`- 局数：**${stats.runs}**`)
  lines.push(`- 随机种子：${stats.seed === null || stats.seed === undefined ? '未指定（不可复现）' : `\`${stats.seed}\`（可复现）`}`)
  // 策略。
  lines.push(`- 策略：${formatStrategy(strategy, { talentName })}`)
  // 生成时间。
  lines.push(`- 生成时间：${date.toLocaleString('zh-CN')}`)
  lines.push('')
  // 概览。
  lines.push('## 概览')
  lines.push('')
  lines.push('| 指标 | 值 |')
  lines.push('|---|---|')
  lines.push(`| 平均寿命 | ${stats.age.avg} |`)
  lines.push(`| 寿命中位 | ${stats.age.median} |`)
  lines.push(`| 最短 / 最长寿命 | ${stats.age.min} / ${stats.age.max} |`)
  lines.push(`| 平均总评 | ${stats.sum.avg} |`)
  lines.push(`| 最低 / 最高总评 | ${stats.sum.min} / ${stats.sum.max} |`)
  lines.push(`| 平均每局成就 | ${stats.achievementsPerRun} |`)
  lines.push('')
  // 寿命分布。
  lines.push('## 寿命分布')
  lines.push('')
  lines.push('| 区间 | 局数 | 占比 |')
  lines.push('|---|---:|---:|')
  for (const bucket of stats.age.histogram || []) {
    // 占比。
    const share = stats.runs > 0 ? pct(bucket.count / stats.runs) : '0.0%'
    // 行。
    lines.push(`| ${bucket.label} | ${bucket.count} | ${share} |`)
  }
  lines.push('')
  // 分档。
  lines.push('## 总评分档')
  lines.push('')
  lines.push('| 评价 | 局数 | 占比 |')
  lines.push('|---|---:|---:|')
  for (const key of ['J_Great', 'J_Good', 'J_Normal']) {
    // 数量。
    const count = stats.sum.grades?.[key] || 0
    // 行。
    lines.push(`| ${key} | ${count} | ${stats.runs > 0 ? pct(count / stats.runs) : '0.0%'} |`)
  }
  lines.push('')
  // 属性均值。
  lines.push('## 属性均值')
  lines.push('')
  lines.push('| 属性 | 终局均值 | 历史最高均值 |')
  lines.push('|---|---:|---:|')
  for (const key of ['CHR', 'INT', 'STR', 'MNY', 'SPR']) {
    // 行。
    lines.push(`| ${PROP_LABELS[key]} | ${stats.propertys?.[key] ?? 0} | ${stats.maxPropertys?.[key] ?? 0} |`)
  }
  lines.push('')
  // 收集。
  lines.push('## 收集')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('|---|---:|')
  lines.push(`| 成就达成率 | ${pct(stats.collection?.achievementRate)}（${stats.collection?.achievements || 0} 个） |`)
  lines.push(`| 天赋选择率 | ${pct(stats.collection?.talentRate)} |`)
  lines.push(`| 事件收集率 | ${pct(stats.collection?.eventRate)} |`)
  lines.push('')
  // 最佳一局。
  if (stats.best) {
    // 标题。
    lines.push('## 最佳一局（总评最高）')
    lines.push('')
    // 明细。
    lines.push(`- 寿命：**${stats.best.age}** 岁`)
    lines.push(`- 总评：**${stats.best.sum}**（${stats.best.grade}）`)
    // 天赋名。
    const talents = (stats.best.talentDetails || []).map((d) => d.name).join('、') || '（无）'
    lines.push(`- 天赋：${talents}`)
    // 分配。
    const alloc = Object.entries(stats.best.allocation || {}).map(([k, v]) => `${PROP_LABELS[k] || k} ${v}`).join(' / ')
    lines.push(`- 属性分配：${alloc}`)
    lines.push('')
  }
  // 逐局明细。
  lines.push('## 逐局明细')
  lines.push('')
  lines.push('| # | 寿命 | 总评 | 评价 | 天赋 | 属性分配 |')
  lines.push('|---:|---:|---:|---|---|---|')
  results.forEach((r, index) => {
    // 天赋名。
    const talents = (r.talentDetails || []).map((d) => d.name).join('、') || '（无）'
    // 分配。
    const alloc = Object.entries(r.allocation || {}).map(([k, v]) => `${PROP_LABELS[k] || k} ${v}`).join(' / ')
    // 行。
    lines.push(`| ${index + 1} | ${r.age} | ${r.sum} | ${r.grade || ''} | ${talents} | ${alloc} |`)
  })
  lines.push('')
  // 拼接。
  return lines.join('\n')
}

// #toJSON
// 结构化导出：meta + stats + 逐局结果（可直接 JSON.parse 回来做二次分析）。
//
// @param {object} stats - 聚合结果
// @param {Array<object>} results - 逐局结果
// @param {object} [meta] - 元信息（strategy/appVersion/date…）
// @returns {string} JSON 文本
export function toJSON(stats, results = [], meta = {}) {
  // 容错。
  stats = normalizeStats(stats, results)
  // 组装。
  const payload = {
    // 元信息。
    meta: {
      // 生成时间（ISO）。
      generatedAt: (meta.date || new Date()).toISOString(),
      // 局数。
      runs: stats.runs,
      // 种子。
      seed: stats.seed ?? null,
      // 策略。
      strategy: meta.strategy || null,
      // 附加标签（如数据源）。
      ...(meta.extra || {}),
    },
    // 聚合。
    stats,
    // 逐局。
    results,
  }
  // 美化输出（2 空格，便于人读与 diff）。
  return `${JSON.stringify(payload, null, 2)}\n`
}

// #exportSimulation
// 统一分发：返回文本、文件名与 MIME。
//
// @param {object} params
// @param {string} params.format - csv/json/md
// @param {object} params.stats - 聚合结果
// @param {Array<object>} params.results - 逐局结果
// @param {object} [params.meta] - 元信息
// @param {Date} [params.date] - 时间（文件名与报告共用）
// @returns {{text: string, fileName: string, mime: string, format: string}} 导出产物
export function exportSimulation({ format = 'json', stats, results = [], meta = {}, date = new Date() } = {}) {
  // 未知格式直接报错（避免静默产出空文件）。
  if (!FORMATS[format]) {
    // 抛出可读错误。
    throw new Error(`不支持的导出格式：${format}（可选：${FORMAT_LIST.join(' / ')}）`)
  }
  // 容错（stats 缺失也能导出）。
  const safeStats = normalizeStats(stats, results)
  // 按格式序列化。
  const text = format === 'csv'
    ? toCSV(safeStats, results)
    : format === 'md'
      ? toMarkdown(safeStats, results, { ...meta, date })
      : toJSON(safeStats, results, { ...meta, date })
  // 返回。
  return {
    // 文本。
    text,
    // 文件名。
    fileName: buildFileName({ format, runs: safeStats.runs || results.length, seed: safeStats.seed ?? null, date }),
    // MIME。
    mime: FORMATS[format].mime,
    // 格式。
    format,
  }
}
