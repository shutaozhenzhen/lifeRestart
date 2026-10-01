/**
 * judge-config — 属性分档评价的内置默认配置
 *
 * 背景（真实故障复盘）：
 *   分档表此前只存在于 CLI（`makeJudgeConfig()` 各写一份）与测试 fixture 里，
 *   前端 `life.config()` 是空参调用 → Property 的 `#judge` 为空 →
 *   `judge(prop)` 一律返回 undefined → 总结页「属性评价」整列显示 —（空）。
 *
 * 处理：
 *   把分档表作为引擎内置默认值（与 CLI 里那份保持一致并补齐统计项），
 *   `Life.config()` 未显式传入 propertyConfig 时自动使用它。
 *   三处 CLI 的本地副本随之删除，避免再出现"各写一份、漏项"的问题。
 *
 * 分档格式：{ 属性: [[下限, 等级, 评价键], ...] }，数组从**高档到低档**排列；
 * 评价键（J_*）是 i18n 词条键，由 `src/i18n/index.js` 翻译成可见文案。
 */

// #JUDGE_LEVELS
// 常用分档（五项基础属性 / 历史最高值）。
const FIVE = [[0, 1, 'J_Normal'], [5, 2, 'J_Good'], [8, 3, 'J_Great']]
// 百分比类分档（收集率 0~1）。
const RATIO = [[0, 1, 'J_Normal'], [0.5, 2, 'J_Good'], [0.8, 3, 'J_Great']]

// #DEFAULT_JUDGE_CONFIG
// 内置默认评价配置：覆盖 summary（SUM/HAGE/H*）与 statistics（TMS/CACHV/RTLT/REVT）。
export const DEFAULT_JUDGE_CONFIG = {
  // ---- 五项基础属性（当前值）----
  CHR: FIVE,
  INT: FIVE,
  STR: FIVE,
  MNY: FIVE,
  SPR: FIVE,
  // ---- 历史最高值（H*，由参数注册表的 derived/max 维护）----
  HCHR: FIVE,
  HINT: FIVE,
  HSTR: FIVE,
  HMNY: FIVE,
  HSPR: FIVE,
  // ---- 最高年龄 ----
  HAGE: [[0, 1, 'J_Normal'], [10, 2, 'J_Good'], [20, 3, 'J_Great']],
  // ---- 总评（五项最高值 ×2 + 最高年龄 /2）----
  SUM: [[0, 1, 'J_Normal'], [50, 2, 'J_Good'], [100, 3, 'J_Great']],
  // ---- 重开次数 ----
  TMS: [[0, 1, 'J_Normal'], [1, 2, 'J_Good'], [5, 3, 'J_Great']],
  // ---- 成就达成数 ----
  CACHV: [[0, 1, 'J_Normal'], [1, 2, 'J_Good'], [5, 3, 'J_Great']],
  // ---- 天赋收集率 ----
  RTLT: RATIO,
  // ---- 事件收集率 ----
  REVT: RATIO,
}

// 默认导出（便于按需整体替换）。
export default DEFAULT_JUDGE_CONFIG
