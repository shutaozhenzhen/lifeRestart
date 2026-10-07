// @vitest-environment happy-dom
/**
 * ModPanels 组件测试 —— 把某个 slot 的 Mod 面板渲染成卡片
 *
 * 覆盖：
 *   1. 有声明 → 渲染卡片（标题 + 来源 Mod + 内容块）
 *   2. 没声明 / slot 不匹配 → 什么都不渲染（不留空壳）
 *   3. `home` slot 在 HomeView 里真的出现（端到端接线）
 */
import { describe, test, expect, beforeEach } from 'vitest'
// 组件挂载（mod-panels 需要显式传 props，故直接用 @vue/test-utils 的 mount）。
import { mount, flushPromises } from '@vue/test-utils'
import { getActivePinia } from 'pinia'
import ModPanels from '../components/ModPanels.vue'
import HomeView from '../views/HomeView.vue'
import { useExtensionsStore } from '../stores/extensions.js'
import { resetApp, mountView, stubFetchOk, createTestRouter } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia + localStorage + fetch。
  resetApp()
  // HomeView 会请求数据与 Mod 目录，统一给替身。
  stubFetchOk()
})

// #mountPanels
// 挂载 ModPanels 并传 slot（复用 resetApp 建的 pinia）。
//
// @param {string} slot - slot 名
// @returns {object} wrapper
function mountPanels(slot) {
  // 挂载（路由给内存实例：卡片里的 link/action 块会用到 router-link）。
  return mount(ModPanels, {
    // 注入 pinia + 路由。
    global: { plugins: [getActivePinia(), createTestRouter('/')] },
    // props。
    props: { slot },
  })
}

// #fill
// 直接填注册表（等价于 App.vue 装载 manifest.ui 之后的状态）。
//
// @param {object} panels - 面板声明
// @returns {object} 扩展 store
function fill(panels = []) {
  // store。
  const ext = useExtensionsStore()
  // 填。
  ext.base = { pages: [], panels, properties: [], stats: [] }
  // 重建合并表。
  ext.rebuild()
  // 返回。
  return ext
}

describe('ModPanels - 按 slot 渲染', () => {
  test('有声明：渲染卡片（标题、来源 Mod、内容块）', async () => {
    // 两个 home 面板。
    fill([
      { id: 'p1', slot: 'home', title: '来自 Mod A', mod: 'mod-a', blocks: [{ t: 'p', text: 'A 的内容' }] },
      { id: 'p2', slot: 'home', title: '来自 Mod B', mod: 'mod-b', blocks: [{ t: 'list', items: ['x', 'y'] }] },
    ])
    // 挂载 home slot。
    const wrapper = mountPanels('home')
    await flushPromises()
    // 两张卡片。
    expect(wrapper.findAll('.mod-panel').length).toBe(2)
    // 标题 + 来源。
    expect(wrapper.text()).toContain('来自 Mod A')
    expect(wrapper.text()).toContain('mod-a')
    // 内容块（与文档页同一个渲染器）。
    expect(wrapper.text()).toContain('A 的内容')
    expect(wrapper.findAll('.list li').map((li) => li.text())).toEqual(['x', 'y'])
  })

  test('没有声明：什么都不渲染（不留空壳）', async () => {
    // 空注册表。
    fill([])
    // 挂载。
    const wrapper = mountPanels('home')
    await flushPromises()
    // 连容器都没有。
    expect(wrapper.find('.mod-panels').exists()).toBe(false)
  })

  test('slot 不匹配：只渲染该 slot 的卡片', async () => {
    // 只有 mods slot 的面板。
    fill([{ id: 'x', slot: 'mods', title: '管理页卡片', blocks: [{ t: 'p', text: 'm' }] }])
    // 挂 home → 空。
    const home = mountPanels('home')
    await flushPromises()
    expect(home.find('.mod-panels').exists()).toBe(false)
    // 挂 mods → 有。
    const mods = mountPanels('mods')
    await flushPromises()
    expect(mods.findAll('.mod-panel').length).toBe(1)
    expect(mods.text()).toContain('管理页卡片')
  })
})

describe('ModPanels - 接线：home slot 真的挂在主页上', () => {
  test('主页出现 Mod 面板（有声明时）', async () => {
    // 静态注册表里放一个 home 面板。
    fill([{ id: 'home-card', slot: 'home', title: '主页卡片', mod: 'mod-a', blocks: [{ t: 'p', text: '主页多了这一段' }] }])
    // 挂载主页。
    const { wrapper } = mountView(HomeView, { route: '/' })
    await flushPromises()
    // 卡片在（HomeView 里插了 `<ModPanels slot="home" />`）。
    expect(wrapper.text()).toContain('主页卡片')
    expect(wrapper.text()).toContain('主页多了这一段')
  })

  test('没有声明时主页不出现任何 Mod 面板', async () => {
    // 空注册表。
    fill([])
    // 挂载主页。
    const { wrapper } = mountView(HomeView, { route: '/' })
    await flushPromises()
    // 没有面板容器（不留空壳）。
    expect(wrapper.find('.mod-panels').exists()).toBe(false)
  })
})
