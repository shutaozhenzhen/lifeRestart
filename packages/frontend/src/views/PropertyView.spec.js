// @vitest-environment happy-dom
/**
 * PropertyView 页面测试 —— 属性分配页
 *
 * 这一页是**历史崩溃点**（remake 之前读点数 → TypeError），所以这里的用例
 * 特意按真实顺序准备状态：init → confirmTalents（天赋页做的事）→ 挂载本页。
 *
 * 覆盖：
 *   1. 可用点数 = store.propertyPoints，且渲染成文本（不是 —）
 *   2. ＋/− 受单属性上限与剩余点数约束
 *   3. 随机分配：剩余点数归零
 *   4. 重置：分配归零、剩余回到总数
 *   5. 还有剩余点数时点「下一步」→ alert 提示且不跳转
 *   6. 剩余点数为 0 时点「下一步」→ 跳轨迹页
 */
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import PropertyView from './PropertyView.vue'
import { useGameStore } from '../stores/game.js'
import { resetApp, mountView, stubFetchOk, buildFixtureData } from '../test-utils/setup.js'

// 每个用例前重置。
beforeEach(() => {
  // 重置 pinia + localStorage + fetch。
  resetApp()
  stubFetchOk()
})

// #readyStore
// 按真实顺序准备状态：初始化引擎 + 确认天赋（属性页在此之前就要能读数）。
//
// @returns {Promise<object>} store
async function readyStore() {
  // store。
  const store = useGameStore()
  // 初始化引擎。
  await store.init(buildFixtureData())
  // 天赋页的「确认」步骤（remake）。
  store.confirmTalents()
  // 返回。
  return store
}

// #rowButton
// 取某属性行上的 ＋/− 按钮。
//
// @param {object} wrapper - 挂载结果
// @param {string} label - 属性中文名（如 '颜值'）
// @param {string} sign - '＋' 或 '−'
// @returns {object} 按钮 wrapper
function rowButton(wrapper, label, sign) {
  // 找到该属性的行。
  const row = wrapper.findAll('.row').find((r) => r.text().includes(label))
  // 行不存在直接失败。
  if (!row) throw new Error(`未找到属性行：${label}`)
  // 行内按钮。
  const btn = row.findAll('button').find((b) => b.text().includes(sign))
  // 未找到直接失败。
  if (!btn) throw new Error(`未找到 ${label} 的 ${sign} 按钮`)
  // 返回。
  return btn
}

// #findButton
// 按文本找页面级按钮。
function findButton(wrapper, text) {
  // 查找。
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text))
  // 未找到直接失败。
  if (!btn) throw new Error(`未找到按钮：${text}`)
  // 返回。
  return btn
}

describe('PropertyView', () => {
  test('渲染可用点数与剩余点数（历史崩溃点：这里曾抛 TypeError）', async () => {
    // 准备状态。
    const store = await readyStore()
    // 挂载（修复前这里的 computed 会崩）。
    const { wrapper } = mountView(PropertyView)
    // 页面把可用点数渲染为文本。
    expect(wrapper.find('.points').text()).toBe(String(store.propertyPoints))
    // 可用点数 ≥ 默认 20。
    expect(store.propertyPoints).toBeGreaterThanOrEqual(20)
    // 剩余 = 可用 - 已分配。
    expect(store.leftPoints).toBe(store.propertyPoints)
    // 四个属性行。
    expect(wrapper.findAll('.row').length).toBe(4)
  })

  test('＋/− 受单属性上限（10）约束', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(PropertyView)
    // 连点 12 次 ＋：只能到 10。
    for (let i = 0; i < 12; i++) await rowButton(wrapper, '颜值', '＋').trigger('click')
    // 上限生效。
    expect(store.allocation.CHR).toBe(10)
    // 再点 − 两次：回到 8。
    await rowButton(wrapper, '颜值', '−').trigger('click')
    await rowButton(wrapper, '颜值', '−').trigger('click')
    expect(store.allocation.CHR).toBe(8)
    // 减到 0 后不再变负。
    for (let i = 0; i < 12; i++) await rowButton(wrapper, '颜值', '−').trigger('click')
    expect(store.allocation.CHR).toBe(0)
  })

  test('点数用完后 ＋ 不再生效（剩余点数约束）', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(PropertyView)
    // 四项各加 5 点 = 20 点，正好用完。
    for (const label of ['颜值', '智力', '体质', '家境']) {
      for (let i = 0; i < 5; i++) await rowButton(wrapper, label, '＋').trigger('click')
    }
    // 已用完。
    expect(store.leftPoints).toBe(0)
    // 再点 ＋：剩余不足 → 不增长。
    await rowButton(wrapper, '颜值', '＋').trigger('click')
    expect(store.allocation.CHR).toBe(5)
    expect(store.leftPoints).toBe(0)
  })

  test('随机分配：点数全部分配完', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(PropertyView)
    // 随机分配。
    await findButton(wrapper, '随机分配').trigger('click')
    // 剩余归零。
    expect(store.leftPoints).toBe(0)
    // 分配总数 = 可用点数。
    expect(store.allocatedTotal).toBe(store.propertyPoints)
  })

  test('重置：分配归零、剩余回到总数', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper } = mountView(PropertyView)
    // 先随机分配。
    await findButton(wrapper, '随机分配').trigger('click')
    expect(store.leftPoints).toBe(0)
    // 重置。
    await findButton(wrapper, '重置').trigger('click')
    // 归零。
    expect(store.allocation).toEqual({ CHR: 0, INT: 0, STR: 0, MNY: 0 })
    expect(store.leftPoints).toBe(store.propertyPoints)
  })

  test('还有剩余点数时「下一步」：提示且不跳转', async () => {
    // 准备。
    const store = await readyStore()
    // 挂载。
    const { wrapper, router } = mountView(PropertyView)
    // 打桩 alert。
    const alertSpy = vi.fn()
    globalThis.alert = alertSpy
    // 只加 1 点，留 19 点。
    await rowButton(wrapper, '颜值', '＋').trigger('click')
    // 点下一步。
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 提示剩余点数。
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy.mock.calls[0][0]).toContain(String(store.leftPoints))
    // 没有跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })

  test('剩余点数为 0 时「下一步」：跳转轨迹页', async () => {
    // 准备。
    await readyStore()
    // 挂载。
    const { wrapper, router } = mountView(PropertyView)
    // 全部分配。
    await findButton(wrapper, '随机分配').trigger('click')
    // 下一步。
    await findButton(wrapper, '下一步').trigger('click')
    await flushPromises()
    // 到轨迹页。
    expect(router.currentRoute.value.path).toBe('/game')
  })
})
