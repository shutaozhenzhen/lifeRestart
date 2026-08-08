/**
 * AI 输出校验器（Step 18/19）
 *
 * AI 生成的 JSON 不可信，必须经过结构 + 语法 + 效果校验才能进入游戏数据池。
 * 校验失败时由调用方决定重试或 fallback（原版数据）。
 *
 * 职责：
 *   1. validateTalentJSON：天赋结构（id/name/condition/effect）。
 *   2. validateEventJSON：事件结构（id/event/effect/option）。
 *   3. checkCondition：条件可编译（用 check() 试跑，抛错即失败）。
 *   4. checkEffect：效果字段值合法。
 */

// 条件引擎（校验 condition 语法）。
import { check } from '../condition/index.js'

// #checkCondition
// 校验 AI 生成的 condition 是否为合法新语法表达式。
// 用 check() 试跑：编译失败（SyntaxError）或运行失败（ReferenceError）即非法。
//
// @param {string} condition - condition 表达式
// @param {object} [props] - 试跑用的属性快照（缺省空对象）
// @returns {{ok: boolean, error?: string}} 校验结果
export function checkCondition(condition, props = {}) {
  // 非字符串。
  if (typeof condition !== 'string' || !condition.trim()) {
    // 非法。
    return { ok: false, error: 'condition 必须是非空字符串' }
  }
  // 试跑。
  try {
    // 求值（抛错即非法）。
    check(condition, props)
    // 合法。
    return { ok: true }
  } catch (e) {
    // 非法。
    return { ok: false, error: e.message }
  }
}

// #checkEffect
// 校验 effect 结构：属性键 + 数值增量。
// effect 形如 { CHR: 10, MNY: -5 }。值必须是数字。
//
// @param {object} effect - 效果对象
// @returns {{ok: boolean, error?: string}} 校验结果
export function checkEffect(effect) {
  // 无 effect 合法（可选字段）。
  if (!effect) return { ok: true }
  // 非对象。
  if (typeof effect !== 'object' || Array.isArray(effect)) {
    // 非法。
    return { ok: false, error: 'effect 必须是对象' }
  }
  // 遍历每个键。
  for (const key in effect) {
    // 值必须是数字（属性增量）。
    if (typeof effect[key] !== 'number') {
      // 非法。
      return { ok: false, error: `effect.${key} 必须是数字，收到 ${typeof effect[key]}` }
    }
  }
  // 合法。
  return { ok: true }
}

// #validateTalentJSON
// 校验 AI 生成的天赋 JSON。
// 结构：{ id, name, description?, condition?, effect?, grade?, exclusive?, maxTriggers? }
//
// @param {object} talent - AI 生成的天赋
// @returns {{ok: boolean, error?: string}} 校验结果
export function validateTalentJSON(talent) {
  // 非对象。
  if (!talent || typeof talent !== 'object') return { ok: false, error: '天赋必须是对象' }
  // 必填 id。
  if (!talent.id || typeof talent.id !== 'string') return { ok: false, error: '天赋缺少字符串 id' }
  // 必填 name。
  if (!talent.name || typeof talent.name !== 'string') return { ok: false, error: '天赋缺少字符串 name' }
  // condition 校验（可选）。
  if (talent.condition) {
    // 校验。
    const c = checkCondition(talent.condition)
    // 非法。
    if (!c.ok) return { ok: false, error: `condition 非法: ${c.error}` }
  }
  // effect 校验（可选）。
  if (talent.effect) {
    // 校验。
    const e = checkEffect(talent.effect)
    // 非法。
    if (!e.ok) return { ok: false, error: `effect 非法: ${e.error}` }
  }
  // 合法。
  return { ok: true }
}

// #validateEventJSON
// 校验 AI 生成的事件 JSON。
// 结构：{ id, event, effect?, branch?, include?, exclude? }
//
// @param {object} event - AI 生成的事件
// @returns {{ok: boolean, error?: string}} 校验结果
export function validateEventJSON(event) {
  // 非对象。
  if (!event || typeof event !== 'object') return { ok: false, error: '事件必须是对象' }
  // 必填 id。
  if (!event.id || typeof event.id !== 'string') return { ok: false, error: '事件缺少字符串 id' }
  // 必填 event（描述文本）。
  if (!event.event || typeof event.event !== 'string') return { ok: false, error: '事件缺少字符串 event' }
  // include/exclude 校验（可选）。
  for (const key of ['include', 'exclude']) {
    // 有条件。
    if (event[key]) {
      // 校验。
      const c = checkCondition(event[key])
      // 非法。
      if (!c.ok) return { ok: false, error: `${key} 非法: ${c.error}` }
    }
  }
  // effect 校验（可选）。
  if (event.effect) {
    // 校验。
    const e = checkEffect(event.effect)
    // 非法。
    if (!e.ok) return { ok: false, error: `effect 非法: ${e.error}` }
  }
  // 合法。
  return { ok: true }
}

// #validateGenerated
// 按类型分发校验（供 gameAPI.ai 通用调用）。
//
// @param {string} type - 'talent' | 'event'
// @param {object} item - AI 生成的条目
// @returns {{ok: boolean, error?: string}} 校验结果
export function validateGenerated(type, item) {
  // 按类型分发。
  switch (type) {
    case 'talent': return validateTalentJSON(item)
    case 'event': return validateEventJSON(item)
    // 未知类型。
    default: return { ok: false, error: `未知类型: ${type}` }
  }
}
