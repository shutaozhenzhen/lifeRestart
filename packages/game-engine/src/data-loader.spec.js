/**
 * data-loader 数据加载层单元测试 — data-loader.spec.js
 *
 * 覆盖范围：14 个测试用例，分为 4 组：
 *   1. createLoader（加载文件、并行加载、错误处理）
 *   2. validateStructure（结构校验）
 *   3. prepareForEngine（ID 字符串化）
 *   4. convertConditions（旧语法 → 新语法）
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// data-loader 模块。
import { createLoader, validateStructure, prepareForEngine, convertConditions } from './data-loader.js'

// #makeFetcher
// 创建 mock fetch：按 URL 返回模拟数据。
// @param {object} files - { 文件名: 数据 }
// @returns {(url: string) => Promise<object>} fetch 函数
function makeFetcher(files) {
  // 返回 fetch。
  return async (url) => {
    // 找文件名。
    const file = Object.keys(files).find(f => url.endsWith(f))
    // 找到返回。
    if (file) return { ok: true, json: async () => files[file] }
    // 未找到 404。
    return { ok: false, status: 404 }
  }
}

// ========== 测试组 1：createLoader ==========
describe('data-loader - createLoader', () => {
  test('loads single file', async () => {
    // 加载器。
    const loader = createLoader({
      fetch: makeFetcher({ 'talents.json': { t1: { id: 't1' } } }),
      baseUrl: '/data',
      locale: 'zh-cn',
    })
    // 加载。
    const data = await loader.load('talents.json')
    // 内容。
    expect(data.t1.id).toBe('t1')
  })

  test('builds URL with locale', async () => {
    // 记录 URL。
    let seenUrl = ''
    // 加载器。
    const loader = createLoader({
      fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({}) } },
      baseUrl: '/data',
      locale: 'en-us',
    })
    // 加载。
    await loader.load('age.json')
    // URL 含 locale。
    expect(seenUrl).toContain('/data/en-us/age.json')
  })

  test('throws on non-2xx', async () => {
    // 加载器（文件缺失）。
    const loader = createLoader({
      fetch: makeFetcher({}),
      baseUrl: '/data',
      locale: 'zh-cn',
    })
    // 抛错。
    await expect(loader.load('nope.json')).rejects.toThrow()
  })

  test('loadAll loads five datasets', async () => {
    // 全部文件。
    const files = {
      'age.json': { 0: { event: [], talent: [] } },
      'talents.json': {},
      'events.json': {},
      'achievement.json': {},
      'character.json': {},
    }
    // 加载器。
    const loader = createLoader({ fetch: makeFetcher(files), baseUrl: '/data', locale: 'zh-cn' })
    // 全部加载。
    const all = await loader.loadAll()
    // 五数据集。
    expect(Object.keys(all)).toEqual(['age', 'talents', 'events', 'achievements', 'characters'])
  })
})

// ========== 测试组 2：validateStructure ==========
describe('data-loader - validateStructure', () => {
  test('valid structure passes', () => {
    // 合法数据。
    const data = { age: {}, talents: {}, events: {}, achievements: {}, characters: {} }
    // 校验。
    expect(validateStructure(data).ok).toBe(true)
  })

  test('missing field fails', () => {
    // 缺 achievements。
    const data = { age: {}, talents: {}, events: {}, characters: {} }
    // 校验。
    const r = validateStructure(data)
    // 不通过。
    expect(r.ok).toBe(false)
    // 错误含字段名。
    expect(r.errors[0]).toContain('achievements')
  })

  test('null field fails', () => {
    // talents 为 null。
    const data = { age: {}, talents: null, events: {}, achievements: {}, characters: {} }
    // 校验。
    expect(validateStructure(data).ok).toBe(false)
  })
})

// ========== 测试组 3：prepareForEngine ==========
describe('data-loader - prepareForEngine', () => {
  test('converts numeric ids to strings', () => {
    // 数字 ID 数据。
    const data = {
      age: {}, talents: {}, events: {}, achievements: {}, characters: {},
      talents: { 1001: { id: 1001, name: 'x' } },
    }
    // 转换。
    const r = prepareForEngine(data)
    // id 是字符串。
    expect(r.talents['1001'].id).toBe('1001')
    // 类型。
    expect(typeof r.talents['1001'].id).toBe('string')
  })

  test('does not mutate original data', () => {
    // 原始数据。
    const data = { age: {}, talents: { 1001: { id: 1001 } }, events: {}, achievements: {}, characters: {} }
    // 转换。
    prepareForEngine(data)
    // 原始数据不变。
    expect(data.talents['1001'].id).toBe(1001)
  })
})

// ========== 测试组 4：convertConditions ==========
describe('data-loader - convertConditions', () => {
  test('converts talent condition', () => {
    // 数据。
    const data = { talents: { t1: { id: 't1', condition: 'CHR>5' } }, events: {}, achievements: {} }
    // 转换。
    const r = convertConditions(data, { CHR: 'scalar' })
    // 新语法。
    expect(r.talents.t1.condition).toBe('params.CHR > 5')
  })

  test('converts event include/exclude', () => {
    // 数据。
    const data = { events: { e1: { id: 'e1', include: 'INT>3', exclude: 'MNY<2' } }, talents: {}, achievements: {} }
    // 转换。
    const r = convertConditions(data, { INT: 'scalar', MNY: 'scalar' })
    // 新语法。
    expect(r.events.e1.include).toBe('params.INT > 3')
    expect(r.events.e1.exclude).toBe('params.MNY < 2')
  })

  test('converts event branch conditions', () => {
    // 数据。
    const data = { events: { e1: { id: 'e1', branch: [['CHR>7', 'e2']] } }, talents: {}, achievements: {} }
    // 转换。
    const r = convertConditions(data, { CHR: 'scalar' })
    // 分支条件转换。
    expect(r.events.e1.branch[0][0]).toBe('params.CHR > 7')
    // 目标保留。
    expect(r.events.e1.branch[0][1]).toBe('e2')
  })

  test('converts achievement condition', () => {
    // 数据。
    const data = { achievements: { a1: { id: 'a1', condition: 'HAGE>10' } }, talents: {}, events: {} }
    // 转换。
    const r = convertConditions(data, { HAGE: 'scalar' })
    // 新语法。
    expect(r.achievements.a1.condition).toBe('params.HAGE > 10')
  })

  test('leaves no-condition items untouched', () => {
    // 无条件数据。
    const data = { talents: { t1: { id: 't1' } }, events: {}, achievements: {} }
    // 转换。
    const r = convertConditions(data, {})
    // 无条件。
    expect(r.talents.t1.condition).toBeUndefined()
  })
})
