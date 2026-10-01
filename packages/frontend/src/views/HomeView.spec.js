// @vitest-environment happy-dom
/**
 * HomeView 页面测试 —— 主页（模式选择 / 开始新人生 / 数据降级 / 导航入口）
 *
 * 覆盖要点：
 *   1. 首屏渲染：标题、两个模式入口、开始按钮
 *   2. 模式选择：写入 store.mode 且高亮切换
 *   3. 开始新人生：引擎初始化成功 + 跳转 /talent（**主流程起点**）
 *   4. 数据请求失败：降级 fixture 数据源（dataSource 标注）+ 仍可开局
 *   5. 设置 / Mod 管理入口跳转
 *   6. 加载中：按钮禁用并显示"加载中..."（防重复点击开局两局）
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import HomeView from './HomeView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, stubFetchFail } from '../test-utils/setup.js'

// 每个用例前重置 pinia 与 localStorage。
beforeEach(() => {
  // 重置。
  resetApp()
})

// #findButton
// 按文本找按钮。
function findButton(wrapper, text) {
  // 查找。
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text))
  // 未找到时给出可读错误。
  if (!btn) throw new Error(`未找到按钮：${text}`)
  // 返回。
  return btn
}

describe('HomeView', () => {
  test('首屏渲染标题、模式入口与开始按钮', () => {
    // 打桩数据。
    stubFetchOk()
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // 标题。
    expect(wrapper.find('.title').text()).toBe('人生重开模拟器')
    // 两个模式。
    expect(wrapper.findAll('.mode').length).toBe(2)
    // 默认高亮自定义模式。
    expect(wrapper.findAll('.mode')[0].classes()).toContain('active')
    // 开始按钮。
    expect(findButton(wrapper, '立即重开').exists()).toBe(true)
  })

  test('选择名人模式：写入 store.mode 且高亮切换', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // store。
    const store = useGameStore()
    // 点名人模式。
    await wrapper.findAll('.mode')[1].trigger('click')
    // store 已记录模式。
    expect(store.mode).toBe('celebrity')
    // 高亮切换。
    expect(wrapper.findAll('.mode')[1].classes()).toContain('active')
    expect(wrapper.findAll('.mode')[0].classes()).not.toContain('active')
  })

  test('点「立即重开」：引擎初始化并跳转天赋页', async () => {
    // 打桩数据（返回 fixture）。
    stubFetchOk()
    // 挂载。
    const { wrapper, router } = mountView(HomeView)
    // store。
    const store = useGameStore()
    // 点击开始。
    await findButton(wrapper, '立即重开').trigger('click')
    // 等异步初始化完成。
    await flushPromises()
    // 引擎就绪。
    expect(store.isReady).toBe(true)
    // 数据源为原版数据。
    expect(store.dataSource).toContain('lifeRestart-data')
    // 跳转天赋页。
    expect(router.currentRoute.value.path).toBe('/talent')
  })

  test('数据请求失败：降级为 fixture 数据源且仍能开局', async () => {
    // 数据失败。
    stubFetchFail()
    // 挂载。
    const { wrapper, router } = mountView(HomeView)
    // store。
    const store = useGameStore()
    // 开始。
    await findButton(wrapper, '立即重开').trigger('click')
    // 等待。
    await flushPromises()
    // 降级标注（日志报告里也能看到原因）。
    expect(store.dataSource).toContain('fixture')
    // 依然就绪可玩。
    expect(store.isReady).toBe(true)
    // 依然跳转。
    expect(router.currentRoute.value.path).toBe('/talent')
  })

  test('设置与 Mod 管理入口可跳转', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper, router } = mountView(HomeView)
    // 去设置页。
    await findButton(wrapper, '设置').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings')
    // 回主页再去 Mod 管理。
    await router.push('/')
    await flushPromises()
    await findButton(wrapper, 'Mod 管理').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/mods')
  })

  test('模拟统计入口可跳转（新增模拟系统）', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper, router } = mountView(HomeView)
    // 点模拟统计。
    await findButton(wrapper, '模拟统计').trigger('click')
    await flushPromises()
    // 到模拟页。
    expect(router.currentRoute.value.path).toBe('/simulate')
  })

  test('随机种子：填入指定值 → 本局按该种子初始化（可复现）', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // store。
    const store = useGameStore()
    // 填入种子（字符串来自输入框，会被规范化）。
    await wrapper.find('#seed-input').setValue('20261001')
    // 开始。
    await findButton(wrapper, '立即重开').trigger('click')
    await flushPromises()
    // 使用了指定种子。
    expect(store.seed).toBe(20261001)
  })

  test('随机种子：留空 → 自动生成 32 位整数种子', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // store。
    const store = useGameStore()
    // 输入框为空（默认）。
    expect(wrapper.find('#seed-input').element.value).toBe('')
    // 开始。
    await findButton(wrapper, '立即重开').trigger('click')
    await flushPromises()
    // 自动生成了合法种子。
    expect(Number.isInteger(store.seed)).toBe(true)
    expect(store.seed).toBeGreaterThanOrEqual(0)
    expect(store.seed).toBeLessThan(4294967296)
  })

  test('随机种子：清空按钮可用，且页面上有复现提示', async () => {
    // 准备。
    stubFetchOk()
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // 提示文案。
    expect(wrapper.find('.seed-hint').text()).toContain('同一种子')
    // 填入后清空。
    await wrapper.find('#seed-input').setValue('42')
    await findButton(wrapper, '清空').trigger('click')
    // 已清空。
    expect(wrapper.find('#seed-input').element.value).toBe('')
  })

  test('加载中：按钮禁用并显示"加载中..."（防重复开局）', async () => {
    // 永不返回的 fetch：让 startGame 停在 await 上。
    globalThis.fetch = () => new Promise(() => {})
    // 挂载。
    const { wrapper } = mountView(HomeView)
    // 点击开始。
    await findButton(wrapper, '立即重开').trigger('click')
    // 等一帧（loading 已置位）。
    await nextTick()
    // 按钮文案与禁用态。
    const btn = findButton(wrapper, '加载中')
    expect(btn.text()).toBe('加载中...')
    // 原生 disabled 属性。
    expect(btn.attributes('disabled')).toBeDefined()
  })
})
