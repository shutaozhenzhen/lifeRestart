// @vitest-environment happy-dom
/**
 * ModPageView 页面测试 —— Mod 自己注册的页面（`/mods/page/:id`）
 *
 * 覆盖：
 *   1. 能渲染 manifest 声明的页面（标题 + 内容块；块渲染器与文档页共用）
 *   2. Mod 缺失 / id 不存在 → **可读空态**（不白屏、不抛）
 *   3. Mod 被禁用 → 空态里说清"这个页面属于 Mod X，它当前未启用"
 *   4. 动作按钮：注册过 → 可点并调用回调；没注册 → **禁用 + 可读提示**
 *   5. 未知块类型仍然显式显示（既有行为不能破）
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ModPageView from './ModPageView.vue'
import { useExtensionsStore } from '../stores/extensions.js'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, createTestRouter } from '../test-utils/setup.js'

// #mountPage
// 挂载页面并等路由参数解析完成。
//
// ⚠️ **必须先 push 并等导航完成再挂载**：路由参数解析是异步的，不等的话首帧
//    `route.params.id` 还是空的（页面会渲染成"没有找到 id 为「」的 Mod 页面"）。
//    与 ModDetailView.spec.js 里那条注释同一个原因。
//
// @param {string} id - 页面 id
// @returns {Promise<{wrapper: object, router: object}>} 挂载结果
async function mountPage(id = 'guide') {
  // 建路由（内存 history）。
  const router = createTestRouter()
  // 等导航完成。
  await router.push(`/mods/page/${id}`)
  // 挂载（注入同一个路由实例）。
  const mounted = mountView(ModPageView, { router })
  // 等渲染。
  await flushPromises()
  // 返回。
  return mounted
}

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia + localStorage。
  resetApp()
})

// #stubMods
// 造一个 discoverMods 用的 fetch 替身：`/mods/index.json` + 各 Mod 的 manifest。
//
// @param {Array<{name: string, manifest: object}>} mods - Mod 列表（manifest 里可含 ui）
// @returns {Function} fetch 替身
function stubMods(mods) {
  // 请求替身。
  const fetchStub = async (url) => {
    // 路径。
    const u = String(url)
    // 索引。
    if (u.endsWith('/index.json') || u.endsWith('index.json')) {
      // 返回名字列表。
      return { ok: true, json: async () => mods.map((m) => m.name), text: async () => JSON.stringify(mods.map((m) => m.name)) }
    }
    // 某个 Mod 的 manifest。
    const hit = mods.find((m) => u.includes(`/${m.name}/manifest.json`))
    // 命中。
    if (hit) {
      // 返回。
      return { ok: true, json: async () => hit.manifest, text: async () => JSON.stringify(hit.manifest) }
    }
    // 其它（files.json / code.js / 数据表）→ 404（清单即权威，别发无谓请求）。
    return { ok: false, status: 404, json: async () => null, text: async () => null }
  }
  // 注入全局（mod-store 与 discoverMods 都走它）。
  globalThis.fetch = fetchStub
  // 返回。
  return fetchStub
}

// #setupExtensions
// 装载扩展注册表（模拟 App.vue 启动时那一步）。
//
// @param {Array<object>} mods - Mod 列表
// @param {object} [saved] - 启停状态
// @returns {Promise<object>} 扩展 store
async function setupExtensions(mods, saved) {
  // fetch 替身。
  stubMods(mods)
  // store。
  const ext = useExtensionsStore()
  // 装载。
  await ext.load({ fetchImpl: globalThis.fetch, baseUrl: '/mods/', saved })
  // 返回。
  return ext
}

describe('ModPageView - 渲染 manifest 声明的页面', () => {
  test('页面命中：渲染标题、来源 Mod 与内容块', async () => {
    // 一个带页面的 Mod。
    await setupExtensions([
      {
        name: 'my-mod',
        manifest: {
          name: 'my-mod',
          version: '1.0.0',
          ui: {
            pages: [
              {
                id: 'guide',
                title: '我的指南',
                blocks: [
                  { t: 'p', text: '这一页是 Mod 加的' },
                  { t: 'note', kind: 'tip', text: '小提示' },
                  { t: 'list', items: ['第一条', '第二条'] },
                ],
              },
            ],
          },
        },
      },
    ])
    // 挂载到该页面。
    const { wrapper } = await mountPage('guide')
    await flushPromises()
    // 标题。
    expect(wrapper.find('.title').text()).toBe('我的指南')
    // 来源 Mod（看得出是谁加的）。
    expect(wrapper.find('.subtitle').text()).toContain('my-mod')
    // 内容块渲染出来了（用的是与文档页同一个 DocBlocks）。
    expect(wrapper.text()).toContain('这一页是 Mod 加的')
    expect(wrapper.text()).toContain('小提示')
    expect(wrapper.findAll('.list li').map((li) => li.text())).toEqual(['第一条', '第二条'])
    // 没有空态。
    expect(wrapper.find('.empty').exists()).toBe(false)
  })

  test('未知块类型仍然显式显示（既有行为不被破坏）', async () => {
    // 页面里塞一个坏块。
    await setupExtensions([
      { name: 'bad-mod', manifest: { name: 'bad-mod', version: '1.0.0', ui: { pages: [{ id: 'bad', title: '坏页', blocks: [{ t: 'bogus', text: '?' }] }] } } },
    ])
    // 挂载。
    const { wrapper } = await mountPage('bad')
    await flushPromises()
    // 显式警告。
    expect(wrapper.find('.note.warn').text()).toContain('未知内容块类型')
  })
})

describe('ModPageView - 空态（不白屏、不抛）', () => {
  test('id 不属于任何 Mod：说清"可能来自已卸载/已完全移除的 Mod"', async () => {
    // 没有任何 Mod 声明这个页面。
    await setupExtensions([{ name: 'other', manifest: { name: 'other', version: '1.0.0' } }])
    // 挂载。
    const { wrapper } = await mountPage('nope')
    await flushPromises()
    // 可读空态。
    expect(wrapper.find('.empty').exists()).toBe(true)
    expect(wrapper.find('.empty').text()).toContain('nope')
    expect(wrapper.find('.empty').text()).toContain('已卸载')
    // 有出口（去 Mod 管理 / 回主页）。
    expect(wrapper.findAll('button').map((b) => b.text()).join(' ')).toContain('Mod 管理')
  })

  test('Mod 被禁用：空态说清"这个页面属于 Mod X，它当前未启用"', async () => {
    // Mod 声明了页面，但被禁用（enabled=false）。
    await setupExtensions(
      [{ name: 'off-mod', manifest: { name: 'off-mod', version: '1.0.0', ui: { pages: [{ id: 'p1', title: '不该出现', blocks: [{ t: 'p', text: 'x' }] }] } } }],
      { enabled: { 'off-mod': false }, removed: [] },
    )
    // 挂载。
    const { wrapper } = await mountPage('p1')
    await flushPromises()
    // 页面没渲染。
    expect(wrapper.find('.title').text()).toBe('Mod 页面')
    // 空态点名了那个 Mod 与原因。
    const text = wrapper.find('.empty').text()
    expect(text).toContain('off-mod')
    expect(text).toContain('未启用')
  })

  test('Mod 完全移除：与未启用同一条空态路径（不抛）', async () => {
    // 记入 removed（移除 = 不加载 = 界面扩展不出现）。
    await setupExtensions(
      [{ name: 'gone-mod', manifest: { name: 'gone-mod', version: '1.0.0', ui: { pages: [{ id: 'p2', title: 'x', blocks: [{ t: 'p', text: 'y' }] }] } } }],
      { enabled: {}, removed: ['gone-mod'] },
    )
    // 挂载。
    const { wrapper } = await mountPage('p2')
    await flushPromises()
    // 空态。
    expect(wrapper.find('.empty').text()).toContain('gone-mod')
  })
})

describe('ModPageView - 动作按钮', () => {
  test('没注册过的动作：按钮禁用 + 可读提示', async () => {
    // 页面里有一个 action 块。
    await setupExtensions([
      { name: 'a-mod', manifest: { name: 'a-mod', version: '1.0.0', ui: { pages: [{ id: 'act', title: '动作页', blocks: [{ t: 'action', id: 'roll', label: '点我' }] }] } } },
    ])
    // 挂载（本局没有 Mod 界面桥 → 没人注册过这个动作）。
    const { wrapper } = await mountPage('act')
    await flushPromises()
    // 按钮在，但**禁用**。
    const btn = wrapper.find('.btn.action')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('点我')
    expect(btn.attributes('disabled')).toBeDefined()
    // 可读提示（不是"点了没反应"）。
    expect(wrapper.find('.action-hint').text()).toContain('roll')
  })

  test('注册过的动作：可点，且点击调用回调（异常隔离：回调抛错不炸页面）', async () => {
    // 页面 + action 块。
    await setupExtensions([
      { name: 'a-mod', manifest: { name: 'a-mod', version: '1.0.0', ui: { pages: [{ id: 'act', title: '动作页', blocks: [{ t: 'action', id: 'boom', label: '炸一下' }] }] } } },
    ])
    // 回调（故意抛错，验证隔离）。
    const fn = vi.fn(() => { throw new Error('回调炸了') })
    // 游戏 store 里挂一个假的界面桥（等价于 code.js 里 gameAPI.ui.onAction 注册过）。
    const game = useGameStore()
    // 造桥。
    const registered = new Set(['boom'])
    game.modUiBridges = {
      'a-mod': {
        // 有注册。
        hasAction: (id) => registered.has(id),
        // 触发（调回调）。
        trigger: (id, payload) => fn(id, payload),
      },
    }
    // 挂载。
    const { wrapper } = await mountPage('act')
    await flushPromises()
    // 可点。
    const btn = wrapper.find('.btn.action')
    expect(btn.attributes('disabled')).toBeUndefined()
    // 没有提示。
    expect(wrapper.find('.action-hint').exists()).toBe(false)
    // 点击。
    await btn.trigger('click')
    await flushPromises()
    // 回调被调用了。
    expect(fn).toHaveBeenCalled()
    // 异常被隔离成一条日志（页面没崩，还在）。
    expect(wrapper.find('.btn.action').exists()).toBe(true)
    expect(game.logBuffer.join('\n')).toContain('boom')
  })
})
