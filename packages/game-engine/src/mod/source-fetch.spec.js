/**
 * source-fetch 单元测试 — 浏览器侧 Mod 源 + 「同一内核跑两次」验证
 *
 * 覆盖：
 *   1. index.json（数组 / { mods: [...] } 两种写法）、缺失 → 空列表
 *   2. files.json → 只读清单里的文件（避免浏览器一堆 404）
 *   3. readText：404 / 异常 → null；坏 JSON 记日志
 *   4. **关键**：用 fetch 源 + 平台无关内核，完整跑一遍
 *      「扫描 → 依赖拓扑 → 数据合并 → 执行 code.js → 注册新属性 + 注册钩子」
 *      —— 证明这套能力在浏览器环境（无 fs）里同等可用
 */

// vitest DSL。
import { describe, test, expect, vi } from 'vitest'
// 被测模块。
import { createFetchSource } from './source-fetch.js'
import { createModLoader } from './loader.js'
// gameAPI 与参数注册表（验证 mod 注册新属性）。
import { createGameAPI, createHookBus } from './gameapi.js'
import { createParamRegistry } from '../params/param-registry.js'

// #makeFetch
// 造一个"静态文件服务器"fetch 替身。
//
// @param {object} files - { 'URL 路径': '文件内容' }
// @returns {Function} fetch 实现
function makeFetch(files) {
  // 记录请求（用于断言"不该请求的文件没被请求"）。
  const calls = []
  // fetch 实现。
  const fetchImpl = async (url) => {
    // 记录。
    calls.push(String(url))
    // 命中。
    const hit = files[String(url)]
    // 404。
    if (hit === undefined) return { ok: false, status: 404, text: async () => '' }
    // 200。
    return { ok: true, status: 200, text: async () => hit }
  }
  // 附带请求记录。
  fetchImpl.calls = calls
  // 返回。
  return fetchImpl
}

describe('source-fetch - listMods', () => {
  test('index.json 数组写法', async () => {
    // 源。
    const source = createFetchSource({ baseUrl: '/mods/', fetchImpl: makeFetch({ '/mods/index.json': '["a","b"]' }) })
    // 列表。
    expect(await source.listMods()).toEqual(['a', 'b'])
  })

  test('index.json { mods: [...] } 写法（支持对象项）', async () => {
    // 源。
    const source = createFetchSource({
      baseUrl: '/mods/',
      fetchImpl: makeFetch({ '/mods/index.json': '{"mods":[{"name":"a"},{"name":"b"}]}' }),
    })
    // 列表。
    expect(await source.listMods()).toEqual(['a', 'b'])
  })

  test('index.json 缺失 → 空列表（调用方回退到"无 Mod"路径，不报错）', async () => {
    // 源（无 index）。
    const source = createFetchSource({ baseUrl: '/mods/', fetchImpl: makeFetch({}) })
    // 空。
    expect(await source.listMods()).toEqual([])
  })

  test('baseUrl 自动补斜杠', async () => {
    // 不带斜杠。
    const fetchImpl = makeFetch({ '/mods/index.json': '["a"]' })
    const source = createFetchSource({ baseUrl: '/mods', fetchImpl })
    // 仍然命中。
    expect(await source.listMods()).toEqual(['a'])
  })
})

describe('source-fetch - listFiles / readText', () => {
  test('files.json 提供文件清单', async () => {
    // 源。
    const source = createFetchSource({
      baseUrl: '/mods/',
      fetchImpl: makeFetch({ '/mods/a/files.json': '["manifest.json","code.js"]' }),
    })
    // 清单。
    expect(await source.listFiles('a')).toEqual(['manifest.json', 'code.js'])
    // 无清单 → null（loader 退回按约定清单探测）。
    expect(await source.listFiles('b')).toBeNull()
  })

  test('readText：404 / 网络异常 → null（不抛）', async () => {
    // 源：某路径抛异常。
    const source = createFetchSource({
      baseUrl: '/mods/',
      fetchImpl: async (url) => {
        // 抛异常。
        if (String(url).includes('boom')) throw new Error('network down')
        // 404。
        return { ok: false, status: 404, text: async () => '' }
      },
    })
    // 404。
    expect(await source.readText('a', 'code.js')).toBeNull()
    // 异常。
    expect(await source.readText('boom', 'code.js')).toBeNull()
  })

  test('坏 JSON 记日志并返回 null', async () => {
    // 日志替身。
    const log = { error: vi.fn(), debug: vi.fn() }
    // 源。
    const source = createFetchSource({ baseUrl: '/mods/', fetchImpl: makeFetch({ '/mods/a/files.json': '{oops' }), log })
    // 返回 null。
    expect(await source.listFiles('a')).toBeNull()
    // 记了日志。
    expect(log.error).toHaveBeenCalled()
  })
})

