/**
 * mods-state 持久化测试 — mods-state.spec.js
 *
 * 覆盖回归：Mod 管理页开关此前只存内存（ref 初值），刷新后还原；
 * 修复为 localStorage 持久化。逻辑抽取为纯函数（load/save/apply），单测。。
 */

// 导入 vitest 测试 DSL。
import { describe, test, expect } from 'vitest'
// 被测函数。
import { loadModsState, saveModsState, applyModsState } from './mods-state.js'

// #memStorage
// 内存 storage 适配器（Node 环境模拟 localStorage）。
function memStorage() {
  // 存储。
  const _d = {}
  // 适配器。
  return {
    // 读取：存在返回，否则 null。
    getItem(k) { return k in _d ? _d[k] : null },
    // 写入：字符串化。
    setItem(k, v) { _d[k] = String(v) },
    // 删除。
    removeItem(k) { delete _d[k] },
    // 底层数据（断言用）。
    _d,
  }
}

// #MOD_LIST
// 默认 Mod 列表（与 Mod 管理页一致）。
const MOD_LIST = [
  { name: 'lifeRestart-data', enabled: true, system: true },
  { name: 'base-mod', enabled: true, system: false },
  { name: 'fun-mod', enabled: false, system: false },
  { name: 'ai-mod', enabled: false, system: true },
]

describe('mods-state 持久化（刷新保留回归）', () => {
  test('未保存时加载 → 默认空状态，启停保持默认列表', () => {
    // storage。
    const s = memStorage()
    // 加载。
    const state = loadModsState(s)
    // 空状态。
    expect(state.enabled).toEqual({})
    expect(state.removed).toEqual([])
    // 应用后保持默认启停。
    const mods = applyModsState(MOD_LIST, state)
    expect(mods.find(m => m.name === 'base-mod').enabled).toBe(true)
    expect(mods.find(m => m.name === 'fun-mod').enabled).toBe(false)
  })

  test('保存禁用后加载 → 刷新后开关保留（原生 bug 场景）', () => {
    // storage。
    const s = memStorage()
    // 保存：禁用 base-mod。
    saveModsState({ mods: MOD_LIST.map(m => m.name === 'base-mod' ? { ...m, enabled: false } : m), removed: [] }, s)
    // 加载（模拟刷新）。
    const mods = applyModsState(MOD_LIST, loadModsState(s))
    // base-mod 保持禁用。
    expect(mods.find(m => m.name === 'base-mod').enabled).toBe(false)
    // 其余保持默认。
    expect(mods.find(m => m.name === 'fun-mod').enabled).toBe(false)
    expect(mods.find(m => m.name === 'ai-mod').enabled).toBe(false)
    expect(mods.find(m => m.name === 'lifeRestart-data').enabled).toBe(true)
  })

  test('保存启用后加载 → 刷新后保持启用', () => {
    // storage。
    const s = memStorage()
    // 保存：启用 ai-mod。
    saveModsState({ mods: MOD_LIST.map(m => m.name === 'ai-mod' ? { ...m, enabled: true } : m), removed: [] }, s)
    // 加载应用。
    const mods = applyModsState(MOD_LIST, loadModsState(s))
    // ai-mod 保持启用。
    expect(mods.find(m => m.name === 'ai-mod').enabled).toBe(true)
  })

  test('保存删除后加载 → 已删除 Mod 不再出现，系统 Mod 不受影响', () => {
    // storage。
    const s = memStorage()
    // 保存：删除 fun-mod（非系统）。
    saveModsState({ mods: MOD_LIST.filter(m => m.name !== 'fun-mod'), removed: ['fun-mod'] }, s)
    // 加载应用。
    const mods = applyModsState(MOD_LIST, loadModsState(s))
    // fun-mod 被过滤。
    expect(mods.some(m => m.name === 'fun-mod')).toBe(false)
    // 其余保留。
    expect(mods.some(m => m.name === 'base-mod')).toBe(true)
    // 系统 Mod 仍在列表（不可删语义由 UI 层保证，持久化不丢）。
    expect(mods.some(m => m.name === 'lifeRestart-data')).toBe(true)
  })

  test('损坏数据 → 回退默认（不抛错）', () => {
    // 坏 JSON storage。
    const s = { getItem: () => '{bad json', setItem: () => {} , _d: {}}
    // 加载不抛。
    expect(() => loadModsState(s)).not.toThrow()
    // 默认状态。
    expect(loadModsState(s).removed).toEqual([])
    // 应用后保持默认。
    expect(applyModsState(MOD_LIST, loadModsState(s))).toHaveLength(MOD_LIST.length)
  })
})