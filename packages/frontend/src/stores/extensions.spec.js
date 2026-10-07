// @vitest-environment happy-dom
/**
 * extensions store 测试 —— Mod 界面扩展注册表（装载 / 追加 / 禁用）
 *
 * 覆盖：
 *   1. `load()` 从启用 Mod 的 manifest.ui 装载四类扩展（**不执行 code.js**）
 *   2. **禁用即消失**：同一条 Mod 声明，被禁用（或被完全移除）后它的界面扩展不出现
 *   3. Mod 目录没同步（index.json 404）→ 空注册表、**不抛不白屏**
 *   4. 运行期追加（`uiSink().add` = `gameAPI.ui.*` 的落点）与冲突（同 id 后者胜 + warn）
 *   5. `beginRuntime()` 只清运行期注册（静态声明保留）；`reset()` 全清
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useExtensionsStore } from './extensions.js'
import { resetApp } from '../test-utils/setup.js'

// 每个用例前重置（全新 pinia + 干净 localStorage）。
beforeEach(() => {
  // 重置。
  resetApp()
})

// #stubMods
// 造 discoverMods 的 fetch 替身。
//
// @param {Array<{name: string, manifest: object}>} mods - Mod 列表
// @returns {Function} fetch 替身
function stubMods(mods) {
  // 替身。
  const fetchStub = async (url) => {
    // 路径。
    const u = String(url)
    // 索引。
    if (u.endsWith('index.json')) {
      // 名字列表。
      return { ok: true, text: async () => JSON.stringify(mods.map((m) => m.name)), json: async () => mods.map((m) => m.name) }
    }
    // manifest。
    const hit = mods.find((m) => u.includes(`/${m.name}/manifest.json`))
    // 命中。
    if (hit) {
      // 返回。
      return { ok: true, text: async () => JSON.stringify(hit.manifest), json: async () => hit.manifest }
    }
    // 其余 404。
    return { ok: false, status: 404, text: async () => null, json: async () => null }
  }
  // 注入。
  globalThis.fetch = fetchStub
  // 返回。
  return fetchStub
}

// #uiManifest
// 造一个带 ui 声明的 manifest。
//
// @param {string} name - Mod 名
// @returns {object} manifest
function uiManifest(name) {
  // 返回。
  return {
    // 名。
    name,
    // 版本（必填）。
    version: '1.0.0',
    // 界面声明（四类各一条）。
    ui: {
      // 页面。
      pages: [{ id: `${name}-page`, title: `${name} 的页面`, blocks: [{ t: 'p', text: 'hi' }] }],
      // 面板。
      panels: [{ id: `${name}-panel`, slot: 'home', title: `${name} 的面板`, blocks: [{ t: 'p', text: 'hi' }] }],
      // 属性。
      properties: [{ key: 'LUCK', label: '幸运' }],
      // 统计。
      stats: [{ key: 'RKEY', label: '计数', kind: 'count' }],
    },
  }
}

describe('extensions store - 装载（manifest.ui 静态声明）', () => {
  test('装载启用 Mod 的四类扩展，并给出可读状态', async () => {
    // 一个带 ui 的 Mod。
    stubMods([{ name: 'my-mod', manifest: uiManifest('my-mod') }])
    // store。
    const ext = useExtensionsStore()
    // 装载（直接给 saved：默认启用）。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: [] } })
    // 四类都装上了。
    expect(ext.merged.pages.map((p) => p.id)).toEqual(['my-mod-page'])
    expect(ext.merged.panels.map((p) => p.id)).toEqual(['my-mod-panel'])
    expect(ext.merged.properties.map((p) => p.key)).toEqual(['LUCK'])
    expect(ext.merged.stats.map((p) => p.key)).toEqual(['RKEY'])
    // 来源 Mod 名带上了（空态提示要用）。
    expect(ext.merged.pages[0].mod).toBe('my-mod')
    // 状态是可读的（日志面板里会用）。
    expect(ext.status).toContain('页面 1')
    // 没有错误。
    expect(ext.errors).toEqual([])
    // 已装载标记（App.vue 只调一次）。
    expect(ext.loaded).toBe(true)
    // 幂等：再调一次不会重复装载。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: [] } })
    expect(ext.merged.pages).toHaveLength(1)
  })

  test('**禁用即消失**：同一个 Mod 被禁用后它的界面扩展不出现', async () => {
    // 两个 Mod，都带 ui。
    stubMods([
      { name: 'on-mod', manifest: uiManifest('on-mod') },
      { name: 'off-mod', manifest: uiManifest('off-mod') },
    ])
    // store。
    const ext = useExtensionsStore()
    // 装载：off-mod 被禁用。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: { 'off-mod': false }, removed: [] } })
    // 只有启用那个的扩展在。
    expect(ext.merged.pages.map((p) => p.id)).toEqual(['on-mod-page'])
    expect(ext.merged.panels.map((p) => p.id)).toEqual(['on-mod-panel'])
    // 被禁用的那个**没有**贡献任何东西。
    expect(JSON.stringify(ext.merged)).not.toContain('off-mod-page')
    // 但它仍在"声明过"的账本里（空态提示据此说"这个页面属于 Mod X，它当前未启用"）。
    expect(Object.keys(ext.declared)).toContain('off-mod')
    expect(ext.explainMissingPage('off-mod-page')).toContain('off-mod')
    expect(ext.explainMissingPage('off-mod-page')).toContain('未启用')
  })

  test('**完全移除即消失**：记入 removed 的 Mod 也不贡献界面扩展', async () => {
    // 一个 Mod 带 ui。
    stubMods([{ name: 'gone-mod', manifest: uiManifest('gone-mod') }])
    // store。
    const ext = useExtensionsStore()
    // 装载：它已被完全移除。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: ['gone-mod'] } })
    // 空注册表。
    expect(ext.merged.pages).toEqual([])
    expect(ext.merged.panels).toEqual([])
    // 空态能说清原因。
    expect(ext.explainMissingPage('gone-mod-page')).toContain('gone-mod')
  })

  test('Mod 目录没同步（index.json 404）→ 空注册表，**不抛**', async () => {
    // 所有请求 404（模拟 public/mods 没同步）。
    globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => null, json: async () => null })
    // store。
    const ext = useExtensionsStore()
    // 装载（不抛）。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/' })
    // 空注册表 + isEmpty。
    expect(ext.merged.pages).toEqual([])
    expect(ext.isEmpty).toBe(true)
    // 状态可读。
    expect(ext.status).toContain('无界面扩展')
  })

  test('全部 Mod 被禁用 → 空注册表（且状态里写清启用 0 个）', async () => {
    // 一个 Mod，禁用。
    stubMods([{ name: 'a', manifest: uiManifest('a') }])
    // store。
    const ext = useExtensionsStore()
    // 装载。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: { a: false }, removed: [] } })
    // 空。
    expect(ext.isEmpty).toBe(true)
    expect(ext.enabled).toEqual([])
  })

  test('manifest 里的 ui 写坏 → 逐条进 errors（不抛）', async () => {
    // ui.pages 不是数组（会被收集层记错）。
    stubMods([{ name: 'bad', manifest: { name: 'bad', version: '1.0.0', ui: { pages: 'nope' } } }])
    // store。
    const ext = useExtensionsStore()
    // 装载。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: [] } })
    // 记了错。
    expect(ext.errors.join('\n')).toContain('bad')
    // 页面为空（坏数据没进注册表）。
    expect(ext.merged.pages).toEqual([])
  })
})

describe('extensions store - 运行期注册与重置', () => {
  test('uiSink().add 追加运行期声明（同 id 后者胜 + warn）', async () => {
    // 静态声明一个页面。
    stubMods([{ name: 'my-mod', manifest: uiManifest('my-mod') }])
    // store。
    const ext = useExtensionsStore()
    // 装载。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: [] } })
    // 运行期注册一个新面板 + 覆盖同 id 的页面。
    const sink = ext.uiSink()
    // 新面板。
    sink.add('panels', { id: 'runtime-panel', slot: 'mods', title: '运行期', blocks: [] }, 'my-mod')
    // 覆盖同 id 页面（后注册者胜）。
    sink.add('pages', { id: 'my-mod-page', title: '被运行期改过的标题', blocks: [] }, 'my-mod')
    // 面板两个。
    expect(ext.merged.panels.map((p) => p.id)).toEqual(['my-mod-panel', 'runtime-panel'])
    // 页面只有一个，且标题是新的。
    expect(ext.merged.pages).toHaveLength(1)
    expect(ext.merged.pages[0].title).toBe('被运行期改过的标题')
    // 冲突记了 warn（不静默覆盖）。
    expect(ext.errors.join('\n')).toContain('my-mod-page')
  })

  test('beginRuntime 只清运行期注册（静态声明保留）；reset 全清', async () => {
    // 静态。
    stubMods([{ name: 'my-mod', manifest: uiManifest('my-mod') }])
    // store。
    const ext = useExtensionsStore()
    // 装载。
    await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved: { enabled: {}, removed: [] } })
    // 运行期加一个。
    ext.uiSink().add('pages', { id: 'rt', title: '运行期页', blocks: [] }, 'my-mod')
    expect(ext.merged.pages.map((p) => p.id)).toEqual(['my-mod-page', 'rt'])
    // 开下一局：运行期清掉，静态保留。
    ext.beginRuntime()
    expect(ext.merged.pages.map((p) => p.id)).toEqual(['my-mod-page'])
    // 全清。
    ext.reset()
    expect(ext.merged.pages).toEqual([])
    expect(ext.loaded).toBe(false)
  })

  test('uiSink().addStatistic 转给 Life（没有 Life 时记 warn 并返回 false，不抛）', () => {
    // store。
    const ext = useExtensionsStore()
    // 没有 Life。
    const sink = ext.uiSink()
    // 记 warn + false。
    expect(sink.addStatistic('K', 1)).toBe(false)
    expect(ext.errors.join('\n')).toContain('K')
    // 给了 Life 就转给它。
    const life = { addStatistic: vi.fn(() => true) }
    // 新的 sink。
    const sink2 = ext.uiSink({ life })
    // 转发。
    expect(sink2.addStatistic('K', 2, 'J_Good')).toBe(true)
    expect(life.addStatistic).toHaveBeenCalledWith('K', 2, 'J_Good')
  })
})