describe('source-fetch - 浏览器路径与 Node 共用同一内核', () => {
  test('完整跑通：扫描 → 拓扑 → 数据合并 → code.js 注册新属性与钩子', async () => {
    // 假静态服务器：两个 Mod，b 依赖 a；a 提供数据，b 提供代码。
    const fetchImpl = makeFetch({
      // 索引。
      '/mods/index.json': '["a","b"]',
      // Mod a：只有数据（且带 files.json，避免无谓 404）。
      '/mods/a/files.json': '["manifest.json","talents.json"]',
      '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
      '/mods/a/talents.json': '{"t1":{"id":"t1","name":"甲天赋"}}',
      // Mod b：依赖 a，带 code.js（注册新属性 + 钩子 + 注入天赋）。
      '/mods/b/files.json': '["manifest.json","code.js","talents.json"]',
      '/mods/b/manifest.json': '{"name":"b","version":"1.0.0","dependencies":["a"]}',
      '/mods/b/talents.json': '{"t2":{"id":"t2","name":"乙天赋"}}',
      '/mods/b/code.js': [
        // 注册一个新属性（mod 加属性）。
        'gameAPI.param.define("STA", { type: "local", array: false });',
        // 设置初值。
        'gameAPI.param.set("STA", 7);',
        // 注入天赋。
        'gameAPI.addTalent({ id: "t3", name: "丙天赋" });',
        // 注册钩子。
        'gameAPI.on("onYearAdvance", (p) => { p.content.push({ type: "EVT", description: "来自 mod b" }); });',
      ].join('\n'),
    })
    // 源 + 加载器（平台无关内核）。
    const source = createFetchSource({ baseUrl: '/mods/', fetchImpl })
    const loader = await createModLoader({ source })
    // 无错误。
    expect(loader.errors).toEqual([])
    // 依赖顺序：a 在 b 前。
    expect(loader.order).toEqual(['a', 'b'])
    // 参数注册表 + 钩子总线（浏览器侧就是这么做 gameAPI 的）。
    const registry = createParamRegistry()
    const bus = createHookBus()
    // 加载 + 执行。
    const { data, codeList } = await loader.loadAll({
      createAPI: (name, mergedData) => createGameAPI({ data: mergedData, hooks: bus, params: registry }),
    })
    // 数据合并：a 与 b 的天赋都在，且 code.js 注入的 t3 也在。
    expect(data.talents.t1.name).toBe('甲天赋')
    expect(data.talents.t2.name).toBe('乙天赋')
    expect(data.talents.t3.name).toBe('丙天赋')
    // code.js 执行记录。
    expect(codeList.find((c) => c.name === 'b').code).toContain('gameAPI.param.define')
    // 新属性可用（mod 加属性的完整闭环）。
    expect(registry.get('STA')).toBe(7)
    // 注册的钩子能触发。
    const payload = { content: [] }
    await bus.emit('onYearAdvance', payload)
    expect(payload.content.some((c) => c.description === '来自 mod b')).toBe(true)
    // files.json 生效：未列出的数据文件不会被请求（浏览器里没有 404 噪音）。
    const calls = fetchImpl.calls
    expect(calls.some((u) => u.includes('/mods/a/events.json'))).toBe(false)
    expect(calls.some((u) => u.includes('/mods/a/talents.json'))).toBe(true)
  })

  test('only 过滤：只加载启用的 Mod（依赖被禁用时不再报"缺失依赖"）', async () => {
    // 假服务器。
    const fetchImpl = makeFetch({
      '/mods/index.json': '["a","b"]',
      '/mods/a/files.json': '["manifest.json"]',
      '/mods/a/manifest.json': '{"name":"a","version":"1.0.0"}',
      '/mods/b/files.json': '["manifest.json"]',
      '/mods/b/manifest.json': '{"name":"b","version":"1.0.0","dependencies":["a"]}',
    })
    // 只启用 b（a 被禁用）。
    const loader = await createModLoader({ source: createFetchSource({ baseUrl: '/mods/', fetchImpl }), only: ['b'] })
    // 不报缺失依赖（被禁用的 a 不参与依赖解析）。
    expect(loader.errors).toEqual([])
    // 记录被挡掉的。
    expect(loader.disabled).toEqual(['a'])
    // 加载顺序只有 b。
    expect(loader.order).toEqual(['b'])
  })
})
