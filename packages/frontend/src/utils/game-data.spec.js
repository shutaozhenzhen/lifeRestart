/**
 * game-data 单元测试 — 数据加载（主页与模拟页共用）
 *
 * 覆盖：
 *   1. buildEmptyData：引擎**不内置任何内容**（天赋/事件/成就/名人为空）
 *   2. loadModState：缺省 null / 读取启停 / 损坏 JSON 容错
 *   3. fetchOriginalData：注入 fetch，路径与 total 统计正确
 *   4. loadGameData：原版数据成功 / 加载失败 → 空内容 / Mod 被禁用 → 空内容
 *
 * 回归点：曾经这里的降级路径返回**引擎测试 fixture**（含「填充天赋1/2/3」），
 * 于是「所有 Mod 关闭」时玩家在天赋页看到测试占位数据。见下面对 `{}` 的断言。
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { buildEmptyData, fetchOriginalData, loadGameData, loadModState } from './game-data.js'

// #memStorage
// 内存存储替身。
function memStorage(initial = {}) {
  // 数据。
  const data = { ...initial }
  // 适配器。
  return {
    getItem(k) { return k in data ? data[k] : null },
    setItem(k, v) { data[k] = String(v) },
  }
}

describe('game-data - buildEmptyData', () => {
  test('引擎不内置内容：所有内容表为空、总量为 0', () => {
    // 构造。
    const data = buildEmptyData()
    // 五张内容表全空 —— 内容只能来自 Mod。
    expect(data.talents).toEqual({})
    expect(data.events).toEqual({})
    expect(data.achievements).toEqual({})
    expect(data.characters).toEqual({})
    expect(data.age).toEqual({})
    // 总量为 0（页面据此判断"无内容可玩"）。
    expect(data.total).toEqual({ TACHV: 0, TEVT: 0, TTLT: 0 })
    // 两次调用互不共享引用（避免调用方互相污染）。
    expect(buildEmptyData().talents).not.toBe(data.talents)
  })
})

describe('game-data - loadModState', () => {
  test('无记录返回 null（表示用默认值）', () => {
    // 空存储。
    expect(loadModState('lifeRestart-data', memStorage())).toBeNull()
  })

  test('读取指定 Mod 的启停', () => {
    // 存储里有状态。
    const storage = memStorage({ modsState: JSON.stringify({ enabled: { 'lifeRestart-data': false, 'fun-mod': true } }) })
    // 返回布尔。
    expect(loadModState('lifeRestart-data', storage)).toBe(false)
    expect(loadModState('fun-mod', storage)).toBe(true)
    // 未记录的 Mod → null。
    expect(loadModState('base-mod', storage)).toBeNull()
  })

  test('损坏 JSON 容错（返回 null 而不是抛错）', () => {
    // 坏数据。
    expect(loadModState('x', memStorage({ modsState: '{oops' }))).toBeNull()
  })

  // 为什么这条重要（2026-10）：完全移除如果只影响界面列表，游戏仍会按默认值把内容 Mod
  // 加载回来 —— 界面说"已移除"、实际还在用它的内容。移除即不加载，判据收敛在这里。
  test('已完全移除（removed）视为禁用，压过 enabled 里的任何取值', () => {
    // 只记移除。
    const storage = memStorage({ modsState: JSON.stringify({ enabled: {}, removed: ['lifeRestart-data'] }) })
    // 视为禁用。
    expect(loadModState('lifeRestart-data', storage)).toBe(false)
    // 即使 enabled 里写着 true（例如移除后又手动启用过），也仍然是不加载。
    const both = memStorage({ modsState: JSON.stringify({ enabled: { 'lifeRestart-data': true }, removed: ['lifeRestart-data'] }) })
    // 移除优先。
    expect(loadModState('lifeRestart-data', both)).toBe(false)
    // 没被移除的 Mod 不受影响。
    expect(loadModState('fun-mod', both)).toBeNull()
  })
})

describe('game-data - fetchOriginalData', () => {
  test('并行取 5 个文件并计算 total', async () => {
    // 记录请求路径。
    const urls = []
    // 桩：按文件名返回不同规模的数据。
    const fetchImpl = async (url) => {
      // 记录。
      urls.push(url)
      // 文件名。
      const name = String(url).split('/').pop()
      // 按文件返回。
      const table = {
        'age.json': { 0: { event: ['a'], talent: [] } },
        'talents.json': { t1: {}, t2: {} },
        'events.json': { e1: {}, e2: {}, e3: {} },
        'achievements.json': { a1: {} },
        'characters.json': { c1: {} },
      }
      // 返回。
      return { json: async () => table[name] }
    }
    // 调用（固定 baseUrl，避免依赖 Vite 环境）。
    const data = await fetchOriginalData({ fetchImpl, baseUrl: '/base/' })
    // 路径拼装正确。
    expect(urls.sort()).toEqual([
      '/base/data/achievements.json',
      '/base/data/age.json',
      '/base/data/characters.json',
      '/base/data/events.json',
      '/base/data/talents.json',
    ])
    // total 由各表规模算出。
    expect(data.total).toEqual({ TACHV: 1, TEVT: 3, TTLT: 2 })
    // 数据原样带出。
    expect(Object.keys(data.characters)).toEqual(['c1'])
  })
})

describe('game-data - loadGameData', () => {
  test('原版数据可用：返回数据与来源标注（degraded=false）', async () => {
    // 桩。
    const fetchImpl = async (url) => ({ json: async () => ({ [String(url).split('/').pop()]: {} }) })
    // 加载（Mod 状态为空 → 缺省视为启用）。
    const { data, dataSource, degraded } = await loadGameData({ fetchImpl, storage: memStorage() })
    // 未降级。
    expect(degraded).toBe(false)
    // 来源标注含原版数据与规模。
    expect(dataSource).toContain('lifeRestart-data')
    expect(dataSource).toMatch(/（\d+ 天赋 \/ \d+ 事件）/)
    // 数据可用。
    expect(data.age).toBeDefined()
  })

  test('加载失败：降级为空内容且标注原因（degraded=true）', async () => {
    // 桩：抛错。
    const fetchImpl = async () => {
      throw new Error('offline')
    }
    // 加载。
    const { data, dataSource, degraded } = await loadGameData({ fetchImpl, storage: memStorage() })
    // 降级。
    expect(degraded).toBe(true)
    // 标注含空内容与失败原因（日志报告里能看出为什么）。
    expect(dataSource).toContain('空内容')
    expect(dataSource).toContain('offline')
    // **没有任何内置内容**（回归：曾经这里是 12 个 fixture 天赋，含「填充天赋1/2/3」）。
    expect(data.talents).toEqual({})
    expect(data.events).toEqual({})
    expect(data.total.TTLT).toBe(0)
  })

  test('Mod 被禁用：空内容并标注禁用（引擎没有可退的默认内容）', async () => {
    // 存储里 lifeRestart-data 被禁用。
    const storage = memStorage({ modsState: JSON.stringify({ enabled: { 'lifeRestart-data': false } }) })
    // 桩：若被调用就说明逻辑错了。
    const fetchImpl = async () => {
      throw new Error('should not fetch')
    }
    // 加载。
    const { data, dataSource, degraded } = await loadGameData({ fetchImpl, storage })
    // 降级 + 标注禁用。
    expect(degraded).toBe(true)
    expect(dataSource).toContain('空内容')
    expect(dataSource).toContain('已禁用')
    // 天赋/事件池为空（玩家看到的是"没有内容 Mod"，而不是测试占位数据）。
    expect(data.talents).toEqual({})
    expect(data.events).toEqual({})
  })

  test('Mod 被完全移除：空内容，且提示与"禁用"区分开（出路不同）', async () => {
    // 存储里 lifeRestart-data 被移除（不在 enabled 里）。
    const storage = memStorage({ modsState: JSON.stringify({ enabled: {}, removed: ['lifeRestart-data'] }) })
    // 桩：若被调用就说明逻辑错了。
    const fetchImpl = async () => {
      throw new Error('should not fetch')
    }
    // 加载。
    const { data, dataSource, degraded } = await loadGameData({ fetchImpl, storage })
    // 降级 + 说清是"移除"以及去哪儿恢复。
    expect(degraded).toBe(true)
    expect(dataSource).toContain('已完全移除')
    expect(dataSource).toContain('/mods')
    // 内容为空。
    expect(data.talents).toEqual({})
  })
})
