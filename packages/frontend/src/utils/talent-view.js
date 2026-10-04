/**
 * talent-view — 天赋的**展示文案**（星级 / 效果 / 点数加成 / 标记）
 *
 * 为什么单独一个模块：名人模式要在两个页面显示同一批天赋的详情
 * （`/character` 选定之后、`/property` 分配点数时），文案规则必须只有一份，
 * 否则两边迟早不一致。
 *
 * 字段含义（以引擎为准）：
 *   · `grade`       星级 0~3（TalentView 里 3 星金 / 2 星紫 / 其余灰）
 *   · `description` 描述（184 条真实数据**全都有**）
 *   · `effect`      属性增减（`{ CHR: 1, RDM: -1 }`；86/184 条有）→ 交给 property-labels 出文案
 *   · `status`      **额外可分配点数**（`talent.allocationAddition` 就是累加它；
 *                   名人模式的"额外点数"正是来自这里，所以要在界面上说清楚）
 *   · `condition`   有条件（满足才触发，`talent.do()` 会检查）
 *   · `exclusive`   专属（**不入抽取池**，只能被"给"——名人自带的就是这一类）
 *   · `replacement` 替换链（这个天赋会把某等级/某个天赋替换掉）
 */

// 属性标签与效果文案（唯一来源）。
import { formatEffect } from './property-labels.js'

// #talentGradeText
// 星级文案。
//
// @param {number} grade - 0~3（缺失/非法 → 按 0 星显示）
// @returns {string} 如 `3 星`
export function talentGradeText(grade) {
  // 归一化：非数字按 0。
  const g = Number.isFinite(Number(grade)) ? Number(grade) : 0
  // 文案。
  return `${g} 星`
}

// #talentGradeClass
// 星级样式类（与 TalentView 的 g0~g3 配色一致）。
//
// @param {number} grade - 0~3
// @returns {string} 类名（g0/g1/g2/g3）
export function talentGradeClass(grade) {
  // 归一化并夹到 0~3（数据坏了也不出 g7 这种没有样式的类）。
  const g = Math.min(3, Math.max(0, Number.isFinite(Number(grade)) ? Number(grade) : 0))
  // 类名。
  return `g${g}`
}

// #talentBonusPoints
// 天赋的额外可分配点数（引擎的 `status` 字段）。
//
// @param {object} talent - 天赋对象
// @returns {number} 点数（没有则 0）
export function talentBonusPoints(talent) {
  // 取 status。
  const n = Number(talent?.status)
  // 非法/缺失 → 0。
  return Number.isFinite(n) ? n : 0
}

// #talentTags
// 标记（有条件 / 专属 / 替换链）。
//
// @param {object} talent - 天赋对象
// @returns {string[]} 标记文案
export function talentTags(talent) {
  // 结果。
  const tags = []
  // 有条件。
  if (talent?.condition) tags.push('有条件')
  // 专属：不入抽取池（名人自带的经常是这一类）。
  if (talent?.exclusive) tags.push('专属')
  // 替换链。
  if (talent?.replacement) tags.push('替换链')
  // 返回。
  return tags
}

// #talentDetail
// 组装展示所需的一行信息（组件直接渲染它，不再各自算文案）。
//
// @param {object} talent - 天赋对象
// @returns {{id: string, name: string, gradeText: string, gradeClass: string, description: string, effectText: string, points: number, tags: string[]}} 展示信息
export function talentDetail(talent) {
  // 逐字段。
  return {
    // 标识。
    id: String(talent?.id ?? ''),
    // 名称（缺失兜底成 ID，避免空白卡片）。
    name: talent?.name || String(talent?.id ?? '（未知天赋）'),
    // 星级。
    gradeText: talentGradeText(talent?.grade),
    gradeClass: talentGradeClass(talent?.grade),
    // 描述（真实数据全都有；缺失就空着，不编）。
    description: talent?.description || '',
    // 属性效果文案。
    effectText: formatEffect(talent?.effect),
    // 额外可分配点数。
    points: talentBonusPoints(talent),
    // 标记。
    tags: talentTags(talent),
  }
}

// #talentTooltip
// 悬浮提示文本（卡片上的天赋胶囊用 `title`）。
//
// @param {object} talent - 天赋对象
// @returns {string} 提示文本（多行）
export function talentTooltip(talent) {
  // 详情。
  const d = talentDetail(talent)
  // 拼装：名称 → 描述 → 效果 → 点数。
  return [
    // 第一行：星级 + 名称。
    `${d.gradeText} ${d.name}`,
    // 描述。
    d.description,
    // 效果。
    d.effectText ? `效果：${d.effectText}` : '',
    // 点数加成。
    d.points ? `额外点数：${d.points > 0 ? '+' : ''}${d.points}` : '',
    // 标记。
    d.tags.length ? `（${d.tags.join(' · ')}）` : '',
  ]
    // 去掉空行。
    .filter(Boolean)
    // 换行。
    .join('\n')
}
