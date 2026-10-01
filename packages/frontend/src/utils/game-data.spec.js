/**
 * game-data 单元测试 — 数据加载（主页与模拟页共用）
 *
 * 覆盖：
 *   1. buildFixtureData：深拷贝（两次调用互不污染）
 *   2. loadModState：缺省 null / 读取启停 / 损坏 JSON 容错
 *   3. fetchOriginalData：注入 fetch，路径与 total 统计正确
 *   4. loadGameData：原版数据成功 / 加载失败降级 / Mod 被禁用降级（并给出可读 dataSource）
 */

// vitest DSL。
import { describe, test, expect } from 'vitest'
// 被测模块。
import { buildFixtureData, fetchOriginalData, loadGameData, loadModState } from './game-data.js'

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

describe('game-data - buildFixtureData', () => {
  test('返回深拷贝（两次调用互不污染）', () => {
    // 两次构造。
    const a = buildFixtureData()
    const b = buildFixtureData()
    // 不同引用。
    expect(a.age).not.toBe(b.age)
    expect(a.talents).not.toBe(b.talents)
    // 结构完整。
    for (const key of ['age', 'talents', 'events', 'achievements', 'characters', 'total']) {
      expect(a[key], key).toBeDefined()
    }
    // 改一份不影响另一份。
    a.talents.extra = { id: 'x' }
    expect(b.talents.extra).toBeUndefined()
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

  test('加载失败：降级 fixture 且标注原因（degraded=true）', async () => {
    // 桩：抛错。
    const fetchImpl = async () => {
      throw new Error('offline')
    }
    // 加载。
    const { data, dataSource, degraded } = await loadGameData({ fetchImpl, storage: memStorage() })
    // 降级。
    expect(degraded).toBe(true)
    // 标注含 fixture 与失败原因（日志报告里能看出为什么）。
    expect(dataSource).toContain('fixture')
    expect(dataSource).toContain('offline')
    // 数据是 fixture（12 天赋）。
    expect(Object.keys(data.talents).length).toBe(12)
  })

  test('Mod 被禁用：直接使用 fixture 并标注禁用', async () => {
    // 存储里 lifeRestart-data 被禁用。
    const storage = memStorage({ modsState: JSON.stringify({ enabled: { 'lifeRestart-data': false } }) })
    // 桩：若被调用就说明逻辑错了。
    const fetchImpl = async () => {
      throw new Error('should not fetch')
    }
    // 加载。
    const { dataSource, degraded } = await loadGameData({ fetchImpl, storage })
    // 降级 + 标注禁用。
    expect(degraded).toBe(true)
    expect(dataSource).toContain('已禁用')
    // 数据是 fixture。
    expect(dataSource).toContain('fixture')
  })
})
