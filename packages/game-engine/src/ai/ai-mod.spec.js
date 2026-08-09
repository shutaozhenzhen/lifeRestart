/**
 * AI Mod 单元测试 — ai-mod.spec.js
 *
 * 覆盖范围：
 *   1. 客户端装配：配置 Key 才创建客户端
 *   2. 钩子注册/注入：onTalentPoolGenerate / onYearAdvance
 *   3. 校验失败重试 + fallback
 *   4. 注销
 */

// 导入 vitest 测试 DSL 和被测函数。
import { describe, test, expect } from 'vitest'
// AI Mod。
import createAIMod from './ai-mod.js'

// #makeGameAPI
// 构造 mock gameAPI（只实现 on/off/emit）。
// @returns {{api: object, calls: Array, bus: Map}}
function makeGameAPI() {
  // 钩子存储。
  const bus = new Map()
  // API。
  const api = {
    on(name, fn) {
      // 存储。
      if (!bus.has(name)) bus.set(name, [])
      bus.get(name).push(fn)
      // 移除函数。
      return () => {
        // 过滤。
        const list = bus.get(name) || []
        bus.set(name, list.filter(f => f !== fn))
      }
    },
    off() {},
    emit: async (name, payload) => {
      // 逐个执行。
      const results = []
      for (const fn of bus.get(name) || []) results.push(await fn(payload))
      return results
    },
  }
  // 返回。
  return { api, bus }
}

// #makeMockFetch
// 构造 mock fetch：返回指定 AI 回复。
//
// @param {string|Function} reply - 回复文本或函数（根据请求生成）
// @returns {Function} mock fetch
function makeMockFetch(reply) {
  // 返回 fetch。
  return async (url, opts) => {
    // 解析请求体。
    const body = JSON.parse(opts.body)
    // 回复内容。
    const content = typeof reply === 'function' ? reply(body) : reply
    // 返回响应。
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
  }
}

// #makeConfig
// 构造 AI 配置。
// @returns {object} 配置
function makeConfig() {
  return { baseUrl: 'https://api.test.com/v1', apiKey: 'key', model: 'model-x' }
}

// ========== 测试组 1：客户端装配 ==========
describe('ai-mod - assembly', () => {
  test('creates client when api key present', () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // 创建。
    const mod = createAIMod({ gameAPI: api, config: makeConfig(), fetch: makeMockFetch('{}') })
    // 客户端存在（生成函数可用）。
    expect(typeof mod.generateTalent).toBe('function')
  })

  test('falls back to original when no api key', async () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // 无 Key。
    const mod = createAIMod({ gameAPI: api, config: { baseUrl: 'x', apiKey: '' }, fetch: makeMockFetch('{}') })
    // 生成返回 null（fallback 信号）。
    expect(await mod.generateTalent()).toBe(null)
  })
})

// ========== 测试组 2：钩子注入 ==========
describe('ai-mod - hooks', () => {
  test('onTalentPoolGenerate injects generated talent', async () => {
    // gameAPI。
    const { api, bus } = makeGameAPI()
    // mock AI 返回合法天赋。
    const mod = createAIMod({
      gameAPI: api,
      config: makeConfig(),
      fetch: makeMockFetch('{"id":"ai_001","name":"AI天赋","condition":"params.CHR > 5","effect":{"INT":2}}'),
    })
    // 注册。
    mod.register()
    // 天赋池。
    const payload = { pool: [{ id: 'base_1', name: '原版' }] }
    // 触发钩子。
    await api.emit('onTalentPoolGenerate', payload)
    // AI 天赋被注入。
    expect(payload.pool.some(t => t.id === 'ai_001')).toBe(true)
    // 原版保留。
    expect(payload.pool.some(t => t.id === 'base_1')).toBe(true)
  })

  test('onYearAdvance injects generated event', async () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // mock AI 返回合法事件。
    const mod = createAIMod({
      gameAPI: api,
      config: makeConfig(),
      fetch: makeMockFetch('{"id":"ai_e1","event":"AI剧情","effect":{"LIF":-1}}'),
    })
    // 注册。
    mod.register()
    // 翻年 payload。
    const payload = { age: 10, content: [], isEnd: false }
    // 触发。
    await api.emit('onYearAdvance', payload)
    // AI 事件注入。
    expect(payload.content.some(c => c.description === 'AI剧情')).toBe(true)
  })
})

// ========== 测试组 3：校验 + fallback ==========
describe('ai-mod - validation & fallback', () => {
  test('retries on invalid output then returns null', async () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // 请求计数。
    let count = 0
    // mock AI 一直返回非法 JSON。
    const mod = createAIMod({
      gameAPI: api,
      config: makeConfig(),
      fetch: makeMockFetch(() => {
        count++
        return 'not json'
      }),
    })
    // 生成（重试耗尽）。
    const result = await mod.generateTalent()
    // 返回 null。
    expect(result).toBe(null)
    // 重试 3 次。
    expect(count).toBe(3)
  })

  test('valid output passes without retry', async () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // 请求计数。
    let count = 0
    // mock AI 返回合法天赋。
    const mod = createAIMod({
      gameAPI: api,
      config: makeConfig(),
      fetch: makeMockFetch(() => {
        count++
        return '{"id":"ok_1","name":"OK","condition":"params.CHR > 1"}'
      }),
    })
    // 生成。
    const result = await mod.generateTalent()
    // 返回合法天赋。
    expect(result.id).toBe('ok_1')
    // 无重试。
    expect(count).toBe(1)
  })
})

// ========== 测试组 4：注销 ==========
describe('ai-mod - unregister', () => {
  test('unregister removes hooks', async () => {
    // gameAPI。
    const { api } = makeGameAPI()
    // mod。
    const mod = createAIMod({
      gameAPI: api,
      config: makeConfig(),
      fetch: makeMockFetch('{"id":"ai_001","name":"AI天赋"}'),
    })
    // 注册后注销。
    mod.register()
    mod.unregister()
    // 天赋池。
    const payload = { pool: [] }
    // 触发（钩子已移除）。
    await api.emit('onTalentPoolGenerate', payload)
    // 无注入。
    expect(payload.pool).toEqual([])
  })
})
