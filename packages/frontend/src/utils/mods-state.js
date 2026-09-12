/**
 * mods-state — Mod 启停/删除状态的持久化（纯函数，可测试）
 *
 * 背景（2026-08 修复的原生 bug）：
 *   Mod 管理页的开关状态此前只存内存（ref 初始值），刷新后还原。
 *   处理：启停/删除状态持久化到 localStorage 键 modsState。
 *
 * 逻辑从 ModManageView 抽出为纯函数，供单元测试覆盖「刷新后状态保留」。
 * storage 可注入（默认 localStorage），Node 测试用内存 mock。
 */

// #DEFAULT_STATE
// 缺省状态。
const DEFAULT_STATE = {
  // 启停映射 { modName: boolean }。
  enabled: {},
  // 已删除 Mod 名列表。
  removed: [],
}

// #loadModsState
// 读取持久化状态（失败/缺省返回默认结构）。
//
// @param {object} [storage] - storage 适配器（getItem/setItem），默认 localStorage
// @returns {{enabled: object, removed: string[]}} 状态
export function loadModsState(storage) {
  // 读取。
  try {
    // 解析。
    const parsed = JSON.parse((storage || localStorage).getItem('modsState'))
    // 合法对象则合并默认结构返回。
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_STATE, ...parsed } : { ...DEFAULT_STATE }
  } catch {
    // 缺省。
    return { ...DEFAULT_STATE }
  }
}

// #saveModsState
// 保存启停/删除状态（开关/删除后调用）。
//
// @param {{mods: Array<{name: string, enabled: boolean}>, removed: string[]}} state - 当前状态
// @param {object} [storage] - storage 适配器，默认 localStorage
// @returns {void}
export function saveModsState(state, storage) {
  // 写入。
  (storage || localStorage).setItem('modsState', JSON.stringify({
    // 启停映射。
    enabled: Object.fromEntries(state.mods.map(m => [m.name, m.enabled])),
    // 已删除列表。
    removed: state.removed,
  }))
}

// #applyModsState
// 把持久化状态应用到默认列表：过滤已删除 + 用保存的启停覆盖（刷新后保留用户选择）。
//
// @param {Array<object>} modList - 默认 Mod 列表
// @param {{enabled: object, removed: string[]}} state - 持久化状态
// @returns {Array<object>} 应用后的列表
export function applyModsState(modList, state) {
  // 过滤已删除 + 应用启停。
  return modList
    // 过滤已删除。
    .filter(m => !(state?.removed || []).includes(m.name))
    // 应用保存的启用状态。
    .map(m => ({ ...m, enabled: (state?.enabled || {})[m.name] !== undefined ? state.enabled[m.name] : m.enabled }))
}