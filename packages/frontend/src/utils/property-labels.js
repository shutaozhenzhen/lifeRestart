/**
 * property-labels — 属性键 → 中文标签（**唯一来源：引擎的参数定义**）
 *
 * 为什么不再手写一张表：
 *   `game-engine/src/params/params.js` 里每个参数都自带 `label`
 *   （颜值/智力/体质/家境/快乐/生命/年龄/随机属性…），那是引擎自己的定义。
 *   前端再抄一份就必然分叉 —— AGENTS.md 里记着的"加属性要改 4 个 view"就是这个老问题。
 *   新代码从这里取；页面里剩下的硬编码清单是纯机械替换，逐步收敛。
 *
 * 关于 `RDM`（随机属性）：它是 `special` 类型，属性系统会把它映射成五个基础属性之一
 * （`property.js` 的 SPECIAL.RDM），所以天赋效果里直接写「随机属性 +1」就是准确的。
 */

// 引擎内置参数（含 label）。
import { BUILTIN_PARAMS } from 'game-engine/src/params/params.js'

// #PROPERTY_LABELS
// 键 → 标签（只收带 label 的参数）。
export const PROPERTY_LABELS = Object.freeze(
  Object.fromEntries(
    Object.entries(BUILTIN_PARAMS)
      // 有 label 才算"可展示"的键。
      .filter(([, def]) => def && typeof def.label === 'string' && def.label)
      // 取 [键, 标签]。
      .map(([key, def]) => [key, def.label]),
  ),
)

// #propertyLabel
// 取中文标签。
//
// 未登记的键**原样返回**（不猜、不编）：宁可界面上出现一个英文键，也不要显示错的解释。
//
// @param {string} key - 属性键（CHR/INT/…）
// @returns {string} 中文标签
export function propertyLabel(key) {
  // 命中标签，否则原样。
  return PROPERTY_LABELS[key] || String(key)
}

// #formatEffect
// 属性增减对象 → 一行文案，如 `颜值 +1 · 随机属性 -1`。
//
// @param {object} effect - 形如 { CHR: 1, RDM: -1 }
// @returns {string} 文案（无效果返回空串）
export function formatEffect(effect) {
  // 非对象 / 空。
  if (!effect || typeof effect !== 'object') return ''
  // 逐项：`标签 +N`（正数补 +）。
  return Object.entries(effect)
    // 只收数字项（数据里偶尔有 null/字符串，忽略比显示 NaN 好）。
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    // 文案。
    .map(([k, v]) => `${propertyLabel(k)} ${v > 0 ? '+' : ''}${v}`)
    // 连接。
    .join(' · ')
}
