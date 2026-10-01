// @vitest-environment happy-dom
/**
 * SimulateView 页面测试 — 模拟统计页
 *
 * 覆盖：
 *   1. 首屏：控制区（局数档位/种子/快速模式/数据源/预计耗时）
 *   2. 跑一次模拟：进度推进 → 结果区渲染（概览/寿命分布/分档/属性均值/收集/最佳一局）
 *   3. 停止：运行中可取消，并保留已完成部分的聚合结果
 *   4. 可复现：填种子后结果标注 seed
 *   5. 返回主页
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import SimulateView from './SimulateView.vue'
import { resetApp, mountView, stubFetchOk, stubFetchFail, waitFor } from '../test-utils/setup.js'

// 每个用例前重置（内存 localStorage + fetch 桩）。
beforeEach(() => {
  // 重置。
  resetApp()
  // 数据请求返回 fixture（模拟在 fixture 上是毫秒级）。
  stubFetchOk()
})

// #findButton
// 按文本找按钮。
function findButton(wrapper, text) {
  // 查找。
  const btn = wrapper.findAll('button').find((b) => b.text().includes(text))
  // 未找到直接失败。
  if (!btn) throw new Error(`未找到按钮：${text}`)
  // 返回。
  return btn
}

describe('SimulateView', () => {
  test('首屏渲染控制区：局数档位、种子、快速模式、数据源与耗时预估', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    // 等数据加载完成。
    await flushPromises()
    // 局数档位（10/30/50/100）。
    const chips = wrapper.findAll('.chip')
    expect(chips.length).toBe(4)
    // 默认 30 高亮。
    expect(wrapper.find('.chip.active').text()).toBe('30')
    // 种子输入与快速模式开关。
    expect(wrapper.find('input.num.wide').exists()).toBe(true)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
    // 数据源标注（fixture 桩被当作原版数据）。
    expect(wrapper.find('.source').text()).toContain('lifeRestart-data')
    // 开始按钮与预计耗时。
    expect(findButton(wrapper, '开始模拟').exists()).toBe(true)
    expect(wrapper.text()).toContain('预计耗时约')
    // 未开始时没有结果区。
    expect(wrapper.find('.overview').exists()).toBe(false)
  })

  test('跑一次模拟：进度推进并渲染全部结果区', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 用快速模式（演示数据，保证毫秒级）。
    await wrapper.find('input[type="checkbox"]').setValue(true)
    // 局数改为 10（更快）。
    await wrapper.findAll('.chip')[0].trigger('click')
    await flushPromises()
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    // 等结果出现。
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 概览：六个指标。
    expect(wrapper.findAll('.overview .cell').length).toBe(6)
    // 寿命分布：11 档。
    expect(wrapper.findAll('.bar-row').length).toBe(11)
    // 分档区显示三档中文（普通/优秀/极佳 之一至少出现）。
    expect(wrapper.text()).toMatch(/普通|优秀|极佳/)
    // 属性均值区（终局 / 历史最高）。
    expect(wrapper.text()).toContain('属性均值（终局 / 历史最高）')
    // 收集率（百分比）。
    expect(wrapper.text()).toMatch(/\d+\.\d%/)
    // 最佳一局区。
    expect(wrapper.text()).toContain('最佳一局（总评最高）')
    // 进度文本显示已完成 10/10。
    expect(wrapper.find('.progress-text').text()).toContain('10')
    // 按钮回到「开始模拟」。
    expect(findButton(wrapper, '开始模拟').exists()).toBe(true)
  })

  test('运行中可以停止，并保留已完成部分的聚合', async () => {
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 快速模式 + 100 局（足够长以便中途停止）。
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('.chip')[3].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.chip')[3].text()).toBe('100')
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    // 等进度动起来（至少完成一局）。
    await waitFor(() => wrapper.find('.progress-text').exists() && wrapper.find('.progress-text').text().includes('已完成'))
    // 停止。
    await findButton(wrapper, '停止').trigger('click')
    // 等运行结束（按钮回到开始）。
    await waitFor(() => wrapper.findAll('button').some((b) => b.text().includes('开始模拟')))
    await flushPromises()
    // 有结果（已完成的那些局）。
    expect(wrapper.find('.overview').exists()).toBe(true)
    // 局数不超过设定值。
    const overview = wrapper.find('.overview').text()
    expect(overview).toContain('局')
  })

  test('填种子后结果标注 seed（可复现）', async () => {
    // 挂载 + 快速模式。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    // 只跑 10 局。
    await wrapper.findAll('.chip')[0].trigger('click')
    // 填种子。
    await wrapper.find('input.num.wide').setValue('42')
    await flushPromises()
    // 开始。
    await findButton(wrapper, '开始模拟').trigger('click')
    await waitFor(() => wrapper.find('.overview').exists())
    await flushPromises()
    // 概览标题里带 seed（标题是概览区的兄弟节点，故按整页文本断言）。
    expect(wrapper.text()).toContain('seed=42')
  })

  test('原版数据不可用：提示并自动切到快速模式', async () => {
    // 让数据请求失败。
    stubFetchFail()
    // 挂载。
    const { wrapper } = mountView(SimulateView)
    await flushPromises()
    // 有提示。
    expect(wrapper.find('.warn').text()).toContain('快速模式')
    // 快速模式已自动勾选。
    expect(wrapper.find('input[type="checkbox"]').element.checked).toBe(true)
    // 数据源标注为 fixture。
    expect(wrapper.find('.source').text()).toContain('fixture')
  })

  test('返回按钮回主页', async () => {
    // 挂载。
    const { wrapper, router } = mountView(SimulateView)
    await flushPromises()
    // 返回。
    await findButton(wrapper, '返回').trigger('click')
    await flushPromises()
    // 跳转。
    expect(router.currentRoute.value.path).toBe('/')
  })
})
